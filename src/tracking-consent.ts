import { log } from './logger.js'
import { type PersistentStore, resolveStore } from './persistence.js'
import { makeStorageKey } from './utils.js'

/**
 * The valid consent states, and the single source of `TrackingConsent`.
 *
 * The type is derived from this array rather than written alongside it: `isConsent` carries a
 * `value is TrackingConsent` predicate, and when the two were maintained separately a widened union
 * still compiled against the old three-way disjunction. The predicate then lied — it advertised
 * narrowing to `TrackingConsent` while accepting a subset, so a newly added state would be
 * un-settable and reported as invalid input, with `unreachable()` flagging only the `track()`
 * dispatch. Derivation makes that drift unrepresentable.
 */
const CONSENT_STATES = ['granted', 'denied', 'cookieless'] as const

export type TrackingConsent = (typeof CONSENT_STATES)[number]

export interface TrackingConsentConfig {
  /**
   * First-run seed used when nothing is persisted yet. Defaults to `'granted'` — so `{ persist:
   * true }` with no `initial` seeds FULL consent, the one place in this module whose posture is not
   * fail-closed. Pass an explicit `'denied'` or `'cookieless'` for a consent-first flow.
   *
   * Named `initial` rather than `default`: the latter is a reserved word, so `const { default } =
   * cfg` is a SyntaxError and consumers had to write `const { default: initial } = cfg`.
   */
  readonly initial?: TrackingConsent
  /** Persist opt in/out and restore any persisted value on construction (i.e. on the next init()). Defaults to false. */
  readonly persist?: boolean
}

/**
 * A consent predicate, nominally tagged with the question it answers.
 *
 * `isGranted` and `isTracking` are both `() => boolean` and are injected positionally into optional
 * parameters, so passing the wrong one compiled silently — and one such swap (`configureProfile`
 * receiving `isTracking`) was invisible to the entire test suite while re-writing a durable
 * `externalId` to the device in cookieless mode. The phantom member makes the two mutually
 * unassignable without changing anything at runtime.
 *
 * The member is **required**. It was optional so a plain `() => boolean` would satisfy either gate
 * "for tests and non-`init()` callers" — but `src/*.test.ts` is excluded from `tsconfig.typecheck`
 * and vitest transpiles without checking, so tests were never typechecked either way, and there are
 * no non-`init()` production callers. Optionality bought nothing and let the brand be laundered:
 * `const f: () => boolean = isTracking` and `() => isTracking()` both stripped it silently.
 * Producers add it with the `as` casts below, which is where naming the question belongs.
 */
export type ConsentGate<K extends string> = (() => boolean) & { readonly __gate: K }
/** May we write identity to the device? Full consent only. */
export type GrantedGate = ConsentGate<'granted'>
/** Are events flowing at all? Granted **or** cookieless. */
export type TrackingGate = ConsentGate<'tracking'>

/**
 * The recognized `TrackingConsentConfig` keys. Kept as a runtime set because the CDN one-tag
 * install supplies this object as untyped JSON, where a typo is otherwise undetectable.
 */
const KNOWN_CONSENT_KEYS: ReadonlySet<string> = new Set(['initial', 'persist'])

/** Narrows an untrusted value to a valid consent state. Everything else is out-of-domain. */
const isConsent = (value: unknown): value is TrackingConsent => (CONSENT_STATES as readonly unknown[]).includes(value)

export const createTrackingConsent = (
  projectId: string,
  config?: TrackingConsent | TrackingConsentConfig,
  persistentStore?: PersistentStore | null,
) => {
  // The config is runtime-untrusted despite its type — the CDN one-tag install feeds it from
  // data-options JSON — so validate its shape, not just its `initial` value below. A shape that is
  // neither a string nor a plain object (a primitive, an array) is out-of-domain and fails closed
  // to 'denied'. Missing config (undefined/null) is the legitimate "no preference" case.
  const raw: unknown = config
  let normalized: TrackingConsentConfig
  if (raw == null) {
    normalized = {}
  } else if (typeof raw === 'string') {
    normalized = { initial: raw as TrackingConsent }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    normalized = raw as TrackingConsentConfig
  } else {
    log.warn(`Invalid trackingConsent config ${JSON.stringify(raw)}; failing closed to 'denied'.`)
    normalized = { initial: 'denied' }
  }
  // An unrecognized key was the one input here that failed OPEN: `normalized.initial` is undefined,
  // `seed !== undefined` is false, and `status` keeps its 'granted' initialiser — so a typo'd or
  // stale privacy config silently granted full tracking. TypeScript catches this for npm consumers
  // (TS2561, with a did-you-mean), but the one-tag install feeds this from `data-options` JSON in
  // customer HTML, which no compiler ever sees — and autoInitFromScript is documented to fail closed
  // on exactly that input. Fail closed here too, matching every sibling branch.
  const unknownKeys = Object.keys(normalized).filter(key => !KNOWN_CONSENT_KEYS.has(key))
  if (unknownKeys.length > 0) {
    log.warn(
      `Unknown trackingConsent key(s) ${JSON.stringify(unknownKeys)}; expected ${[...KNOWN_CONSENT_KEYS]
        .map(k => `'${k}'`)
        .join(' and/or ')}. Failing closed to 'denied' rather than seeding the 'granted' fallback.`,
    )
    normalized = { ...normalized, initial: 'denied' }
  }
  // Non-boolean `persist` silently becomes false, and it fails quietly in every direction: consent
  // stays in memory, init()'s purge never fires (isAuthoritative() is false), and set() still
  // reports success because write() short-circuits on !persist. The CDN one-tag install feeds this
  // from `data-options` JSON, where `"persist": "true"` is the obvious mistake — so say so, as every
  // other untrusted field here already does.
  if (normalized.persist !== undefined && typeof normalized.persist !== 'boolean') {
    log.warn(
      `Invalid trackingConsent.persist ${JSON.stringify(normalized.persist)}; expected a boolean. Treating it as false — the choice will not survive a reload.`,
    )
  }
  const persist = normalized.persist === true
  const storageKey = makeStorageKey(projectId, 'consent')
  const store = persist ? resolveStore(persistentStore) : null

  if (persist && !store) {
    log.warn('Storage unavailable; tracking consent will not persist across page loads.')
  }

  // First-run seed, then let any valid persisted value override it. A present-but-invalid `initial`
  // (e.g. a typo'd 'Denied') fails closed to 'denied'; an absent one seeds the documented 'granted'.
  const seed: unknown = normalized.initial
  let status: TrackingConsent = 'granted'
  if (isConsent(seed)) {
    status = seed
  } else if (seed !== undefined) {
    log.warn(`Invalid trackingConsent initial ${JSON.stringify(seed)}; failing closed to 'denied'.`)
    status = 'denied'
  }
  // Whether `status` came from storage (a choice the user actually made and we recorded) rather
  // than from the config seed. Only an explicit set() ever writes, so with `persist: true` and
  // nothing stored yet, `status` is still the integrator's seed — see isAuthoritative().
  let restoredFromStorage = false
  if (store) {
    const stored = store.getItem(storageKey)
    if (isConsent(stored)) {
      status = stored
      restoredFromStorage = true
      // Re-write so a cookie-backed store refreshes its expiry. The result is checked, not
      // discarded: this is the 365-day refresh of the user's recorded *refusal*, and if it keeps
      // failing the cookie eventually expires, the next init() falls back to the seed, and the seed
      // defaults to 'granted'. An opt-out quietly becoming a re-consent is the exact failure the
      // README's "handling a failed consent change" section exists to prevent.
      if (!store.setItem(storageKey, stored)) {
        log.error(
          `Failed to refresh the stored tracking consent at "${storageKey}"; it may expire and fall back to the configured seed, turning a recorded opt-out into a re-consent.`,
        )
      }
    } else if (stored !== null) {
      log.warn(`Stored tracking consent at "${storageKey}" is invalid, ignoring.`)
    }
  }

  // Reports whether `value` will still be readable on the next page load. When persistence was never
  // requested there is nothing to fail, so in-memory consent is a success. When it *was* requested but
  // is unavailable, every write is a durability failure — the constructor warned once, but callers
  // asking "did the opt-out stick?" need the per-call answer too.
  const write = (value: TrackingConsent): boolean => {
    if (!persist) {
      return true
    }
    if (!store || !store.setItem(storageKey, value)) {
      log.error('Failed to persist tracking consent to storage — opt in/out will not survive page reload.')
      return false
    }
    return true
  }

  /**
   * Applies a consent state. Returns false when the state did not fully take effect — either the
   * value was out-of-domain (state is then forced to 'denied') or it could not be persisted. The
   * requested state is always applied in memory when valid, so false never means "nothing happened".
   */
  const set = (value: TrackingConsent): boolean => {
    if (!isConsent(value)) {
      // Fail closed, matching the init-time posture above (:36, :54) rather than keeping the previous
      // state: a caller trying to *change* consent has demonstrably lost track of it, and keeping a
      // possibly-'granted' state means a user who clicked Reject stays fully tracked. Error rather
      // than warn — this both rejects the caller's value and changes state, and the CDN global feeds
      // this path untyped values ('reject', 'cookieLess', null) straight from a CMP.
      log.error(`Invalid tracking consent state ${JSON.stringify(value)}; failing closed to 'denied'.`)
      status = 'denied'
      write('denied')
      return false
    }
    status = value
    return write(value)
  }

  return {
    getConsent: (): TrackingConsent => status,
    /**
     * Whether the resolved state is a durable record of the user's own choice rather than the
     * integrator's pre-banner placeholder — the gate on init()'s identity purge.
     *
     * Requires BOTH that persistence is on and that the value actually came back from storage.
     * `persist` alone is not enough, and reading it that way is a data-loss bug: nothing is written
     * until an explicit set(), so on a site that adds `{ initial: 'denied', persist: true }` to an
     * existing deployment, every returning visitor's first load finds an empty consent key, falls
     * back to the seed, and would purge identity those users never asked to have deleted.
     *
     * With `persist: false` the initial value is whatever the caller passed on this load, which for
     * an async CMP is typically a placeholder 'denied' that a later optInTracking() corrects.
     * Purging on that would destroy a returning visitor's identity on every single page load.
     */
    isAuthoritative: (): boolean => persist && restoredFromStorage,
    /** True only for full consent — gates identity-storage writes, NOT event flow. */
    isGranted: ((): boolean => status === 'granted') as GrantedGate,
    /**
     * True when events flow at all (granted or cookieless). Gates automatic listener attachment
     * (auto-capture) and answers the public isTrackingEnabled().
     *
     * It does NOT gate track() or identify(), which make their own, deliberately different checks:
     * identify() requires isGranted() (cookieless has no identity to attach traits to), and track()
     * branches on getConsent() directly, since it needs all three states — 'denied' drops, and
     * 'cookieless' takes the identity-free path rather than merely being allowed through.
     */
    isTracking: ((): boolean => status === 'granted' || status === 'cookieless') as TrackingGate,
    set,
    optIn: (): boolean => set('granted'),
    optOut: (): boolean => set('denied'),
  }
}

export type TrackingConsentController = ReturnType<typeof createTrackingConsent>
