import { create } from '@bufbuild/protobuf'
import {
  type AutoCaptureConfig,
  type AutoCaptureController,
  type AutoCaptureSelection,
  createAutoCaptureController,
} from './auto-capture.js'
import { type BatchOptions, createBatchedTransport } from './batch.js'
import { type CrossSubdomainConfig, createCookieLayer } from './cookie.js'
import { IdentifyRequestSchema, ProfilesSDKService } from './gen/sdk/profiles/v1/profiles_pb.js'
import { log, setDebugLogging } from './logger.js'
import { initUserAgentData } from './parsers.js'
import { createPersistentStore, type PersistentStore } from './persistence.js'
import {
  clearProfile,
  configureProfile,
  destroyProfile,
  getAnonymousId,
  isIdentified,
  markIdentified,
  resolveDistinctId,
} from './profile.js'
import { ONE_SHOT_TIMEOUT_MS, unaryCall } from './rpc.js'
import {
  clearSession,
  configureSession,
  destroySession,
  onConsentGranted,
  resetIdentity,
  resolveSessionId,
  type SessionConfig,
} from './session.js'
import {
  type BeforeSendFn,
  configureBeforeSend,
  type EventIdentity,
  type JsonValue,
  type TrackFn,
  type TrackOptions,
  toEvent,
} from './track.js'
import {
  createTrackingConsent,
  deferredGrantedGate,
  type RejectConsent,
  type TrackingConsent,
  type TrackingConsentConfig,
  type TrackingConsentController,
  type TrackingGate,
} from './tracking-consent.js'
import {
  configureUrlRedaction,
  DEFAULT_ENDPOINT,
  DEVICE_ID_KEY,
  RESERVED_DISTINCT_ID_PREFIX,
  safeStringify,
} from './utils.js'

export interface PugConfig {
  readonly endpoint: string
  readonly projectId: string
}

export interface InitOptions {
  readonly endpoint?: string | undefined
  readonly apiKey: string
  readonly batch?: BatchOptions | undefined
  readonly dryRun?: boolean | undefined
  /**
   * Logs the SDK's internal activity to `console.debug`. Off by default.
   *
   * Turn it on when events are not arriving: it reports each `track()` call, the drops this flag
   * governs (denied consent and `dryRun`), and whether auto-capture ended up with any trackers
   * active. Note that `console.debug` output sits in DevTools' "Verbose" level, which is hidden
   * until you enable it in the console's level filter.
   *
   * The drops this flag does *not* govern are the ones you never want hidden, so they are reported
   * regardless: a call before `init()` and a bad config warn, and an event too malformed to encode
   * errors. This flag can only widen what you see, never narrow it.
   */
  readonly debug?: boolean | undefined
  readonly session?: SessionConfig | undefined
  readonly autoCapture?: AutoCaptureConfig | undefined
  /**
   * The consent state to start from, or a `TrackingConsentConfig` (`initial`, `onReject`,
   * `persist`, `respectGpc`). **Defaults to `'cookieless'`**: events flow, but no identifier is
   * written to the device until the user actually answers — pass `'granted'` to opt into full
   * identity from the first event, or `'denied'` to capture nothing at all. A bare string is a
   * per-load seed; use the config form with `persist: true` to record the user's choice across
   * reloads.
   */
  readonly trackingConsent?: TrackingConsent | TrackingConsentConfig | undefined
  /**
   * Shares identity (anonymous ID, external ID, session state, persisted consent) across subdomains
   * of the same site via a first-party cookie on the registrable domain (e.g. `.example.com`).
   *
   * **Off by default.** Cross-subdomain identity trades browser-enforced same-origin isolation for
   * the weaker same-site trust model, so it must be a conscious opt-in per integrator — see
   * `docs/cross-domain-tracking-threat-model.md` in the backend `pug` repo.
   *
   * - `false` (default) — origin-scoped `localStorage` only; no shared cookie.
   * - `true` — discover the widest settable domain (eTLD+1) with a write-probe. Degrades to a
   *   host-only cookie on localhost and IP hosts, and to `localStorage` when cookies are blocked.
   *   Cookies set from an HTTPS page carry `Secure`, so identity is shared only among HTTPS
   *   subdomains — an HTTP subdomain cannot read them. ⚠️ On a custom multi-tenant registrable
   *   domain that is not on the Public Suffix List (e.g. `tenant-a.myplatform.com` and
   *   `tenant-b.myplatform.com` run as separate customers), the probe returns the shared
   *   `myplatform.com`, letting sibling tenants read and overwrite each other's identity. Prefer
   *   an explicit `{ domain }` in that topology.
   * - `{ domain }` — pin an explicit cookie domain (falls back to a host-only cookie with a warning
   *   when the browser rejects it or it does not cover the current host).
   *
   * Cookie lifetime comes from the top-level `maxAgeDays`, which bounds every storage mode.
   *
   * With cross-subdomain sessions, the "rotate when all tabs closed" heuristic is disabled — sessions
   * end by idle/max timeout only, since tab liveness is unknowable across subdomains.
   */
  readonly crossSubdomainTracking?: CrossSubdomainConfig | undefined
  /**
   * How long the SDK's stored identifiers are kept, in days. Default 365; pass 390 for CNIL's
   * 13 months.
   *
   * The deadline is absolute — stamped when a value is first written, never extended by later
   * writes — so a returning visitor's identifiers age out on schedule rather than being renewed on
   * every visit. It covers the anonymous ID, any `identify()`ed external ID, session state and the
   * persisted consent choice, in both `localStorage` and cross-subdomain cookie modes. When the
   * consent record lapses, `isConsentPending()` is true again and your banner is shown afresh.
   *
   * Lowering it applies to existing visitors too: a stored deadline is clamped to the current
   * window on the next write, so tightening retention reaches the population that matters.
   *
   * Not covered: the outbound event queue and the tab-liveness registry, which stay on raw
   * `localStorage`. Neither is a path identity survives a withdrawal on — the registry is cleared by
   * every consent teardown, and the queue by every teardown that *reduces* consent (leaving
   * `'granted'`, or landing on `'denied'`); the one case it survives is a re-assert of an unchanged
   * cookieless state, where it holds only identity-free events. `reset()` additionally
   * sends-and-drops the queue but leaves the registry, which holds per-tab timestamps and no
   * identifiers (and whose stale entries are pruned by their own idle timeout). A queue that cannot reach the network is bounded by
   * `batch.maxQueueSize`, not by this deadline. Nor is `pug_device_id`, the push module's device
   * identifier — it has no deadline and no teardown clears it (push is not currently exported, so
   * nothing writes it yet).
   */
  readonly maxAgeDays?: number | undefined
  /**
   * Query and fragment params whose values are replaced with `redacted` in `$url`, `$referrer` and a
   * form's `action`. Defaults to a built-in list of credentials and direct identifiers (`token`,
   * `access_token`, `code`, `email`, `password`, …) plus any param ending in `_token`, which covers
   * framework reset-link names like `reset_password_token`. Pass an array to replace that list
   * (matched case-insensitively by exact name — the `_token` suffix rule rides the default list and
   * never a replacement), or
   * `false` to disable redaction and capture URLs verbatim. An empty array warns and keeps the
   * default list — it would otherwise disable redaction exactly like `false`, but silently.
   *
   * Applied before `beforeSend`, so a hook can still mask more.
   */
  readonly redactUrlParams?: readonly string[] | false | undefined
  /**
   * Redacts, rewrites or drops each event before it is sent. Mutate `autoProperties` /
   * `customProperties` in place and return the event, `null` to drop it, or nothing at all.
   * `$url`, `$referrer` and a form's `action` arrive with `redactUrlParams` already applied; any
   * further masking (path segments, whole URLs) is this hook's job.
   *
   * Runs synchronously on every event, so keep it cheap. Fails closed: a throw, a malformed return
   * or a non-function value drops the event (or every event) rather than sending it unredacted.
   * `$projectId`/`$platform`/`$sdkVersion` are re-asserted afterwards; `sessionId`/`distinctId` are
   * not exposed. Unavailable on the one-tag install — `data-options` is JSON, which holds no
   * functions.
   */
  readonly beforeSend?: BeforeSendFn | undefined
}

export type {
  AutoCaptureConfig,
  AutoCaptureSelection,
  CrossSubdomainConfig,
  RejectConsent,
  TrackingConsent,
  TrackingConsentConfig,
}

interface PugState {
  readonly config: PugConfig
  readonly transport: ReturnType<typeof createBatchedTransport>
  readonly apiKey: string
  readonly dryRun: boolean
  readonly autoCapture: AutoCaptureController
  readonly trackingConsent: TrackingConsentController
}

let state: PugState | null = null

// One-shot so a cookieless site calling identify() on every page doesn't spam the console.
let cookielessIdentifyWarned = false

/**
 * Compile-time exhaustiveness marker: reaching it with a non-`never` argument is a type error, so
 * widening a union forces every dispatch over it to be revisited.
 *
 * Deliberately does not throw. The caller's `else` branch already fails closed and logs the offending
 * state by name; a throw would be swallowed by track()'s own try/catch and replace that with a
 * generic message.
 */
const unreachable = (_state: never): void => {}

// Untrusted: the one-tag install feeds this from `data-options` JSON, where `"redactUrlParams":
// "token"` is the obvious mistake. Falling back to the default list keeps redaction on.
const resolveRedactUrlParams = (params: unknown): readonly string[] | false | undefined => {
  if (params === undefined || params === false) {
    return params
  }
  if (!Array.isArray(params) || params.some(p => typeof p !== 'string')) {
    log.warn('redactUrlParams must be an array of strings or `false`; using the default redaction list.')
    return undefined
  }
  // An empty list matches nothing, so it disables redaction exactly like `false` but silently —
  // and `userList.filter(...)` coming up empty reaches it without anyone meaning to.
  if (params.length === 0) {
    log.warn(
      'redactUrlParams is empty, which would disable URL redaction; using the default list. Pass `false` to disable it deliberately.',
    )
    return undefined
  }
  return params
}

// High-entropy client hints are themselves a device read, so skip them for an untracked user. Takes
// the branded gate: passing `isGranted` here would silently stop warming hints in cookieless mode,
// and both are `() => boolean`, so only the brand makes that a compile error.
const warmUserAgentData = (isTracking: TrackingGate): void => {
  if (!isTracking()) {
    return
  }
  try {
    initUserAgentData()
  } catch (err) {
    log.warn('Failed to initialize user agent data:', err)
  }
}

// Events carry URLs, referrers and identifiers; over http they cross the network in the clear.
// A warning, not a refusal — a self-hosted collector on localhost is a legitimate dev setup.
const warnOnInsecureEndpoint = (endpoint: string): void => {
  try {
    const { protocol, hostname } = new URL(endpoint)
    const localhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    if (protocol !== 'https:' && !localhost) {
      log.warn(`endpoint "${endpoint}" is not https — events will be sent unencrypted.`)
    }
  } catch {
    log.warn(`endpoint "${endpoint}" is not a valid URL.`)
  }
}

export const init = (projectId: string, options: InitOptions) => {
  if (typeof window === 'undefined') {
    log.warn('init() called in a non-browser environment, skipping.')
    return
  }

  if (!projectId || typeof projectId !== 'string') {
    throw new Error('[Pug SDK] projectId is required and must be a non-empty string')
  }

  if (!options.apiKey || typeof options.apiKey !== 'string') {
    throw new Error('[Pug SDK] apiKey is required and must be a non-empty string')
  }

  if (state) {
    log.warn('Already initialized.')
    return
  }

  // Before any other setup, so init's own debug output is captured too.
  setDebugLogging(options.debug ?? false)

  const config: PugConfig = { endpoint: options.endpoint || DEFAULT_ENDPOINT, projectId }
  warnOnInsecureEndpoint(config.endpoint)

  // Late-bound: the controller needs the store, the store needs the cookie layer. See
  // deferredGrantedGate for why reading as permitted until it resolves is sound, and for the
  // constraint that keeps it sound — no store access before the assignment below.
  let consentRef: TrackingConsentController | null = null
  const cookieGate = deferredGrantedGate(() => consentRef)

  let store: PersistentStore | null = null
  try {
    // The cookie probes (availability + domain discovery) run before consent is read: the consent
    // record itself may ride the shared cookie, so the layer cannot wait on the answer. They are
    // capability checks — random names, max-age ≤ 3s, deleted on the spot — never identifiers.
    store = createPersistentStore(
      createCookieLayer(options.crossSubdomainTracking ?? false, cookieGate),
      options.maxAgeDays,
    )
  } catch (err) {
    log.warn('Failed to initialize persistence:', err)
  }

  // Before configureProfile, so its init-time expiry refresh can be gated on consent — no identity
  // cookie write while denied (threat model constraint #6, in the backend `pug` repo).
  const trackingConsent = createTrackingConsent(projectId, options.trackingConsent, store)
  consentRef = trackingConsent

  try {
    configureSession(projectId, options.session, store, trackingConsent.isGranted)
  } catch (err) {
    log.warn('Failed to configure session tracking:', err)
  }

  try {
    configureProfile(projectId, store, trackingConsent.isGranted)
  } catch (err) {
    log.warn('Failed to configure profile:', err)
  }

  warmUserAgentData(trackingConsent.isTracking)

  // No compiler protects a JS or one-tag install, so a silently ignored sanitizer means URLs the
  // integrator believes are masked lose that masking.
  if ('sanitizeUrl' in options) {
    log.warn(
      'sanitizeUrl was removed and is ignored. Known-sensitive query and fragment params are redacted by default (see redactUrlParams); any further masking belongs in beforeSend.',
    )
  }
  configureBeforeSend(options.beforeSend)
  configureUrlRedaction(resolveRedactUrlParams(options.redactUrlParams))

  const transport = createBatchedTransport(config.endpoint, options.apiKey, projectId, options.batch)
  const autoCapture = createAutoCaptureController(track, trackingConsent.isTracking)

  state = {
    config,
    transport,
    apiKey: options.apiKey,
    dryRun: options.dryRun ?? false,
    autoCapture,
    trackingConsent,
  }

  if (state.dryRun) {
    log.warn('Dry run mode enabled — events will not be sent.')
  }
  if (state.trackingConsent.getConsent() === 'denied') {
    log.warn(
      'Tracking consent is denied — automatic capture is off and track()/identify() are dropped until optInTracking() is called. Check isTrackingEnabled() to detect this state.',
    )
  }
  if (state.trackingConsent.getConsent() === 'cookieless') {
    log.debug('Cookieless mode: events flow without stored identity; identify() is disabled until consent is granted.')
  }

  // Entering a non-granted state via config must leave the device as setTrackingConsent() would, or
  // a visitor whose CMP now says "reject" keeps a prior consented visit's identifiers and a later
  // grant resolves the *pre-existing* session and anonymous ID.
  //
  // Gated on isAuthoritative(), so it only fires when the resolved state is the user's own recorded
  // choice. Without persistence the value is the caller's per-load placeholder — typically a
  // 'denied' an async CMP corrects later — and purging on that mints a new identity every load.
  if (!state.trackingConsent.isGranted()) {
    if (state.trackingConsent.isAuthoritative()) {
      // purgePersistedIdentity() drops the queue first, so it is not purged separately here.
      //
      // init() returns void, so this outcome has nowhere structured to go and must not be left to
      // be inferred from the per-key errors: a purge that did not land means a later
      // optInTracking() resumes the PRE-EXISTING identity while getTrackingConsent() reports the
      // new state as though it fully applied.
      if (!purgePersistedIdentity({ dropQueue: true })) {
        log.error(
          'Could not fully remove stored identity for a non-granted consent state. Identifiers may survive on this device, and granting consent later may resume the previous identity rather than minting a fresh one.',
        )
      }
    } else {
      // The queue goes either way, unlike identity: it is an outbound buffer of events already
      // collected, not an identifier a later grant could resolve. Withholding it here left a prior
      // consented visit's identified payloads on the device for every non-authoritative non-granted
      // init — any config without `persist: true`, i.e. a bare `'denied'`/`'cookieless'` string or
      // the `{ initial, persist: false }` form in examples/cdn/index.html.
      const queueDropped = purgeQueuedEvents({ send: false }).ok
      // Identity is deliberately skipped — see isAuthoritative(). Say so, or an integrator passing a
      // bare 'cookieless'/'denied' cannot tell the documented purge did not run — and name the queue
      // drop, which is where a hard-killed granted session's events went. The phrase is conditioned
      // on the result: on a failed purge the queue's own error already says the key survived, and an
      // unconditional "were dropped" here contradicted it.
      log.debug(
        `Consent is not granted but was not restored from storage, so it is a config seed rather than a recorded choice — ${
          queueDropped
            ? 'the queued-events purge landed'
            : 'the queued-events purge did not fully land (see the error above)'
        }, and stored identity was left in place. Use trackingConsent.persist to record the choice.`,
      )
    }
  }

  state.autoCapture.setDesired(options.autoCapture)

  log.debug('Initialized.')
}

export const setAutoCapture = (autoCapture: AutoCaptureConfig): void => {
  if (!state) {
    log.warn('setAutoCapture() called before init().')
    return
  }
  state.autoCapture.setDesired(autoCapture)
  // isTracking, not isGranted: the controller attaches listeners whenever events flow, which
  // includes cookieless. Keying this on full consent printed "activate after opt-in" in cookieless
  // mode, where they had already activated — the exact conflation the predicate split prevents.
  if (!state.trackingConsent.isTracking()) {
    log.debug('setAutoCapture() stored selection; listeners activate after opt-in.')
  }
}

/**
 * Drops the queued events off the device. `send: false` on every consent teardown — beaconing after
 * a withdrawal is a fresh transmission of the data just refused; `reset()` (a logout, consent
 * unchanged) sends first.
 *
 * Split from the identity purge because the two answer to different gates: the queue is an outbound
 * buffer, not an identifier anything reads back, so purging it can never mint a new identity and
 * `isAuthoritative()` does not apply. Folded together, it left a prior consented visit's identified
 * payloads on the device through every non-authoritative non-granted init.
 */
const purgeQueuedEvents = ({ send }: { send: boolean }): { ok: boolean; destroyed: number } => {
  // A null state means the transport was never built, so the queue was not purged. Report that
  // rather than defaulting to success inside a privacy teardown.
  if (!state) {
    return { ok: false, destroyed: 0 }
  }
  try {
    // `ok: false` means a queue key survived on the device, and the queue's own purge() reports that
    // at its site with the cause in hand; a dropped farewell beacon reports through reportBeaconLoss
    // and does not affect it. Adding a message for either would only guess.
    const result = state.transport.purgeQueue({ send })
    // The page that queued these events logged "will retry" at warn level; this is where that
    // breaks. Keyed on `destroyed` rather than a buffer count, so a purge that left the persisted
    // key behind claims no destruction while a cookieless queue's permanent loss is still reported,
    // and on `!send`, since reset() beacons them out first.
    if (!send && result.destroyed > 0) {
      log.warn(
        `Dropped ${result.destroyed} queued event(s) collected under a previous consent state, unsent — they may include identified payloads, which must not be held or transmitted once consent is no longer granted.`,
      )
    }
    return result
  } catch (err) {
    log.error('Failed to purge queued events:', err)
    return { ok: false, destroyed: 0 }
  }
}

/**
 * Drops every persisted identifier: anonymous ID, external ID, session, and the tab registry —
 * including the shared cookie in cross-subdomain mode, so the purge propagates to sibling
 * subdomains. Returns false when any removal could not be confirmed, which in cross-subdomain
 * mode means an identity cookie survived on the registrable domain and will resurface.
 *
 * Idempotent in end state but not side-effect-free: it issues removals (cookie deletions when
 * cross-subdomain) and may log an error on an unconfirmed removal even when nothing was stored.
 *
 * `dropQueue` is the caller's statement that this purge accompanies a consent *reduction* (or
 * init()'s authoritative restore, where there is no previous state) — the identity removals are
 * end-state no-ops on a re-assert, but the queue drop is not: it destroys queued events, so it
 * must not run when nothing actually changed.
 */
const purgePersistedIdentity = ({ dropQueue }: { dropQueue: boolean }): boolean => {
  // Runs first, while those events still exist.
  let purged = dropQueue ? purgeQueuedEvents({ send: false }).ok : true
  try {
    purged = clearProfile() && purged
  } catch (err) {
    log.error('Failed to clear profile:', err)
    purged = false
  }
  try {
    purged = clearSession() && purged
  } catch (err) {
    log.error('Failed to clear session:', err)
    purged = false
  }
  return purged
}

/**
 * Sets the tracking consent state — the general form of optInTracking()/optOutTracking(),
 * covering the third state: 'cookieless' keeps events flowing with a server-derived,
 * daily-rotating anonymous identity and writes no identifiers to the device.
 *
 * Leaving 'granted' purges persisted identity (profile + session + tab registry, including the
 * cross-subdomain cookie) — no identifier may linger for a user who withdrew consent.
 * Granting later mints a fresh identity lazily on the next event; pre-consent events
 * stay permanently anonymous (no retroactive linking).
 *
 * Returns **false** when the change did not fully take effect: called before `init()`, an invalid
 * state (consent then fails closed to `'denied'`), a choice that could not be persisted, or an
 * identifier that could not be removed. After `init()` a valid state is always applied in memory, so
 * `false` means "applied, not fully durable" rather than "ignored" — only the pre-`init()` case is
 * genuinely ignored, which a banner racing initialization is most likely to hit.
 */
export const setTrackingConsent = (consent: TrackingConsent): boolean => {
  if (!state) {
    log.warn('setTrackingConsent() called before init().')
    return false
  }
  const wasTracking = state.trackingConsent.isTracking()
  const wasGranted = state.trackingConsent.isGranted()
  let ok = state.trackingConsent.set(consent)
  const resolved = state.trackingConsent.getConsent()
  // Consent side effects run before apply(), matching init(). The order is defense in depth: the
  // drop predicate below never purges on a transition that arms a tracker, but if that invariant
  // ever loosens, purging after apply() would destroy the newly-armed tracker's synchronous
  // page_view — the first event of every mid-page cookieless session — unsent.
  if (resolved === 'granted') {
    // Re-arm the tab-liveness registry configureSession() skipped while consent withheld it.
    // Without this the "all tabs closed → rotate" heuristic stays dead for the page's life — and
    // under the README's consent-first flow it would never arm at all.
    try {
      onConsentGranted()
    } catch (err) {
      log.warn('Failed to re-arm tab tracking after consent was granted:', err)
    }
  } else {
    // Identity removals run on every non-granted resolve — required when leaving 'granted', and
    // from another non-granted state a no-op in end state, though not free: they still issue
    // removals and may log on an unconfirmed one. The queue drop is scoped tighter, to transitions
    // that actually reduce consent: leaving 'granted' (the consented queue holds identified
    // payloads the user just withdrew consent for), or landing on 'denied' (a kept cookieless
    // queue would be beaconed by the next pagehide — transmission after a full reject). A
    // re-assert of an unchanged non-granted state — a CMP restating its state on every load —
    // keeps the cookieless queue: those events are identity-free by construction, and purging
    // them destroyed the pre-banner page_view of every mid-page cookieless session for no
    // privacy gain, while a granted→granted re-assert kept its queue untouched.
    const dropQueue = resolved === 'denied' || wasGranted
    ok = purgePersistedIdentity({ dropQueue }) && ok
  }
  state.autoCapture.apply()
  // Only on the transition *into* tracking: initUserAgentData() clears the hint cache synchronously
  // and refills it asynchronously, so a re-assert would drop $osVersion/$device from every event
  // until the new request resolved.
  if (!wasTracking) {
    warmUserAgentData(state.trackingConsent.isTracking)
  }
  log.debug(`Tracking consent set to "${resolved}".`)
  return ok
}

export const optInTracking = (): boolean => {
  if (!state) {
    // Guarded so the warning names this function rather than setTrackingConsent, matching optOut.
    log.warn('optInTracking() called before init().')
    return false
  }
  return setTrackingConsent('granted')
}

/**
 * Applies the rejection state: `'denied'`, or `trackingConsent.onReject` when configured — pass
 * `onReject: 'cookieless'` and the banner's reject branch keeps identity-free traffic counts without
 * naming the state itself. Either way persisted identity is torn down (see setTrackingConsent);
 * consent stays persisted so the rejection survives reloads.
 */
export const optOutTracking = (): boolean => {
  if (!state) {
    log.warn('optOutTracking() called before init().')
    return false
  }
  return setTrackingConsent(state.trackingConsent.getRejectState())
}

/**
 * Whether events are being tracked right now — true for granted **and** cookieless; use
 * `getTrackingConsent()` to distinguish them. Reflects consent only, independent of `dryRun`.
 * `false` before `init()` is accurate rather than a placeholder: nothing is being tracked yet.
 */
export const isTrackingEnabled = (): boolean => {
  if (!state) {
    log.warn('isTrackingEnabled() called before init().')
    return false
  }
  return state.trackingConsent.isTracking()
}

/**
 * The consent state the SDK is acting on, or `undefined` before `init()` — a persisted choice is only
 * read from storage during `init()`, so before then there is genuinely no answer. `undefined` rather
 * than `'denied'`, which a banner would read as a real opt-out and re-prompt someone who opted in.
 */
export const getTrackingConsent = (): TrackingConsent | undefined => {
  if (!state) {
    log.warn(
      'getTrackingConsent() called before init(); returning undefined — a persisted choice is only read during init().',
    )
    return undefined
  }
  return state.trackingConsent.getConsent()
}

/**
 * Whether the user has yet to make a choice — the banner gate. `getTrackingConsent()` cannot answer
 * this: before any answer it reports the `initial` seed, so a seeded state and a chosen one read
 * identically. `true` before `init()`, since nothing has been read from storage yet.
 */
export const isConsentPending = (): boolean => {
  if (!state) {
    log.warn('isConsentPending() called before init(); returning true — a persisted choice is only read during init().')
    return true
  }
  return state.trackingConsent.isPending()
}

export const destroy = () => {
  if (typeof window === 'undefined') {
    return
  }

  if (!state) {
    log.warn('destroy() called but SDK is not initialized.')
    return
  }

  state.autoCapture.destroy()

  try {
    state.transport.destroy()
  } catch (err) {
    log.error('Error during transport destroy:', err)
  }

  destroySession()
  destroyProfile()
  configureBeforeSend(undefined)
  configureUrlRedaction(undefined)
  setDebugLogging(false)

  cookielessIdentifyWarned = false
  state = null
}

/**
 * Clears the current user's identity for a logout or account switch: a fresh session and device ID,
 * queued events beaconed once and then dropped off the device (consent is unchanged here, so they
 * were agreed to at collection time), and the stored profile removed — the next person on a shared
 * device must not inherit any of it. Not a consent change; that is optOutTracking()/
 * setTrackingConsent().
 *
 * Returns **false** when an identifier or queue key could not be verifiably removed — with
 * `crossSubdomainTracking` that means an identity cookie survived on the registrable domain. A
 * dropped farewell beacon logs at its own site but does not fail the reset: this boolean answers
 * for the device, and beacons fail routinely under content blockers.
 */
export const reset = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  if (!state) {
    log.warn('reset() called but SDK is not initialized.')
    return false
  }
  let ok = true
  try {
    // Aggregated, not merely called: resetIdentity()'s failure arms log and return rather than
    // throw, so a catch-only guard reported success with the previous user's ids still on the device.
    ok = resetIdentity() && ok
  } catch (err) {
    log.error('Failed to reset identity:', err)
    ok = false
  }
  // After identify() the queued events' distinctId is the outgoing user's externalId, so on a shared
  // device the next person must not inherit them. Sent once first — consent is unchanged here, so
  // they were agreed to at collection time.
  ok = purgeQueuedEvents({ send: true }).ok && ok
  try {
    ok = clearProfile() && ok
  } catch (err) {
    log.error('Failed to clear profile:', err)
    ok = false
  }
  return ok
}

/**
 * Never throws — invalid input, calls before init(), denied consent, dryRun, and RPC failures are
 * logged and the promise resolves without sending. Callers may await it without their own try/catch.
 * On first identify, includes anonymousId (for profile merge) and, if available, deviceId (for push device linking).
 */
export const identify = async (externalId: string, traits?: Record<string, JsonValue>): Promise<void> => {
  try {
    if (typeof window === 'undefined') {
      log.warn('identify() called in a non-browser environment, skipping.')
      return
    }
    if (!state) {
      log.warn('identify() called before init().')
      return
    }
    if (!externalId || typeof externalId !== 'string') {
      log.error('identify() requires a non-empty externalId string.')
      return
    }
    // The server reserves this prefix for cookieless-derived ids and enforces it with a CEL rule over
    // the whole BatchCreateRequest. Accepting one would persist it as the externalId — the distinctId
    // on every later event — so every batch containing this user would be rejected wholesale, with
    // nothing pointing back at the identify() that caused it.
    if (externalId.startsWith(RESERVED_DISTINCT_ID_PREFIX)) {
      log.error(
        `identify() rejected: externalId must not start with the reserved "${RESERVED_DISTINCT_ID_PREFIX}" prefix, which the server uses for cookieless identities.`,
      )
      return
    }
    if (!state.trackingConsent.isGranted()) {
      if (state.trackingConsent.getConsent() === 'cookieless') {
        // Warn, not debug: isTrackingEnabled() is true in cookieless, so the obvious pre-flight
        // check takes the branch, resolves cleanly and identifies nobody — and a debug-gated message
        // is invisible to exactly the integrator debugging that. Once per init(), since a cookieless
        // site may call identify() on every page.
        if (!cookielessIdentifyWarned) {
          cookielessIdentifyWarned = true
          log.warn(
            'identify() is disabled in cookieless mode and this call was dropped — grant consent to enable identity. Gate on getTrackingConsent() === "granted" rather than isTrackingEnabled(), which is true in cookieless mode.',
          )
        }
      } else {
        log.debug('identify() dropped because tracking consent is denied.')
      }
      return
    }
    if (state.dryRun) {
      log.debug('dryRun: would identify')
      return
    }

    const firstIdentify = !isIdentified()
    let deviceId = ''
    if (firstIdentify) {
      try {
        deviceId = localStorage.getItem(DEVICE_ID_KEY) ?? ''
      } catch (err) {
        log.warn('localStorage access failed for device ID, skipping push device linking:', err)
      }
    }

    const req = create(IdentifyRequestSchema, {
      externalId,
      traits,
      ...(firstIdentify && { anonymousId: getAnonymousId() }),
      ...(deviceId && { deviceId }),
    })

    try {
      await unaryCall(state.config.endpoint, state.apiKey, ProfilesSDKService.method.identify, req, ONE_SHOT_TIMEOUT_MS)
      markIdentified(externalId)
    } catch (err) {
      // The server is the sole validator by design, so a rejection here is the only signal that a
      // trait or externalId was invalid. Surfaced as-is, since RpcError carries the server's message.
      log.error('Failed to identify:', err)
    }
  } catch (err) {
    // Don't interpolate externalId: it is frequently PII (email, account id).
    log.error('Unexpected error in identify():', err)
  }
}

/** This function must never throw. Callers (e.g. monkey-patched history.pushState) rely on it being safe. */
export const track: TrackFn = (kind: string, props?: Record<string, unknown>, opts?: TrackOptions) => {
  try {
    if (typeof window === 'undefined') {
      return
    }

    if (!state) {
      log.warn('track() called before init().')
      return
    }

    const consent = state.trackingConsent.getConsent()

    // An allow-list, not a deny-check: written the other way an unhandled state fell through to the
    // full-identity arm, so a fourth state meaning "more restrictive than granted" would silently
    // get full tracking plus persisted identifiers. Here it drops, and `unreachable` makes widening
    // TrackingConsent a compile error at this dispatch — the one place that must decide.
    //
    // The cookieless arm never touches the identity modules, so their lazy-create/refresh paths
    // cannot write anything. Scoped to track(): init() and setTrackingConsent() do reach them.
    let identity: EventIdentity | null = null
    if (consent === 'granted') {
      identity = { sessionId: resolveSessionId(), distinctId: resolveDistinctId() }
    } else if (consent === 'cookieless') {
      identity = { cookieless: true }
    } else if (consent === 'denied') {
      log.debug(`track("${kind}") dropped because tracking consent is denied.`)
    } else {
      unreachable(consent)
      log.error(`track("${kind}") dropped: unhandled tracking consent state ${safeStringify(consent)}.`)
    }
    if (!identity) {
      return
    }

    log.debug(`track("${kind}")`)
    const immediate = opts?.immediate ?? false
    const event = toEvent(state.config.projectId, kind, identity, props, opts)
    if (!event) {
      // toEvent logged the reason (error, or debug for a beforeSend drop)
      return
    }
    if (state.dryRun) {
      log.debug(`dryRun: would send "${kind}"`)
      return
    }
    state.transport.send(event, { immediate }).catch((err: Error) => log.error(`Failed to send event "${kind}":`, err))
  } catch (err) {
    log.error(`Unexpected error in track("${kind}"):`, err)
  }
}
