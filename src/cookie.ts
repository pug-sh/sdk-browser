import { log } from './logger.js'
import type { GrantedGate } from './tracking-consent.js'
import { decodeStored, type StoredEnvelope } from './utils.js'

/**
 * Controls whether identity (anonymous ID, external ID, session state, persisted consent) is shared
 * across subdomains of the same site via a first-party cookie on the registrable domain.
 *
 * - `true` — discover the widest settable domain (eTLD+1, e.g. `.example.com`) with a write-probe.
 * - `false` — no cookie; persistence stays in origin-scoped localStorage.
 * - `{ domain }` — pin an explicit cookie domain, e.g. to scope narrower than the registrable
 *   domain (`app.acme.com` instead of `.acme.com`) or to a tenant slug on a multi-tenant platform.
 *   Falls back to a host-only cookie with a warning when the browser rejects the domain.
 *
 * Cookie lifetime comes from the top-level `maxAgeDays` init option, not from here.
 */
// `domain` is required so `{}` cannot opt in without stating it, and `maxAgeDays?: never` closes the
// removed lifetime arm for variables and spreads (excess-property checks guard only fresh literals).
// @see docs/design-notes/cookie.md#why-domain-is-required-in-the-object-arm
export type CrossSubdomainConfig = boolean | { readonly domain: string; readonly maxAgeDays?: never }

/** Minimal document surface the cookie layer needs — injectable so tests can target other origins. */
export interface CookieDocument {
  cookie: string
  readonly location: { readonly hostname: string; readonly protocol: string }
}

export interface CookieLayer {
  get(name: string): string | null
  /**
   * Returns true only when the write verifiably landed (read-back matches).
   *
   * `maxAgeSeconds` is the value's remaining lifetime, so the cookie expires with the value it
   * holds. Required, never defaulted: a defaulted lifetime is one nobody chose.
   *
   * `value` is the *enveloped* string minted by `encodeStored`, never a bare one — reads prefer this
   * layer, and a bare value here reads as undecodable and is deleted by the store's next getItem.
   */
  set(name: string, value: StoredEnvelope, maxAgeSeconds: number): boolean
  /**
   * Returns true only when the key is verifiably gone (read-back is null).
   *
   * `intent` picks who reports a failure, not what is attempted: a `'teardown'` reports here, a
   * `'write'` stays silent because `persistence.setItem()` already warns with the consequence in
   * hand. @see docs/design-notes/cookie.md#remove-and-the-intent-parameter
   */
  remove(name: string, intent?: 'teardown' | 'write'): boolean
  /** True when the cookie is scoped to a shared domain and therefore visible across subdomains. */
  readonly crossSubdomain: boolean
}

/**
 * What a twin's own stored value says should happen to it: seconds left, `'expired'`, or
 * `'undecodable'`. The last two are separate outcomes on purpose — collapsed into one `null`,
 * "retention says drop this" was applied to "this layer cannot read it".
 * @see docs/design-notes/cookie.md#twinlifetime-returns-three-outcomes-not-two
 */
const twinLifetime = (raw: string): number | 'expired' | 'undecodable' => {
  const stored = decodeStored(raw)
  if (!stored) {
    return 'undecodable'
  }
  const seconds = Math.round((stored.expiresAt - Date.now()) / 1000)
  return seconds > 0 ? seconds : 'expired'
}

/** Browsers cap a cookie (name + value + attributes) around 4096 bytes; refuse oversized writes early. */
const MAX_COOKIE_LENGTH = 3800

/**
 * How long an undecodable twin is put back for. It only needs to survive until the store's read on
 * this same call, which removes it — long enough for a slow page, short enough that a value with no
 * deadline of its own cannot linger.
 */
const LEGACY_TWIN_RESTORE_SECONDS = 300

/** Bound on how many hostname labels the domain probe will consider. */
const PROBE_LABEL_LIMIT = 8

const isIpAddress = (hostname: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')

const probeName = (): string => `__pug_probe_${Math.random().toString(36).slice(2)}__`

const readCookie = (doc: CookieDocument, name: string): string | null => {
  try {
    const target = `${encodeURIComponent(name)}=`
    for (const part of doc.cookie.split('; ')) {
      if (part.startsWith(target)) {
        try {
          return decodeURIComponent(part.slice(target.length))
        } catch {
          // Malformed value on a same-named cookie (e.g. a foreign host-only twin) — keep
          // scanning; a valid twin at another scope may follow in the string.
        }
      }
    }
  } catch {
    // document.cookie can throw (sandboxed frame) — no usable value.
  }
  return null
}

/** True when the browser accepts a cookie scoped to `.domain` from the current page. */
const canUseCookieDomain = (doc: CookieDocument, domain: string): boolean => {
  const name = probeName()
  try {
    doc.cookie = `${name}=1; domain=.${domain}; path=/; max-age=3`
    const accepted = doc.cookie.includes(`${name}=`)
    if (accepted) {
      doc.cookie = `${name}=; domain=.${domain}; path=/; max-age=0`
    }
    return accepted
  } catch {
    return false
  }
}

/**
 * Finds the widest domain the browser will set a cookie on — the registrable domain (eTLD+1).
 * Probes widest-first: everything wider than eTLD+1 is a public suffix the browser refuses, so the
 * first accepted candidate is the answer and no bundled suffix list is needed. Returns '' when
 * nothing is accepted (caller falls back to a host-only cookie).
 * @see docs/design-notes/cookie.md#domain-discovery
 */
export const seekRegistrableDomain = (doc: CookieDocument): string => {
  const labels = doc.location.hostname.split('.')
  const maxLabels = Math.min(labels.length, PROBE_LABEL_LIMIT)
  for (let n = 1; n <= maxLabels; n++) {
    const candidate = labels.slice(-n).join('.')
    if (candidate && canUseCookieDomain(doc, candidate)) {
      return candidate
    }
  }
  return ''
}

/**
 * What the config actually asked for. `'off'` covers every shape that did not state an opt-in — the
 * type rules those out for npm consumers, but the one-tag install supplies this as untyped
 * `data-options` JSON that no compiler ever sees, so only a literal `true` reaches the probe.
 * @see docs/design-notes/cookie.md#the-three-shapes-that-used-to-auto-discover
 */
type CrossSubdomainIntent =
  | { readonly kind: 'off' }
  | { readonly kind: 'discover' }
  | { readonly kind: 'pin'; readonly domain: string }

const resolveIntent = (config: CrossSubdomainConfig): CrossSubdomainIntent => {
  if (config === true) {
    return { kind: 'discover' }
  }
  if (config === false || config === null || config === undefined) {
    return { kind: 'off' }
  }
  const domain = typeof config === 'object' ? (config as { domain?: unknown }).domain : undefined
  if (typeof domain === 'string' && domain !== '') {
    // The stated domain carries the opt-in, so extra keys do not disable it — but swallowing them
    // silently replaced a deliberately shortened lifetime with the 365-day default. Keys holding
    // `undefined` are exempt: a builder spreading an unset legacy optional configures nothing.
    const extras = Object.keys(config as object).filter(
      key => key !== 'domain' && (config as Record<string, unknown>)[key] !== undefined,
    )
    if (extras.length > 0) {
      const lifetimeHint = extras.includes('maxAgeDays')
        ? ' Cookie lifetime moved to the top-level maxAgeDays init option.'
        : ''
      log.warn(`crossSubdomainTracking ignores ${JSON.stringify(extras)}; the domain pin still applies.${lifetimeHint}`)
    }
    return { kind: 'pin', domain }
  }
  log.warn(
    `crossSubdomainTracking ${JSON.stringify(config)} does not state a domain; identity stays origin-scoped. Pass true to discover the registrable domain, or { domain: 'example.com' } to pin one.`,
  )
  return { kind: 'off' }
}

const resolveExplicitDomain = (doc: CookieDocument, requested: string): string => {
  const domain = requested.replace(/^\./, '').toLowerCase()
  const hostname = doc.location.hostname.toLowerCase()
  const coversHost = domain !== '' && (hostname === domain || hostname.endsWith(`.${domain}`))
  if (coversHost && canUseCookieDomain(doc, domain)) {
    return domain
  }
  log.warn(
    `crossSubdomainTracking domain "${requested}" is not usable on "${doc.location.hostname}"; using a host-only cookie instead.`,
  )
  return ''
}

/**
 * Creates the cookie layer used by `createPersistentStore()`, or null when cookies are disabled by
 * config or unavailable (blocked, sandboxed frame, non-browser environment). Environment failures
 * degrade to localStorage-only persistence — the layer itself never throws. The one throw is the
 * head guard on an omitted consent gate: internal misuse, which must fail loud at creation.
 */
export const createCookieLayer = (
  config: CrossSubdomainConfig,
  // Gates the twin promotion in reconcileTwin() — the one identity *write* on the read path, and so
  // the one that escaped every other consent check.
  isGranted: GrantedGate,
  doc: CookieDocument | null = typeof document === 'undefined' ? null : document,
): CookieLayer | null => {
  // At the head, not the point of use: an unguarded gate is first called inside reconcileTwin's try,
  // after the live twin has already been expired, so the misuse destroyed a value.
  // @see docs/design-notes/cookie.md#the-isgranted-head-guard
  if (typeof isGranted !== 'function') {
    throw new TypeError('createCookieLayer requires the isGranted consent gate')
  }
  // Resolved before the availability probe: an unusable config needs no test cookie written.
  const intent = resolveIntent(config)
  if (intent.kind === 'off' || !doc) {
    return null
  }

  // Host-only availability probe — cookies can be blocked wholesale.
  const name = probeName()
  let available = false
  try {
    doc.cookie = `${name}=1; path=/; max-age=3`
    available = doc.cookie.includes(`${name}=`)
    if (available) {
      doc.cookie = `${name}=; path=/; max-age=0`
    }
  } catch {
    available = false
  }
  if (!available) {
    log.warn('Cookies unavailable; identity will not be shared across subdomains.')
    return null
  }

  const hostname = doc.location.hostname
  let domain = ''
  if (intent.kind === 'pin') {
    domain = resolveExplicitDomain(doc, intent.domain)
  } else if (hostname && hostname !== 'localhost' && !isIpAddress(hostname)) {
    domain = seekRegistrableDomain(doc)
  }

  const domainAttr = domain ? `; domain=.${domain}` : ''
  const secureAttr = doc.location.protocol === 'https:' ? '; secure' : ''
  const attrs = `; SameSite=Lax; path=/${domainAttr}${secureAttr}`
  // For the twin restore: host-only scope, everything else intact — a bare write dropped SameSite
  // and secure, handing a previously-Secure identity cookie to plain http on the same host.
  const hostOnlyAttrs = `; SameSite=Lax; path=/${secureAttr}`
  // Keys already reconciled against a stale host-only twin this page load (see reconcileTwin).
  const reconciledKeys = new Set<string>()
  // Reconciliation failures already reported. The retry is per access; the warn is not, or a
  // persistently blocked cookie store would warn on every read of every event.
  const twinWarnedKeys = new Set<string>()

  // Failed removals already reported. Latched because remove() is not only a teardown path — the
  // store's dropStale() reaches it from readItem(), which runs on every tracked event. Released by
  // the next confirmed removal: a latch may report once per episode, never outliving its residue.
  const removeFailedKeys = new Set<string>()

  /** One report per key per episode, at error: both arms leave the same identifier on the device. */
  const reportRemoveFailure = (key: string, message: string, err?: unknown): void => {
    if (removeFailedKeys.has(key)) {
      return
    }
    removeFailedKeys.add(key)
    if (err === undefined) {
      log.error(message)
    } else {
      log.error(message, err)
    }
  }

  /**
   * Host-only twins reconcileTwin left in place, keyed name → the twin's *value*.
   *
   * Value, not lifetime: restore recomputes the deadline from the twin's own envelope, so a restored
   * cookie can't outlive its contents. @see docs/design-notes/cookie.md#preserved-twins
   */
  const preservedTwins = new Map<string, string>()

  const writeCookie = (key: string, value: string, maxAgeSeconds: number): boolean => {
    // Hoisted out of the try so the catch can repair the bookkeeping for a throw that landed
    // between consuming the registration and finishing the write.
    let expiredTwin: string | undefined
    try {
      // Inside the try: encodeURIComponent throws on malformed UTF-16, and callers must never throw.
      const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${attrs}; max-age=${maxAgeSeconds}`
      if (encoded.length > MAX_COOKIE_LENGTH) {
        log.warn(`Cookie for "${key}" would exceed ${MAX_COOKIE_LENGTH} chars; skipping cookie write.`)
        return false
      }
      // A preserved twin was created first, so RFC 6265 sorts it ahead in document.cookie and the
      // read-back below would return it, reporting a landed write as failed. Expired only once the
      // replacement is known writable — expired before the checks above, an oversized value
      // destroyed the sole copy. @see docs/design-notes/cookie.md#writecookie-and-the-consumed-twin-repair
      expiredTwin = preservedTwins.get(key)
      if (expiredTwin !== undefined) {
        preservedTwins.delete(key)
        doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
      }
      doc.cookie = encoded
      if (readCookie(doc, key) === value) {
        return true
      }
      // The replacement did not land and the expiry above already destroyed the twin to make room
      // for it — put it back. Cross-subdomain reads have no localStorage fallback.
      if (expiredTwin !== undefined) {
        restoreConsumedTwin(key, expiredTwin)
      }
      return false
    } catch (err) {
      // Restore, not just re-register: the throw may have destroyed the twin or left it physically
      // present but untracked. In its own try — a jar broken enough to throw here usually throws in
      // preserveTwin too, and an escaping throw would break set()'s never-throws contract.
      let twinRecovered = expiredTwin === undefined
      if (expiredTwin !== undefined && !preservedTwins.has(key)) {
        try {
          restoreConsumedTwin(key, expiredTwin)
          twinRecovered = true
        } catch {
          // Jar still refusing writes; the registration stands and the store's read-back reports
          // the failed persist.
        }
      }
      if (twinRecovered) {
        log.debug(`Cookie write for "${key}" threw:`, err)
      } else {
        // Warn, not debug: this write expired a preserved twin to make room for itself, so the sole
        // copy may be gone, and log.debug is off for exactly the person diagnosing it.
        log.warn(
          `Cookie write for "${key}" threw after its host-only twin was expired, and the twin could not be put back; its value may be lost on this device:`,
          err,
        )
      }
      return false
    }
  }

  /**
   * Puts an expired twin back at its own host-only scope. Read-back-verified and reported at error:
   * the twin is already expired by the time this runs, so a restore that also fails destroys what
   * was the sole copy — and cross-subdomain reads have no localStorage fallback.
   * @see docs/design-notes/cookie.md#restores-use-host-only-attributes-not-a-bare-write
   */
  const restoreTwin = (key: string, value: string, maxAgeSeconds: number): void => {
    doc.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${hostOnlyAttrs}; max-age=${maxAgeSeconds}`
    if (readCookie(doc, key) !== value) {
      log.error(`Could not restore the host-only "${key}" cookie; its value may be lost on this device.`)
    }
  }

  /**
   * Registration and restore travel together: a restored twin predates any later shared write, so
   * writeCookie must know to expire it first or that write fails read-back against the twin.
   * @see docs/design-notes/cookie.md#why-registration-and-restore-travel-together
   */
  const preserveTwin = (key: string, value: string, maxAgeSeconds: number): void => {
    preservedTwins.set(key, value)
    restoreTwin(key, value, maxAgeSeconds)
  }

  /**
   * Puts back a twin whose registration `writeCookie` already consumed, recomputing the lifetime
   * from the twin's own envelope rather than replaying a captured figure — replayed, a restored
   * cookie outlived the deadline stamped in the value it carries.
   *
   * An expired twin is deliberately not restored: the expiry already did what its deadline asked.
   * An undecodable one has no deadline and keeps the short fixed window.
   * @see docs/design-notes/cookie.md#preserved-twins
   */
  const restoreConsumedTwin = (key: string, value: string): void => {
    const life = twinLifetime(value)
    if (life === 'expired') {
      return
    }
    preserveTwin(key, value, life === 'undecodable' ? LEGACY_TWIN_RESTORE_SECONDS : life)
  }

  /**
   * A same-named host-only cookie is indistinguishable by name from the shared one and can sort
   * ahead of it, so it shadows the shared value — and a read-then-refresh would copy the stale twin
   * onto the shared cookie and corrupt identity site-wide. Once per key on first access: expire the
   * twin, then see what remains. No-op in host-only mode.
   * @see docs/design-notes/cookie.md#the-twin-protocol
   */
  const reconcileTwin = (key: string): void => {
    if (!domainAttr || reconciledKeys.has(key)) {
      return
    }
    reconciledKeys.add(key)
    try {
      const before = readCookie(doc, key)
      if (before === null) {
        return // nothing present — no twin to reconcile
      }
      doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
      if (readCookie(doc, key) !== null) {
        // Acknowledged blind spot: a jar that no-ops writes leaves the un-expired twin passing this
        // read-back, masquerading as a surviving shared cookie.
        // @see docs/design-notes/cookie.md#acknowledged-blind-spot
        return // a shared cookie survives the host-only expiry and is authoritative — leave it
      }
      // Nothing remains: `before` was a lone host-only twin (a genuine host-only → shared
      // migration), so promote it with the lifetime it has left — a fresh full-length one would
      // outlive its contents.
      const remaining = twinLifetime(before)
      if (remaining === 'expired') {
        // Retention already ended it, and the expiry write above removed it. Nothing to restore.
        return
      }
      if (remaining === 'undecodable') {
        // Never *promoted* — that would widen an identifier nothing can expire — but restored rather
        // than destroyed: what an undecodable value means is the store's call, and getItemOrLegacy
        // hands the consent record's bare value up first.
        preserveTwin(key, before, LEGACY_TWIN_RESTORE_SECONDS)
        return
      }
      // Only the promotion is gated. Everything above is a *deletion*, which no consent state
      // forbids and which configureProfile depends on — it reads external_id once and latches it.
      // @see docs/design-notes/cookie.md#why-the-promotion-is-gated-on-consent-but-the-reconciliation-is-not
      if (!isGranted()) {
        // Latched, not retried: un-latched, every later access repeated the delete-and-restore —
        // an identity Set-Cookie on the read path in the state that promises no device writes.
        preserveTwin(key, before, remaining)
        return
      }
      // On a failed promotion, restore rather than lose the value: cross-subdomain reads don't fall
      // back to localStorage, and the next page load retries.
      if (!writeCookie(key, before, remaining)) {
        preserveTwin(key, before, remaining)
      }
    } catch (err) {
      // Un-latch so the next access retries: latched as done, a stale twin kept shadowing the shared
      // cookie for the whole page load — the exact condition this function exists to prevent.
      reconciledKeys.delete(key)
      if (!twinWarnedKeys.has(key)) {
        twinWarnedKeys.add(key)
        // Covers both outcomes rather than diagnosing shadowing for a loss: a throw before the
        // expiry leaves the twin shadowing; a throw after means its value may be gone.
        log.warn(
          `Cookie twin reconciliation for "${key}" threw; a stale host-only cookie may shadow the shared identity until a retry succeeds, or the twin's value may have been lost mid-reconciliation:`,
          err,
        )
      }
    }
  }

  return {
    crossSubdomain: domainAttr !== '',
    get: key => {
      reconcileTwin(key)
      return readCookie(doc, key)
    },
    set: (key, value, maxAgeSeconds) => {
      reconcileTwin(key)
      return writeCookie(key, value, maxAgeSeconds)
    },
    remove: (key, intent = 'teardown') => {
      try {
        doc.cookie = `${encodeURIComponent(key)}=; path=/${domainAttr}; max-age=0`
        // Also clear a host-only twin so a removed key cannot resurrect from an older scope.
        if (domainAttr) {
          doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
        }
        // Read back: a cookie store blocked mid-session no-ops the assignments above without
        // throwing, so a privacy teardown could otherwise silently fail.
        const gone = readCookie(doc, key) === null
        if (gone) {
          // Consumed only on confirmation — consumed up front, a removal that threw or no-opped left
          // the twin in place but untracked, so a later successful set() failed read-back against
          // it. Clearing the registration is what stops a later failed set() from restoring a twin
          // this teardown removed. @see docs/design-notes/cookie.md#remove-and-the-intent-parameter
          reconciledKeys.add(key)
          preservedTwins.delete(key)
          // Re-arm: a latch may outlive one episode but never the residue it describes.
          removeFailedKeys.delete(key)
          return true
        }
        // Same level and consequence as the catch below — the mechanism of failure does not pick the
        // severity, and callers surface remove() only as an aggregate boolean that can name neither
        // the key nor the layer. Gated on intent so a write cannot spend the teardown's diagnostic.
        if (intent === 'teardown') {
          reportRemoveFailure(key, `The "${key}" cookie survived removal during teardown; the identity may resurface.`)
        }
        return false
      } catch (err) {
        // Error, not debug: log.debug is off for exactly the person diagnosing a failed opt-out, and
        // the whole teardown boolean chain rests on this return value.
        if (intent === 'teardown') {
          reportRemoveFailure(
            key,
            `Failed to remove the "${key}" cookie during teardown; the identity may resurface:`,
            err,
          )
        }
        return false
      }
    },
  }
}
