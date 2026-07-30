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
 * can interpret. The three were one `null` before, which conflated "retention says drop this" with
 * "this layer cannot read it" and let the second be destroyed on the first's reasoning.
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
 * config or unavailable (blocked, sandboxed frame, non-browser environment). All failures degrade
 * to localStorage-only persistence — never throws.
 */
export const createCookieLayer = (
  config: CrossSubdomainConfig,
  // Gates the twin promotion in reconcileTwin() — the one identity *write* on the read path, and so
  // the one that escaped every other consent check. Required: unlike session.ts, an absent gate
  // here throws inside reconcileTwin's try and silently un-latches rather than defaulting either
  // way, so the arity pin in consent-gate.test-d.ts is the only thing that catches the omission.
  isGranted: GrantedGate,
  doc: CookieDocument | null = typeof document === 'undefined' ? null : document,
): CookieLayer | null => {
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

  // Keys whose host-only twin reconcileTwin deliberately left in place (its not-granted arm).
  const preservedTwins = new Set<string>()

  const writeCookie = (key: string, value: string, maxAgeSeconds: number): boolean => {
    try {
      // A preserved twin is superseded by the value about to be written, and it was created first,
      // so RFC 6265 sorts it ahead of the shared cookie in document.cookie — the read-back below
      // would return the twin and report a landed write as failed.
      if (preservedTwins.delete(key)) {
        doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
      }
      // encodeURIComponent stays inside the try — it throws on malformed UTF-16 (lone surrogates),
      // and callers must never throw.
      const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${attrs}; max-age=${maxAgeSeconds}`
      if (encoded.length > MAX_COOKIE_LENGTH) {
        log.warn(`Cookie for "${key}" would exceed ${MAX_COOKIE_LENGTH} chars; skipping cookie write.`)
        return false
      }
      doc.cookie = encoded
      return readCookie(doc, key) === value
    } catch (err) {
      log.debug(`Cookie write for "${key}" threw:`, err)
      return false
    }
  }

  // A same-named host-only cookie is indistinguishable by name from the shared one in
  // document.cookie and can sort ahead of it, so it shadows the shared value — and a read-then-
  // refresh (getAnonymousId, session activity) would copy the stale twin onto the shared cookie and
  // corrupt identity site-wide. Once per key on first access: expire the twin, then see what
  // remains. No-op in host-only mode, where there is no shared cookie to shadow.
  /**
   * Puts an expired twin back at its own host-only scope — `hostOnlyAttrs`, not a bare write, which
   * dropped SameSite and secure and handed a previously-Secure identity cookie to plain http.
   * Read-back-verified and warned on: the twin is already expired by the time this runs, so a
   * restore that also fails destroys what was the sole copy.
   */
  const restoreTwin = (key: string, value: string, maxAgeSeconds: number): void => {
    doc.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${hostOnlyAttrs}; max-age=${maxAgeSeconds}`
    if (readCookie(doc, key) !== value) {
      log.warn(`Could not restore the host-only "${key}" cookie; its value may be lost on this device.`)
    }
  }

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
        preservedTwins.add(key)
        restoreTwin(key, before, LEGACY_TWIN_RESTORE_SECONDS)
        return
      }
      // Only the promotion is gated, not the whole reconciliation: everything above is a *deletion*
      // (expiring a stale twin so it cannot shadow the shared cookie on reads), which no consent
      // state forbids and which configureProfile depends on — it reads external_id once and latches
      // the result for the page. The promotion is different: it widens identity to the registrable
      // domain, so while consent withholds identity storage the twin goes back at its existing
      // host-only scope, leaving the device exactly as it was. Un-latched, so a mid-page grant
      // migrates on the next access rather than waiting for the next page load.
      if (!isGranted()) {
        // Latched, not retried: un-latched, every later get()/set() repeated this delete-and-restore
        // — measured at 10 cookie writes across 5 reads, i.e. an identity Set-Cookie on the read
        // path in the state that promises no device writes. A grant later in the same page migrates
        // on the next page load instead, which costs nothing real: external_id, the key that
        // motivated the gate, is read once by configureProfile and latched into module state, so
        // nothing re-reads it through the store anyway.
        preservedTwins.add(key)
        restoreTwin(key, before, remaining)
        return
      }
      // On a failed promotion, restore rather than lose the value: cross-subdomain reads don't fall
      // back to localStorage, and the next page load retries.
      if (!writeCookie(key, before, remaining)) {
        restoreTwin(key, before, remaining)
      }
    } catch (err) {
      // Un-latch so the next access retries: latched as done, a stale twin kept shadowing the
      // shared cookie for the whole page load — the exact condition this function exists to
      // prevent. Warn (every install sees it), not debug, and once per key rather than per access.
      reconciledKeys.delete(key)
      if (!twinWarnedKeys.has(key)) {
        twinWarnedKeys.add(key)
        log.warn(
          `Cookie twin reconciliation for "${key}" threw; a stale host-only cookie may shadow the shared identity until it succeeds:`,
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
      // After an explicit remove there is no twin left worth reconciling — or clearing — later.
      reconciledKeys.add(key)
      preservedTwins.delete(key)
      try {
        doc.cookie = `${encodeURIComponent(key)}=; path=/${domainAttr}; max-age=0`
        // Also clear a host-only twin so a removed key cannot resurrect from an older scope.
        if (domainAttr) {
          doc.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
        }
        // Read back and report whether the key is actually gone. A cookie store blocked mid-session
        // no-ops the assignments above without throwing, so a privacy teardown (opt-out/reset) could
        // otherwise silently fail and let the shared identity cookie resurface on the next read.
        return readCookie(doc, key) === null
      } catch (err) {
        // Error, not debug: `log.debug` is off unless the integrator already set `debug: true`, so
        // the reason was invisible to exactly the person diagnosing a failed opt-out. The whole
        // teardown boolean chain rests on this return value.
        log.error(`Failed to remove the "${key}" cookie during teardown; the identity may resurface:`, err)
        return false
      }
    },
  }
}
