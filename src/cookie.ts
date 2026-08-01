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
// `domain` is required, so `{}` cannot opt into cross-subdomain identity without stating it — which
// a config builder spreading unset optionals produces by accident. `maxAgeDays?: never` closes the
// removed lifetime arm for variables and spreads too (excess-property checks guard only fresh
// literals — the EventIdentity pattern): held in a config builder, the old documented shape
// otherwise compiled while resolveIntent silently swapped its shortened lifetime for the 365-day
// default.
export type CrossSubdomainConfig = boolean | { readonly domain: string; readonly maxAgeDays?: never }

/** Minimal document surface the cookie layer needs — injectable so tests can target other origins. */
export interface CookieDocument {
  cookie: string
  readonly location: { readonly hostname: string; readonly protocol: string }
}

export interface CookieLayer {
  get(name: string): string | null
  /**
   * Returns true only when the write verifiably landed (read-back matches). `maxAgeSeconds` is the
   * value's remaining lifetime, so the cookie disappears on the same deadline as its contents.
   *
   * Required, not optional: the store owns retention, and a defaulted argument would silently give
   * a cookie a lifetime nobody chose — the same silent-default shape the `isGranted` gates were made
   * required to close. No write site in this module defaults it either.
   *
   * `value` is the *enveloped* stored string (`StoredEnvelope`, minted by `encodeStored`), never a
   * bare value: reads prefer this layer, and a bare value written here reads as undecodable and is
   * deleted by the store's next getItem — silent identity loss the brand makes a compile error.
   */
  set(name: string, value: StoredEnvelope, maxAgeSeconds: number): boolean
  /** Returns true only when the key is verifiably gone (read-back is null). */
  remove(name: string): boolean
  /** True when the cookie is scoped to a shared domain and therefore visible across subdomains. */
  readonly crossSubdomain: boolean
}

/**
 * What a twin's own stored value says should happen to it: the seconds it has left, `'expired'`
 * (retention already ended it), or `'undecodable'` — pre-envelope or corrupt, which only the store
 * can interpret. The two terminal outcomes were one `null` before, which conflated "retention says
 * drop this" with "this layer cannot read it" and let the second be destroyed on the first's
 * reasoning.
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
 * How long an undecodable twin is put back for. It exists only to survive until the store's read on
 * this same call, which removes it — long enough to absorb a slow page, short enough that a value
 * with no deadline of its own cannot linger if that read never comes.
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
 * first accepted candidate is the answer. No bundled suffix list needed — the browser's own is
 * authoritative. Returns '' when nothing is accepted (caller falls back to a host-only cookie).
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
 * `data-options` JSON that no compiler ever sees.
 *
 * Three reachable shapes used to auto-discover: `{}` (a config builder spreading unset optionals),
 * `{ maxAgeDays: 30 }` left by an upgrade from the removed lifetime arm, and a stringly-typed
 * `"true"`/`"false"` from an HTML template — where `"false"` therefore *enabled* it. Resolving "no
 * domain" to the widest settable one infers exactly the opt-in the threat model's §7 requires to be
 * stated, so only a literal `true` reaches the probe.
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
    // The stated domain carries the opt-in, so extra keys do not disable it — but they must not be
    // silent either: `{ domain, maxAgeDays }` is the documented pre-hoist shape, and swallowing the
    // key replaced a deliberately shortened lifetime with the 365-day default. Keys holding
    // `undefined` are exempt: a builder spreading an unset legacy optional produces
    // `{ domain, maxAgeDays: undefined }`, which configures nothing worth warning about.
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
 * head guard on an omitted consent gate: internal misuse, which must fail loud at creation rather
 * than reach the twin machinery.
 */
export const createCookieLayer = (
  config: CrossSubdomainConfig,
  // Gates the twin promotion in reconcileTwin() — the one identity *write* on the read path, and so
  // the one that escaped every other consent check. Required: the arity pin in
  // consent-gate.test-d.ts turns a typed omission into a build failure; the head guard below is
  // for callers typecheck never sees.
  isGranted: GrantedGate,
  doc: CookieDocument | null = typeof document === 'undefined' ? null : document,
): CookieLayer | null => {
  // Fail loud at the head, uniformly with configureProfile and configureSession. At the head rather
  // than at the point of use because an unguarded gate is first *called* inside reconcileTwin's try,
  // after the live twin has already been expired — so the misuse destroyed a value and surfaced only
  // as a once-per-key warn. init() routes the throw through reportInitFailure, which reports a
  // TypeError at error level rather than as an environment failure.
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
    // Multi-tenant PaaS hosts (herokuapp.com, vercel.app, …) need no special-casing: their shared
    // suffix is a public suffix the browser rejects, so the widest-first probe lands on the
    // tenant's own host — never a domain a sibling tenant could read.
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
  // Keys whose reconciliation failure was already reported — the retry is per access, the warn is
  // not, or a persistently blocked cookie store would warn on every read of every event.
  const twinWarnedKeys = new Set<string>()

  // Keys whose failed removal was already reported. Latched because remove() is not only a teardown
  // path: the store's dropStale() calls it from readItem(), which the session read runs on every
  // tracked event, so a value that keeps refusing to leave would report once per event for the life
  // of the page. Released by the next confirmed removal — once per episode, never outliving the
  // residue it describes, matching the latches in persistence.ts.
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

  // Keys whose host-only twin reconcileTwin deliberately left in place (its not-granted arm), with
  // what putting it back requires: a later set() whose replacement write fails must *restore* the
  // twin, not merely know it existed, so the value rides the registration.
  //
  // The value alone, not a captured lifetime: the twin's own envelope already states its deadline,
  // and recomputing from it at restore time is what keeps a restored cookie from outliving the value
  // it holds. A figure captured when the twin was first preserved goes stale on a long-lived page —
  // preserved with R seconds left and restored at R−10, it was written back with a fresh max-age=R.
  const preservedTwins = new Map<string, string>()

  const writeCookie = (key: string, value: string, maxAgeSeconds: number): boolean => {
    // Hoisted out of the try so the catch can repair the bookkeeping for a throw that landed
    // between consuming the registration and finishing the write.
    let expiredTwin: string | undefined
    try {
      // encodeURIComponent stays inside the try — it throws on malformed UTF-16 (lone surrogates),
      // and callers must never throw.
      const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${attrs}; max-age=${maxAgeSeconds}`
      if (encoded.length > MAX_COOKIE_LENGTH) {
        log.warn(`Cookie for "${key}" would exceed ${MAX_COOKIE_LENGTH} chars; skipping cookie write.`)
        return false
      }
      // A preserved twin is superseded by the value about to be written, and it was created first,
      // so RFC 6265 sorts it ahead of the shared cookie in document.cookie — the read-back below
      // would return the twin and report a landed write as failed. Expired only once the
      // replacement is known writable: expired before the checks above, an oversized or
      // unencodable value destroyed the sole copy (cross-subdomain reads have no localStorage
      // fallback) and returned false with nothing in its place.
      expiredTwin = preservedTwins.get(key)
      if (expiredTwin !== undefined) {
        preservedTwins.delete(key)
        doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
      }
      doc.cookie = encoded
      if (readCookie(doc, key) === value) {
        return true
      }
      // The replacement did not land (a cookie store blocked mid-session, read-back mismatch), and
      // the expiry above already destroyed the twin to make room for it — put it back, mirroring
      // reconcileTwin's failed-promotion arm. For the consent record — whose restore write is the
      // first set() after a preserving reconcile — returning false with the twin gone reverted a
      // recorded refusal to the config seed on the next init().
      if (expiredTwin !== undefined) {
        restoreConsumedTwin(key, expiredTwin)
      }
      return false
    } catch (err) {
      // A throw after the registration was consumed may have destroyed the twin (the expiry
      // landed, then the encoded write threw) or left it physically present but untracked (the
      // expiry write itself threw). Restore, not just re-register — the same loss the read-back
      // path above repairs — but in its own try: a jar broken enough to throw here usually throws
      // in preserveTwin too, and a throw escaping this catch would break set()'s never-throws
      // contract. preserveTwin registers before it writes, so even a failed attempt leaves the
      // bookkeeping consistent, and a stale entry costs one harmless extra expiry write later.
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
        // Warn, not debug: this write expired a preserved twin to make room for itself, so a throw
        // here can leave the sole copy gone — cross-subdomain reads have no localStorage fallback.
        // `log.debug` is off unless the integrator already set `debug: true`, making the loss
        // invisible to exactly the person diagnosing it; the same argument put remove()'s catch at
        // error. The read-back path's equivalent failure already reports through restoreTwin.
        log.warn(
          `Cookie write for "${key}" threw after its host-only twin was expired, and the twin could not be put back; its value may be lost on this device:`,
          err,
        )
      }
      return false
    }
  }

  /**
   * Puts an expired twin back at its own host-only scope — `hostOnlyAttrs`, not a bare write, which
   * dropped SameSite and secure and handed a previously-Secure identity cookie to plain http.
   * Read-back-verified and warned on: the twin is already expired by the time this runs, so a
   * restore that also fails destroys what was the sole copy.
   */
  const restoreTwin = (key: string, value: string, maxAgeSeconds: number): void => {
    doc.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${hostOnlyAttrs}; max-age=${maxAgeSeconds}`
    if (readCookie(doc, key) !== value) {
      // Error, not warn: this only ever runs in cross-subdomain mode, where the twin was the sole
      // copy and reads have no localStorage fallback to drop to — a confirmed loss, which is how
      // clearProfile() reports the analogous outcome. Nothing downstream can tell: get() returns
      // void-typed reconciliation followed by a plain miss, which the store reads as an authoritative
      // deletion and answers by sweeping the localStorage mirror too.
      log.error(`Could not restore the host-only "${key}" cookie; its value may be lost on this device.`)
    }
  }

  /**
   * Registration and restore travel together: a restored twin predates any later shared write for
   * its key, so RFC 6265 sorts it ahead in document.cookie and writeCookie must know to expire it
   * first — a restore without the registration makes that later write fail read-back against the
   * twin and report a landed write as lost. The registration carries the twin's *value*, so the
   * reverse move — a consumed registration whose replacement write then fails — can put the twin
   * back rather than merely remember that one existed. Not its lifetime: see `preservedTwins`, where
   * `restoreConsumedTwin` recomputes that from the value's own envelope at restore time.
   */
  const preserveTwin = (key: string, value: string, maxAgeSeconds: number): void => {
    preservedTwins.set(key, value)
    restoreTwin(key, value, maxAgeSeconds)
  }

  /**
   * Puts back a twin whose registration `writeCookie` already consumed, recomputing the lifetime from
   * the twin's own envelope instead of replaying a figure captured when it was first preserved.
   * Replayed, a twin preserved early in a long-lived page and restored much later got a fresh
   * full-length `max-age` and outlived the deadline stamped in the value it carries — contradicting
   * `CookieLayer.set`'s "the cookie expires with the value it holds". Not a leak, since the envelope
   * still governs what the store reads, but the physical cookie outlived its own deadline.
   *
   * A twin whose retention ended in the meantime is deliberately *not* restored: the expiry write
   * already removed it, which is exactly what its deadline asks for. An undecodable one has no
   * deadline to recompute and keeps the short fixed window, as when it was first preserved.
   */
  const restoreConsumedTwin = (key: string, value: string): void => {
    const life = twinLifetime(value)
    if (life === 'expired') {
      return
    }
    preserveTwin(key, value, life === 'undecodable' ? LEGACY_TWIN_RESTORE_SECONDS : life)
  }

  /**
   * A same-named host-only cookie is indistinguishable by name from the shared one in
   * document.cookie and can sort ahead of it, so it shadows the shared value — and a read-then-
   * refresh (getAnonymousId, session activity) would copy the stale twin onto the shared cookie and
   * corrupt identity site-wide. Once per key on first access: expire the twin, then see what
   * remains. No-op in host-only mode, where there is no shared cookie to shadow.
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
        // Acknowledged blind spot: a jar that silently no-ops writes leaves the un-expired twin
        // itself passing this read-back, masquerading as a surviving shared cookie — latched, with
        // the twin still shadowing. Undetectable here without a probe write, which the denied-
        // consent read path must not issue; the fault surfaces at the next write's read-back.
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
        // Pre-envelope or corrupt. Never *promoted* — that would widen an identifier nothing can
        // expire — but restored rather than left destroyed, because what an undecodable value means
        // is the store's call, not this layer's: it removes one on sight, and `getItemOrLegacy`
        // hands the consent record's bare value up first. Destroyed here, that read saw nothing and
        // a recorded refusal silently reverted to the config seed. Short-lived, because the store
        // deletes it on the very read that follows.
        preserveTwin(key, before, LEGACY_TWIN_RESTORE_SECONDS)
        return
      }
      // Only the promotion is gated, not the whole reconciliation: everything above is a *deletion*
      // (expiring a stale twin so it cannot shadow the shared cookie on reads), which no consent
      // state forbids and which configureProfile depends on — it reads external_id once and latches
      // the result for the page. The promotion is different: it widens identity to the registrable
      // domain, so while consent withholds identity storage the twin goes back at its existing
      // host-only scope, leaving the device exactly as it was.
      if (!isGranted()) {
        // Latched, not retried: un-latched, every later get()/set() repeated this delete-and-restore
        // — measured at 10 cookie writes across 5 reads, i.e. an identity Set-Cookie on the read
        // path in the state that promises no device writes. A grant later in the same page migrates
        // on the next page load instead, which costs nothing real: external_id, the key that
        // motivated the gate, is read once by configureProfile and latched into module state, so
        // nothing re-reads it through the store anyway.
        preserveTwin(key, before, remaining)
        return
      }
      // On a failed promotion, restore rather than lose the value: cross-subdomain reads don't fall
      // back to localStorage, and the next page load retries.
      if (!writeCookie(key, before, remaining)) {
        preserveTwin(key, before, remaining)
      }
    } catch (err) {
      // Un-latch so the next access retries: latched as done, a stale twin kept shadowing the
      // shared cookie for the whole page load — the exact condition this function exists to
      // prevent. Warn (every install sees it), not debug, and once per key rather than per access.
      reconciledKeys.delete(key)
      if (!twinWarnedKeys.has(key)) {
        twinWarnedKeys.add(key)
        // Two outcomes share this catch: a throw before the expiry leaves the stale twin
        // shadowing (the retry heals it); a throw after — inside the restore, or the documented
        // omitted-gate misuse before the head guard existed — means the twin was already expired
        // and its value may be gone, with nothing left to shadow anything. The message covers
        // both rather than diagnosing shadowing for a loss.
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
    remove: key => {
      try {
        doc.cookie = `${encodeURIComponent(key)}=; path=/${domainAttr}; max-age=0`
        // Also clear a host-only twin so a removed key cannot resurrect from an older scope.
        if (domainAttr) {
          doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
        }
        // Read back and report whether the key is actually gone. A cookie store blocked mid-session
        // no-ops the assignments above without throwing, so a privacy teardown (opt-out/reset) could
        // otherwise silently fail and let the shared identity cookie resurface on the next read.
        const gone = readCookie(doc, key) === null
        if (gone) {
          // After a confirmed remove there is no twin left worth reconciling — or clearing — later.
          // Consumed only on that confirmation: consumed up front, a removal that threw or no-opped
          // left the twin in place but untracked, so a later successful set() failed read-back
          // against it. Unconsumed, a key this call is the first to touch stays un-latched and the
          // next access reconciles the leftover; a key an earlier read already latched keeps its
          // preservedTwins registration instead, which writeCookie expires ahead of its own write.
          // Clearing the registration here is what stops a later failed set() from restoring a twin
          // this teardown removed — an identifier coming back after opt-out reported success.
          reconciledKeys.add(key)
          preservedTwins.delete(key)
          // Re-arm: a latch may outlive one episode but never the residue it describes.
          removeFailedKeys.delete(key)
          return true
        }
        // Same level and same consequence as the catch below — the mechanism of failure does not
        // pick the severity, and a store blocked mid-session no-ops the assignments above without
        // throwing. Silent, this was the one teardown failure with no diagnostic anywhere: callers
        // surface remove() only as an aggregate boolean (clearProfile, clearSession, the store's
        // removeItem), none of which can name the key or say which layer kept the value.
        reportRemoveFailure(key, `The "${key}" cookie survived removal during teardown; the identity may resurface.`)
        return false
      } catch (err) {
        // Error, not debug: `log.debug` is off unless the integrator already set `debug: true`, so
        // the reason was invisible to exactly the person diagnosing a failed opt-out. The whole
        // teardown boolean chain rests on this return value.
        reportRemoveFailure(
          key,
          `Failed to remove the "${key}" cookie during teardown; the identity may resurface:`,
          err,
        )
        return false
      }
    },
  }
}
