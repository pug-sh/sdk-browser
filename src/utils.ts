export const DEVICE_ID_KEY = 'pug_device_id'

/**
 * Reserved by the server for the daily-rotating ids it derives for cookieless events, enforced by
 * the `batch.distinct_id_reserved_prefix` CEL rule over the whole BatchCreateRequest.
 *
 * Shared by `identify()` (which rejects it as input) and `configureProfile()` (which rejects it on
 * restore): a device poisoned before the input check existed would otherwise keep replaying it.
 */
export const RESERVED_DISTINCT_ID_PREFIX = 'cookieless-'

/** Default backend base URL used when `init()` is called without an explicit `endpoint`. */
export const DEFAULT_ENDPOINT = 'https://api.pugs.dev'

export const makeStorageKey = (projectId: string, name: string): string => `__pug_${projectId}_${name}__`

export const SECONDS_PER_DAY = 24 * 60 * 60

/** Default retention for anything the SDK stores on the device; override with `init({ maxAgeDays })`. */
export const DEFAULT_MAX_AGE_DAYS = 365

/**
 * The retention envelope every persisted value is wrapped in: `<expiry epoch ms>|<value>`. The
 * deadline is stamped once, at the first write, so refreshing a value cannot extend how long it is
 * kept — localStorage has no expiry of its own, so without this the default install kept identity
 * forever.
 *
 * Lives in this import-free module rather than `persistence.ts`, which owns the layering: the suites
 * that assert against raw storage need to spell the format, and importing it from there would drag
 * `logger.js` into each of them, where a `vi.mock` factory is hoisted above its own spies.
 */
export const encodeStored = (value: string, expiresAt: number): string => `${expiresAt}|${value}`

export const decodeStored = (raw: string | null): { value: string; expiresAt: number } | null => {
  if (raw === null) {
    return null
  }
  // A bare value from an older build has no separator and reads as absent — the pre-1.0 migration.
  const separator = raw.indexOf('|')
  if (separator <= 0) {
    return null
  }
  const expiresAt = Number(raw.slice(0, separator))
  return Number.isFinite(expiresAt) ? { value: raw.slice(separator + 1), expiresAt } : null
}

/**
 * Query params whose values are redacted out of captured URLs by default: credentials and direct
 * identifiers that ride reset links, magic links and OAuth callbacks. Without this, PII reaches
 * analytics because of how a URL was built, not because anyone decided to collect it.
 */
const DEFAULT_REDACTED_URL_PARAMS = [
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'code',
  'email',
  'id_token',
  'otp',
  'passwd',
  'password',
  'phone',
  'pwd',
  'refresh_token',
  'secret',
  'sig',
  'signature',
  'ssn',
  'token',
] as const

const REDACTED = 'redacted'

const DEFAULT_REDACTED_SET: ReadonlySet<string> = new Set(DEFAULT_REDACTED_URL_PARAMS)

// null disables redaction entirely.
let redactedParams: ReadonlySet<string> | null = DEFAULT_REDACTED_SET

/**
 * Wired from `init({ redactUrlParams })`: `undefined` restores the default list, `false` disables
 * redaction, an array replaces the list. `init()` validates the untrusted value first (this module
 * stays free of imports so test suites can mock the logger).
 */
export const configureUrlRedaction = (params?: readonly string[] | false): void => {
  // Re-defends what init() already validated: this module must never throw, and a one-tag install
  // can reach init() with anything.
  redactedParams =
    params === false
      ? null
      : !Array.isArray(params)
        ? DEFAULT_REDACTED_SET
        : new Set(params.map(p => String(p).toLowerCase()))
}

/** Redacts matching params in a query string; null when nothing matched (leave the original alone). */
const redactQuery = (query: string): string | null => {
  const params = new URLSearchParams(query)
  let changed = false
  // Iterated live, no array copy: set() replaces the pair at the cursor in place and only splices
  // away *later* duplicates of the same name, so no distinct key is skipped (fuzzed over 50k
  // query strings against a copying implementation, 0 divergences).
  for (const key of params.keys()) {
    if (redactedParams?.has(key.toLowerCase())) {
      params.set(key, REDACTED)
      changed = true
    }
  }
  return changed ? params.toString() : null
}

/**
 * Fragments are never sent to a server by the browser, but they are part of location.href — so an
 * implicit-flow `#access_token=…` would reach the backend through analytics and nothing else.
 * Null when nothing matched, matching redactQuery, so the caller has one "unchanged" protocol.
 */
const redactFragment = (fragment: string): string | null => {
  const queryStart = fragment.indexOf('?')
  // A hash route's query (#/orders?token=…) or a bare implicit-flow fragment (#access_token=…);
  // anything else has no `=` and carries no param. Deliberately not also skipping on '/': a
  // route-shaped *value* like `&state=/dashboard` is the ordinary shape of an OIDC callback, so
  // that guard disabled redaction in exactly the case this exists for.
  if (queryStart < 0 && !fragment.includes('=')) {
    return null
  }
  // slice(0, 0) / slice(0) when there is no '?', so both shapes share one path.
  const redacted = redactQuery(fragment.slice(queryStart + 1))
  return redacted === null ? null : `${fragment.slice(0, queryStart + 1)}${redacted}`
}

/**
 * Redacts sensitive query/fragment params out of a captured URL. Never throws; returns the input
 * unchanged when nothing matched, so URLs are not re-encoded for no reason.
 */
export const scrubUrl = (raw: string): string => {
  if (!redactedParams || !raw || (!raw.includes('?') && !raw.includes('#'))) {
    return raw
  }
  try {
    // No base URL: the three inputs are always absolute, and resolving a relative one would rewrite
    // it into something the page never navigated to.
    const url = new URL(raw)
    const hash = url.hash.slice(1)
    const query = url.search ? redactQuery(url.search.slice(1)) : null
    const fragment = hash ? redactFragment(hash) : null
    if (query === null && fragment === null) {
      return raw
    }
    if (query !== null) {
      url.search = query
    }
    if (fragment !== null) {
      url.hash = fragment
    }
    return url.toString()
  } catch {
    return raw
  }
}

/**
 * True when `el` or any ancestor carries `data-pug-no-capture` — the marker integrators put on
 * sensitive DOM regions, covering everything inside it.
 *
 * Only free *text* is redacted; structural fields (`id`, `class`, `tag`, coordinates) are still sent
 * so the interaction keeps counting, so keep PII out of `id`/`class`.
 */
export const isCaptureSuppressed = (el: Element | null): boolean => !!el?.closest('[data-pug-no-capture]')

/**
 * `<textarea>` content is a child text node and `contenteditable` is user input; both are skipped.
 * `contenteditable` is inherited and editors put it on a root the pointer never hits, so this walks
 * to the nearest declaring ancestor. Not `isContentEditable` — jsdom leaves it undefined.
 */
const holdsUserEnteredText = (el: Element): boolean => {
  if (el.tagName === 'TEXTAREA') {
    return true
  }
  const editableHost = el.closest('[contenteditable]')
  return editableHost !== null && editableHost.getAttribute('contenteditable') !== 'false'
}

/**
 * The element's own text, capped at `maxLength` — direct child text nodes only, never the subtree.
 * `innerText`/`textContent` return every descendant's, so clicking a card sent every name and email
 * it wrapped, and a `data-pug-no-capture` marker on the sensitive leaf never ran.
 */
export const getSafeElementText = (el: Element | null, maxLength: number): string => {
  if (!el || isCaptureSuppressed(el) || holdsUserEnteredText(el)) {
    return ''
  }
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      // Collapsed as we go so the bail is exact — appending never alters the trimmed prefix.
      text = `${text}${node.nodeValue ?? ''}`.replace(/\s+/g, ' ')
      if (text.trim().length >= maxLength) {
        break
      }
    }
  }
  // trimEnd after the cut — truncating mid-gap would otherwise re-expose interior whitespace.
  return text.trim().substring(0, maxLength).trimEnd()
}

export const urlBase64ToUint8Array = (base64String: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const bytes = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i)
  }
  return bytes
}

export const isStorageAvailable = (): boolean => {
  try {
    const s = localStorage
    const key = makeStorageKey('_', 'probe')
    s.setItem(key, '1')
    s.removeItem(key)
    return true
  } catch {
    return false
  }
}
