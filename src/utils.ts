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

/**
 * Default retention for values persisted through the `PersistentStore`; override with
 * `init({ maxAgeDays })`. Not everything on the device: the batch queue, the tab registry and
 * `pug_device_id` stay on raw localStorage outside the store — the `maxAgeDays` JSDoc in `pug.ts`
 * names all three and why.
 */
export const DEFAULT_MAX_AGE_DAYS = 365

/**
 * An enveloped stored string, as opposed to a bare value. The brand keeps the two apart at the
 * persistence↔cookie seam: `CookieLayer.set()` and the store's localStorage write accept only
 * enveloped strings, because a bare value written through either reads as undecodable and is
 * deleted by the store's next `getItem` — silent identity loss with no compile error. Reads stay
 * unbranded (`string`): what comes back off the device is not trustworthy enough to carry the brand.
 */
export type StoredEnvelope = string & { readonly __envelope: true }

/**
 * Wraps a value in the retention envelope every persisted value carries:
 * `<expiry epoch ms>|<value>`. The deadline is stamped once, at the first write, so refreshing a
 * value cannot extend how long it is kept — localStorage has no expiry of its own, so without this
 * the default install kept identity forever.
 *
 * The codec lives in this import-free module rather than in `persistence.ts`, which owns the
 * layering: the suites that assert against raw storage need to spell the format, and importing it
 * from there would drag `logger.js` into each of them, where a `vi.mock` factory is hoisted above
 * its own spies.
 */
export const encodeStored = (value: string, expiresAt: number): StoredEnvelope =>
  // Clamped so the brand cannot outrun the decoder. A non-finite deadline stamps `NaN|v` or
  // `Infinity|v` — branded, and rejected by decodeStored — which readItem then reads as a
  // *pre-envelope* value, so getItemOrLegacy would hand a corrupt write back as a recorded consent
  // choice. 0 rather than a throw or a silent skip: this module imports nothing (no logger), the
  // callers promise not to throw, and an already-expired stamp is dropped on the next read, which
  // is what the undecodable value did anyway. The unsafe direction would be never expiring.
  `${Number.isFinite(expiresAt) ? expiresAt : 0}|${value}` as StoredEnvelope

/** Unwraps `encodeStored`'s envelope; null for a bare pre-envelope value or a malformed one. */
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
  // can reach init() with anything. An empty array falls back to the default list too — an empty
  // Set is truthy and matches nothing, so [] would disable redaction exactly like `false` but
  // silently. init() owns the warning for that case; this module imports nothing and cannot log.
  redactedParams =
    params === false
      ? null
      : !Array.isArray(params) || params.length === 0
        ? DEFAULT_REDACTED_SET
        : new Set(params.map(p => String(p).toLowerCase()))
}

// The `_token` suffix rides the default list only: a replacement list is the integrator's exact
// statement, and widening it behind their back would redact params they deliberately kept. The
// suffix catches the framework-generated reset-link names (reset_password_token,
// confirmation_token, invite_token, …) no finite list keeps up with.
const isRedactedKey = (lowerKey: string): boolean =>
  redactedParams !== null &&
  (redactedParams.has(lowerKey) || (redactedParams === DEFAULT_REDACTED_SET && lowerKey.endsWith('_token')))

/** Redacts matching params in a query string; null when nothing matched (leave the original alone). */
const redactQuery = (query: string): string | null => {
  const params = new URLSearchParams(query)
  let changed = false
  // Iterated live, no array copy: set() replaces the pair at the cursor in place and only splices
  // away *later* duplicates of the same name, so no distinct key is skipped (fuzzed over 50k
  // query strings against a copying implementation, 0 divergences).
  for (const key of params.keys()) {
    if (isRedactedKey(key.toLowerCase())) {
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
 * String-level redaction for input `new URL` cannot parse: split at the first `#`, then the first
 * `?` before it, and run the same matchers over the slices. This is the fail-closed arm of
 * scrubUrl — a privacy control must not fail toward leaking, so a URL too malformed to parse
 * (a form's `action` with a template bug in the host, handed over as raw attribute text) still has
 * its params redacted rather than passing through carrying a live token. Shares redactQuery /
 * redactFragment and their null "unchanged" protocol, so a no-match input stays byte-identical.
 */
const scrubOpaque = (raw: string): string => {
  const hashAt = raw.indexOf('#')
  const head = hashAt < 0 ? raw : raw.slice(0, hashAt)
  const fragment = hashAt < 0 ? null : raw.slice(hashAt + 1)
  const queryAt = head.indexOf('?')
  const query = queryAt < 0 ? null : redactQuery(head.slice(queryAt + 1))
  const frag = fragment ? redactFragment(fragment) : null
  if (query === null && frag === null) {
    return raw
  }
  const newHead = query === null ? head : `${head.slice(0, queryAt + 1)}${query}`
  return fragment === null ? newHead : `${newHead}#${frag ?? fragment}`
}

/**
 * Redacts sensitive query/fragment params out of a captured URL. Never throws; returns the input
 * unchanged when nothing matched, so URLs are not re-encoded for no reason.
 */
export const scrubUrl = (raw: string): string => {
  // `typeof` first: DOM-derived input is not reliably a string — a form control named "action"
  // shadows `form.action` with the element itself — and the `includes` probes sit outside the try.
  if (typeof raw !== 'string' || !redactedParams || !raw || (!raw.includes('?') && !raw.includes('#'))) {
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
    // Unparseable is not a pass: fall back to string-level redaction. The nested guard keeps the
    // never-throws promise ranked above fail-closed if both are ever threatened at once.
    try {
      return scrubOpaque(raw)
    } catch {
      return raw
    }
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

/**
 * JSON.stringify for log interpolation of untrusted values — the values being *rejected* are
 * exactly the ones most likely to make JSON.stringify itself throw (circular refs, bigint, a
 * throwing toJSON), which turned a validation warning into an exception out of the validator.
 * Never throws; JSON.stringify's `undefined` results (undefined itself, functions, symbols) fall
 * through to String() rather than interpolating as the literal text "undefined" of a missing value.
 */
export const safeStringify = (value: unknown): string => {
  // Ahead of JSON.stringify, which maps these to the *string* "null" rather than to undefined, so
  // the fallback below never saw them. Every caller is interpolating a value it is rejecting, and
  // `Infinity` — what JSON.parse gives for a `1e999` in data-options JSON — is named by hand in
  // batch's validator as the value that disabled the queue bound. Reported as "null" it named the
  // other documented rejection instead.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '[unrepresentable]'
    }
  }
}

// Shared by the probe-key writer and the sweep below so the two cannot drift; same shape
// makeStorageKey('_', 'probe_…') produced, stated once. The leading timestamp is what lets the
// sweep judge staleness without reading a value.
const PROBE_KEY_PREFIX = '__pug___probe_'
// Far beyond a probe's real lifetime (sub-millisecond): anything older was stranded by a failed
// removal, not left by a probe in flight.
const PROBE_STALE_MS = 5000

/**
 * The probe key an earlier call wrote and could not remove, reused by every later probe for as long
 * as it survives. **This — not the sweep below — is what bounds probe residue**, since the sweep
 * removes through the same failing `removeItem`.
 *
 * Reuse cannot collide across tabs: each minted its own key before stranding it. What it *does*
 * expose is residue at the same key from this tab's earlier failure, which is why the probe writes a
 * fresh token per call rather than a constant.
 *
 * Cleared by the first removal that lands, so a store that recovers returns to per-call keys.
 * @see docs/design-notes/utils.md#storage-probe
 */
let strandedProbeKey: string | null = null

/**
 * Reclaims probe keys stranded by earlier failed removals. Effective only *after* a store recovers.
 *
 * Only demonstrably stale keys are swept: a fresh sibling may be another tab's probe in flight, and
 * deleting it mid-probe would fail that tab's read-back — the exact memory-only downgrade the
 * per-call key exists to prevent. A key without a parseable stamp is stale by construction (the
 * fixed key older builds used).
 * @see docs/design-notes/utils.md#storage-probe
 */
const sweepStaleProbeKeys = (currentKey: string): void => {
  // Backwards: removals shift the indices above them.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (!k || k === currentKey || !k.startsWith(PROBE_KEY_PREFIX)) {
      continue
    }
    const stamp = Number.parseInt(k.slice(PROBE_KEY_PREFIX.length), 36)
    if (!Number.isFinite(stamp) || Date.now() - stamp > PROBE_STALE_MS) {
      try {
        localStorage.removeItem(k)
      } catch {
        // Per key, so one unremovable entry cannot abort the rest of the sweep.
      }
    }
  }
}

export const isStorageAvailable = (): boolean => {
  // Freshness rides both the key and the value, and each closes a different fault. The key: two tabs
  // probing a shared name concurrently would clobber each other's value and both report a working
  // store unavailable, downgrading two page loads to memory-only. The value: residue from an earlier
  // failed removal at *this tab's own* key — reachable whenever `strandedProbeKey` is reused — would
  // otherwise read back as this run's write and report a no-opping `setItem` as available, which is
  // the exact fault the read-back exists to catch.
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  const key = strandedProbeKey ?? `${PROBE_KEY_PREFIX}${token}__`
  try {
    const s = localStorage
    s.setItem(key, token)
    // Verify the write only. A shim that no-ops setItem stores nothing while reporting success, so
    // every later write would lie; that is a property of the Storage object, not of a key, which is
    // why it is checked here rather than on the store's per-event write path. A removal that no-ops
    // is a narrower fault — values still persist — and PersistentStore.removeItem verifies that one
    // per call, so failing the whole layer on it would turn a teardown defect into total identity
    // loss: no session, no anonymous ID, a fresh identity every page load.
    return s.getItem(key) === token
  } catch {
    return false
  } finally {
    try {
      localStorage.removeItem(key)
      // Learn whether removals land here. A key that survives is reused by the next probe rather
      // than joined by a fresh one; a removal that lands releases the reuse. Reuse is safe on its
      // own because freshness rides the *value*: the residue at a reused key is an earlier call's
      // token, so a store that also starts no-opping setItem still fails the `=== token` read-back
      // above rather than matching its own leftovers. See the header comment on that read-back —
      // the per-call key and the per-call token close different faults, and this is the one the
      // token closes.
      strandedProbeKey = localStorage.getItem(key) === null ? null : key
    } catch {
      // Name it again next time rather than stranding another: a probe that never landed costs
      // nothing to reuse, and one that did is now the only key this store will accumulate.
      strandedProbeKey = key
    }
    // Its own try, deliberately: sharing the removal's meant a throwing removeItem skipped the
    // sweep entirely — in exactly the failure mode that strands keys for it to reclaim later.
    try {
      sweepStaleProbeKeys(key)
    } catch {
      // Opportunistic: a store that is still failing sweeps nothing this time.
    }
  }
}
