import { create } from '@bufbuild/protobuf';
import { createAutoCaptureController, } from './auto-capture.js';
import { createBatchedTransport } from './batch.js';
import { createCookieLayer } from './cookie.js';
import { IdentifyRequestSchema, ProfilesSDKService } from './gen/sdk/profiles/v1/profiles_pb.js';
import { log, setDebugLogging } from './logger.js';
import { initUserAgentData } from './parsers.js';
import { createPersistentStore } from './persistence.js';
import { clearProfile, configureProfile, destroyProfile, getAnonymousId, isIdentified, markIdentified, resolveDistinctId, } from './profile.js';
import { ONE_SHOT_TIMEOUT_MS, unaryCall } from './rpc.js';
import { clearSession, configureSession, destroySession, onConsentGranted, resetIdentity, resolveSessionId, } from './session.js';
import { configureBeforeSend, toEvent, } from './track.js';
import { createTrackingConsent, deferredGrantedGate, } from './tracking-consent.js';
import { configureUrlRedaction, DEFAULT_ENDPOINT, DEVICE_ID_KEY, isAutomatedBrowser, isAutomationSuppressed, RESERVED_DISTINCT_ID_PREFIX, safeStringify, setAutomationSuppressed, } from './utils.js';
let state = null;
// One-shot so a cookieless site calling identify() on every page doesn't spam the console.
let cookielessIdentifyWarned = false;
// A suppressed init() also leaves no state, so "called before init()" would send an integrator
// hunting for a call they made. Debug: the bail already warned, and a suite may call these per page.
const reportNoState = (fn, preInitMessage) => {
    if (isAutomationSuppressed()) {
        log.debug(`${fn}() ignored: this browser was excluded as automation by excludeAutomatedBrowsers.`);
        return;
    }
    log.warn(preInitMessage);
};
/**
 * Compile-time exhaustiveness marker: reaching it with a non-`never` argument is a type error, so
 * widening a union forces every dispatch over it to be revisited.
 *
 * Deliberately does not throw: the caller's `else` branch already logs the offending state by name,
 * and a throw would be swallowed by track()'s own try/catch and replace that with a generic message.
 */
const unreachable = (_state) => { };
// Untrusted: the one-tag install feeds this from `data-options` JSON, where `"redactUrlParams":
// "token"` is the obvious mistake. Falling back to the default list keeps redaction on.
const resolveRedactUrlParams = (params) => {
    if (params === undefined || params === false) {
        return params;
    }
    if (!Array.isArray(params) || params.some(p => typeof p !== 'string')) {
        log.warn('redactUrlParams must be an array of strings or `false`; using the default redaction list.');
        return undefined;
    }
    // An empty list matches nothing, so it disables redaction exactly like `false` but silently —
    // and `userList.filter(...)` coming up empty reaches it without anyone meaning to.
    if (params.length === 0) {
        log.warn('redactUrlParams is empty, which would disable URL redaction; using the default list. Pass `false` to disable it deliberately.');
        return undefined;
    }
    return params;
};
// Untrusted: one-tag installs feed these from JSON, where `"dryRun": "false"` is truthy and so
// silently enables what it names. Warn rather than coerce — coercing would move existing behavior.
const warnOnNonBoolean = (options, key) => {
    const value = options[key];
    if (value !== undefined && typeof value !== 'boolean') {
        log.warn(`${key} must be a boolean; received ${typeof value}. See the README options table.`);
    }
};
// High-entropy client hints are themselves a device read, so skip them for an untracked user. Takes
// the branded gate: passing `isGranted` here would silently stop warming hints in cookieless mode,
// and both are `() => boolean`, so only the brand makes that a compile error.
const warmUserAgentData = (isTracking) => {
    if (!isTracking()) {
        return;
    }
    try {
        initUserAgentData();
    }
    catch (err) {
        log.warn('Failed to initialize user agent data:', err);
    }
};
// Events carry URLs, referrers and identifiers; over http they cross the network in the clear.
// A warning, not a refusal — a self-hosted collector on localhost is a legitimate dev setup.
const warnOnInsecureEndpoint = (endpoint) => {
    try {
        const { protocol, hostname } = new URL(endpoint);
        const localhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
        if (protocol !== 'https:' && !localhost) {
            log.warn(`endpoint "${endpoint}" is not https — events will be sent unencrypted.`);
        }
    }
    catch {
        log.warn(`endpoint "${endpoint}" is not a valid URL.`);
    }
};
/**
 * Reports a failed `init()` phase without letting it escape — `init()` must not throw into a host
 * application, and the SDK still runs (degraded) with the phase skipped.
 *
 * A `TypeError` here is one of the three consent-gate head guards firing: an SDK wiring fault, not a
 * hostile browser, so it is reported at error and named as such rather than as a warn that reads
 * like a blocked cookie store. @see docs/design-notes/tracking-consent.md#the-head-guards
 */
const reportInitFailure = (what, err) => {
    if (err instanceof TypeError) {
        log.error(`Failed to ${what} — an SDK wiring error, not an environment failure:`, err);
        return;
    }
    log.warn(`Failed to ${what}:`, err);
};
export const init = (projectId, options) => {
    if (typeof window === 'undefined') {
        log.warn('init() called in a non-browser environment, skipping.');
        return;
    }
    if (!projectId || typeof projectId !== 'string') {
        throw new Error('[Pug SDK] projectId is required and must be a non-empty string');
    }
    if (!options.apiKey || typeof options.apiKey !== 'string') {
        throw new Error('[Pug SDK] apiKey is required and must be a non-empty string');
    }
    if (state) {
        log.warn('Already initialized.');
        return;
    }
    // Before any other setup, so init's own debug output is captured too.
    setAutomationSuppressed(false);
    setDebugLogging(options.debug ?? false);
    const config = { endpoint: options.endpoint || DEFAULT_ENDPOINT, projectId };
    // Validate-and-log only, above the bail: the automated browser is CI, where a config mistake is
    // likeliest to be read.
    warnOnInsecureEndpoint(config.endpoint);
    warnOnNonBoolean(options, 'debug');
    warnOnNonBoolean(options, 'dryRun');
    warnOnNonBoolean(options, 'excludeAutomatedBrowsers');
    // No compiler protects a JS or one-tag install, so a silently ignored sanitizer means URLs the
    // integrator believes are masked lose that masking.
    if ('sanitizeUrl' in options) {
        log.warn('sanitizeUrl was removed and is ignored. Known-sensitive query and fragment params are redacted by default (see redactUrlParams); any further masking belongs in beforeSend.');
    }
    const redactUrlParams = resolveRedactUrlParams(options.redactUrlParams);
    // Ahead of every listener, storage write and network call — the server can only tag automation,
    // and a tagged event is still metered. Warn, not debug: whoever debugs the silence didn't set it.
    if (options.excludeAutomatedBrowsers === true && isAutomatedBrowser()) {
        setAutomationSuppressed(true);
        log.warn('Automated browser detected (WebDriver or headless Chrome) and excludeAutomatedBrowsers is set — this SDK instance is inert: no listeners, no storage, no events, and stored identity is left untouched. Remove excludeAutomatedBrowsers to track this traffic.');
        return;
    }
    // Late-bound: the controller needs the store, the store needs the cookie layer. Until the
    // assignment below the gate reads as *not granted* — see deferredGrantedGate for why that
    // fail-closed window is sound whatever runs inside it, and costless today: the one store access
    // in it is the consent-record read, whose own ungated restore re-write lands the value on the
    // shared domain that the suppressed twin promotion would have.
    let consentRef = null;
    const cookieGate = deferredGrantedGate(() => consentRef);
    let store = null;
    try {
        // The cookie probes (availability + domain discovery) run before consent is read: the consent
        // record itself may ride the shared cookie, so the layer cannot wait on the answer. They are
        // capability checks — random names, max-age ≤ 3s, deleted on the spot — never identifiers.
        store = createPersistentStore(createCookieLayer(options.crossSubdomainTracking ?? false, cookieGate), options.maxAgeDays);
    }
    catch (err) {
        reportInitFailure('initialize persistence', err);
    }
    // Before configureProfile, so its init-time expiry refresh can be gated on consent — no identity
    // cookie write while denied (threat model constraint #6, in the backend `pug` repo).
    const trackingConsent = createTrackingConsent(projectId, options.trackingConsent, store);
    consentRef = trackingConsent;
    try {
        configureSession(projectId, options.session, store, trackingConsent.isGranted);
    }
    catch (err) {
        reportInitFailure('configure session tracking', err);
    }
    try {
        configureProfile(projectId, store, trackingConsent.isGranted);
    }
    catch (err) {
        reportInitFailure('configure profile', err);
    }
    warmUserAgentData(trackingConsent.isTracking);
    configureBeforeSend(options.beforeSend);
    configureUrlRedaction(redactUrlParams);
    const transport = createBatchedTransport(config.endpoint, options.apiKey, projectId, options.batch);
    const autoCapture = createAutoCaptureController(track, trackingConsent.isTracking);
    state = {
        config,
        transport,
        apiKey: options.apiKey,
        dryRun: options.dryRun ?? false,
        autoCapture,
        trackingConsent,
    };
    if (state.dryRun) {
        log.warn('Dry run mode enabled — events will not be sent.');
    }
    if (state.trackingConsent.getConsent() === 'denied') {
        log.warn('Tracking consent is denied — automatic capture is off and track()/identify() are dropped until optInTracking() is called. Check isTrackingEnabled() to detect this state.');
    }
    if (state.trackingConsent.getConsent() === 'cookieless') {
        log.debug('Cookieless mode: events flow without stored identity; identify() is disabled until consent is granted.');
    }
    // Entering a non-granted state via config must leave the device as setTrackingConsent() would.
    // Gated on isAuthoritative() so it only fires for the user's own recorded choice — without
    // persistence the value is a per-load placeholder, and purging on that mints a new identity every
    // load. @see docs/design-notes/pug.md#non-granted-init
    if (!state.trackingConsent.isGranted()) {
        if (state.trackingConsent.isAuthoritative()) {
            // purgePersistedIdentity() drops the queue first, so it is not purged separately here.
            // init() returns void, so this outcome must not be left to be inferred from per-key errors: a
            // purge that did not land means a later optInTracking() resumes the PRE-EXISTING identity.
            if (!purgePersistedIdentity({ dropQueue: true })) {
                log.error('Could not fully remove stored identity for a non-granted consent state. Identifiers may survive on this device, and granting consent later may resume the previous identity rather than minting a fresh one.');
            }
        }
        else {
            // The queue goes either way, unlike identity: it is an outbound buffer, not an identifier a
            // later grant could resolve.
            const queueDropped = purgeQueuedEvents({ send: false }).ok;
            // Identity is deliberately skipped — see isAuthoritative() — and saying so is what tells an
            // integrator passing a bare 'cookieless'/'denied' that the documented purge did not run. The
            // phrase is conditioned on the result: unconditional, it contradicted the queue's own error.
            log.debug(`Consent is not granted but was not restored from storage, so it is a config seed rather than a recorded choice — ${queueDropped
                ? 'the queued-events purge landed'
                : 'the queued-events purge did not fully land (see the error above)'}, and stored identity was left in place. Use trackingConsent.persist to record the choice.`);
            // Debug above, because this branch is a no-op on every default install — which is also why it
            // could never reach the case it exists for. isIdentified() separates the two: a true here
            // means a durable, routinely email-shaped identifier is being kept under a state the
            // integrator spelled as non-granted, so it warns.
            // @see docs/design-notes/pug.md#non-granted-init
            if (isIdentified()) {
                log.warn("Consent is not granted, but a previous identify() left an externalId on this device and it was NOT removed: the state came from config rather than from storage, so it may be a pre-banner placeholder rather than the user's choice. Pass trackingConsent.persist to record real choices, or call optOutTracking() once the user has actually rejected.");
            }
        }
    }
    state.autoCapture.setDesired(options.autoCapture);
    log.debug('Initialized.');
};
export const setAutoCapture = (autoCapture) => {
    if (!state) {
        reportNoState('setAutoCapture', 'setAutoCapture() called before init().');
        return;
    }
    state.autoCapture.setDesired(autoCapture);
    // isTracking, not isGranted: the controller attaches listeners whenever events flow, which
    // includes cookieless. Keying this on full consent printed "activate after opt-in" in cookieless
    // mode, where they had already activated — the exact conflation the predicate split prevents.
    if (!state.trackingConsent.isTracking()) {
        log.debug('setAutoCapture() stored selection; listeners activate after opt-in.');
    }
};
/**
 * Drops the queued events off the device. `send: false` on every consent teardown — beaconing after
 * a withdrawal is a fresh transmission of the data just refused; `reset()` sends first.
 *
 * Split from the identity purge because the queue is an outbound buffer, not an identifier anything
 * reads back, so `isAuthoritative()` does not apply to it.
 * @see docs/design-notes/pug.md#non-granted-init
 */
const purgeQueuedEvents = ({ send }) => {
    // A null state means the transport was never built, so the queue was not purged. Report that
    // rather than defaulting to success inside a privacy teardown.
    if (!state) {
        return { ok: false, destroyed: 0 };
    }
    try {
        // No message for `ok: false` or a dropped beacon — the queue's own purge() and reportBeaconLoss
        // each report at their site with the cause in hand; anything here would guess at both.
        const result = state.transport.purgeQueue({ send });
        // Keyed on `destroyed`, not a buffer count, so a purge that left the persisted key behind claims
        // no destruction — and on `!send`, since reset() beacons them out first.
        // @see docs/design-notes/pug.md#purge-reporting
        if (!send && result.destroyed > 0) {
            log.warn(`Dropped ${result.destroyed} queued event(s) collected under a previous consent state, unsent — they may include identified payloads, which must not be held or transmitted once consent is no longer granted.`);
        }
        return result;
    }
    catch (err) {
        log.error('Failed to purge queued events:', err);
        return { ok: false, destroyed: 0 };
    }
};
/**
 * Drops every persisted identifier: anonymous ID, external ID, session, and the tab registry —
 * including the shared cookie in cross-subdomain mode, so the purge propagates to sibling
 * subdomains. Returns false when any removal could not be confirmed, which in cross-subdomain
 * mode means an identity cookie survived on the registrable domain and will resurface.
 *
 * Idempotent in end state but not side-effect-free: it issues removals (cookie deletions when
 * cross-subdomain) and may log an error on an unconfirmed removal even when nothing was stored.
 *
 * `dropQueue` states that this purge accompanies a consent *reduction*. The identity removals are
 * end-state no-ops on a re-assert; the queue drop is not.
 * @see docs/design-notes/pug.md#dropqueue
 */
const purgePersistedIdentity = ({ dropQueue }) => {
    // Runs first, while those events still exist.
    let purged = dropQueue ? purgeQueuedEvents({ send: false }).ok : true;
    try {
        purged = clearProfile() && purged;
    }
    catch (err) {
        log.error('Failed to clear profile:', err);
        purged = false;
    }
    try {
        purged = clearSession() && purged;
    }
    catch (err) {
        log.error('Failed to clear session:', err);
        purged = false;
    }
    return purged;
};
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
 * `false` means "applied, not fully durable" rather than "ignored" — only the pre-`init()` case and
 * an `excludeAutomatedBrowsers` bail are genuinely ignored, the first of which a banner racing
 * initialization is most likely to hit. A failed
 * tab-registry re-arm on entering `'granted'` warns without failing the call: it is neither
 * identity nor durability, and a later grant or `init()` re-arms it.
 */
export const setTrackingConsent = (consent) => {
    if (!state) {
        reportNoState('setTrackingConsent', 'setTrackingConsent() called before init().');
        return false;
    }
    const wasTracking = state.trackingConsent.isTracking();
    const wasGranted = state.trackingConsent.isGranted();
    let ok = state.trackingConsent.set(consent);
    const resolved = state.trackingConsent.getConsent();
    // Consent side effects run before apply(), matching init(). The order is defense in depth: the
    // drop predicate below never purges on a transition that arms a tracker, but if that invariant
    // ever loosens, purging after apply() would destroy the newly-armed tracker's synchronous
    // page_view — the first event of every mid-page cookieless session — unsent.
    if (resolved === 'granted') {
        // Re-arm the tab-liveness registry configureSession() skipped while consent withheld it.
        // Without this the "all tabs closed → rotate" heuristic stays dead for the page's life — and
        // under the README's consent-first flow it would never arm at all.
        try {
            onConsentGranted();
        }
        catch (err) {
            log.warn('Failed to re-arm tab tracking after consent was granted:', err);
        }
    }
    else {
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
        const dropQueue = resolved === 'denied' || wasGranted;
        ok = purgePersistedIdentity({ dropQueue }) && ok;
    }
    state.autoCapture.apply();
    // Only on the transition *into* tracking: initUserAgentData() clears the hint cache synchronously
    // and refills it asynchronously, so a re-assert would drop $osVersion/$device from every event
    // until the new request resolved.
    if (!wasTracking) {
        warmUserAgentData(state.trackingConsent.isTracking);
    }
    log.debug(`Tracking consent set to "${resolved}".`);
    return ok;
};
export const optInTracking = () => {
    if (!state) {
        // Guarded so the warning names this function rather than setTrackingConsent, matching optOut.
        reportNoState('optInTracking', 'optInTracking() called before init().');
        return false;
    }
    return setTrackingConsent('granted');
};
/**
 * Applies the rejection state: `'denied'`, or `trackingConsent.onReject` when configured — pass
 * `onReject: 'cookieless'` and the banner's reject branch keeps identity-free traffic counts without
 * naming the state itself. Either way persisted identity is torn down (see setTrackingConsent);
 * consent stays persisted so the rejection survives reloads.
 */
export const optOutTracking = () => {
    if (!state) {
        reportNoState('optOutTracking', 'optOutTracking() called before init().');
        return false;
    }
    return setTrackingConsent(state.trackingConsent.getRejectState());
};
/**
 * Whether events are being tracked right now — true for granted **and** cookieless; use
 * `getTrackingConsent()` to distinguish them. Reflects consent only, independent of `dryRun`.
 * `false` before `init()` is accurate rather than a placeholder: nothing is being tracked yet.
 */
export const isTrackingEnabled = () => {
    if (!state) {
        reportNoState('isTrackingEnabled', 'isTrackingEnabled() called before init().');
        return false;
    }
    return state.trackingConsent.isTracking();
};
/**
 * The consent state the SDK is acting on, or `undefined` before `init()` — a persisted choice is only
 * read from storage during `init()`, so before then there is genuinely no answer. `undefined` rather
 * than `'denied'`, which a banner would read as a real opt-out and re-prompt someone who opted in.
 */
export const getTrackingConsent = () => {
    if (!state) {
        reportNoState('getTrackingConsent', 'getTrackingConsent() called before init(); returning undefined — a persisted choice is only read during init().');
        return undefined;
    }
    return state.trackingConsent.getConsent();
};
/**
 * Whether the user has yet to make a choice — the banner gate. `getTrackingConsent()` cannot answer
 * this: before any answer it reports the `initial` seed, so a seeded state and a chosen one read
 * identically. `true` before `init()`, since nothing has been read from storage yet.
 */
export const isConsentPending = () => {
    if (!state) {
        reportNoState('isConsentPending', 'isConsentPending() called before init(); returning true — a persisted choice is only read during init().');
        return true;
    }
    return state.trackingConsent.isPending();
};
export const destroy = () => {
    if (typeof window === 'undefined') {
        return;
    }
    if (!state) {
        reportNoState('destroy', 'destroy() called but SDK is not initialized.');
        // A suppressed init() returns after setDebugLogging() but before state, so both are ours to undo.
        setAutomationSuppressed(false);
        setDebugLogging(false);
        return;
    }
    state.autoCapture.destroy();
    try {
        state.transport.destroy();
    }
    catch (err) {
        log.error('Error during transport destroy:', err);
    }
    destroySession();
    destroyProfile();
    configureBeforeSend(undefined);
    configureUrlRedaction(undefined);
    setDebugLogging(false);
    cookielessIdentifyWarned = false;
    setAutomationSuppressed(false);
    state = null;
};
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
export const reset = () => {
    if (typeof window === 'undefined') {
        return false;
    }
    if (!state) {
        reportNoState('reset', 'reset() called but SDK is not initialized.');
        return false;
    }
    let ok = true;
    try {
        // Aggregated, not merely called: resetIdentity()'s failure arms log and return rather than
        // throw, so a catch-only guard reported success with the previous user's ids still on the device.
        ok = resetIdentity() && ok;
    }
    catch (err) {
        log.error('Failed to reset identity:', err);
        ok = false;
    }
    // After identify() the queued events' distinctId is the outgoing user's externalId, so on a shared
    // device the next person must not inherit them. Sent once first — consent is unchanged here, so
    // they were agreed to at collection time.
    ok = purgeQueuedEvents({ send: true }).ok && ok;
    try {
        ok = clearProfile() && ok;
    }
    catch (err) {
        log.error('Failed to clear profile:', err);
        ok = false;
    }
    return ok;
};
/**
 * Never throws — invalid input, calls before init(), denied consent, dryRun, and RPC failures are
 * logged and the promise resolves without sending. Callers may await it without their own try/catch.
 * On first identify, includes anonymousId (for profile merge) and, if available, deviceId (for push device linking).
 */
export const identify = async (externalId, traits) => {
    try {
        if (typeof window === 'undefined') {
            log.warn('identify() called in a non-browser environment, skipping.');
            return;
        }
        if (!state) {
            reportNoState('identify', 'identify() called before init().');
            return;
        }
        if (!externalId || typeof externalId !== 'string') {
            log.error('identify() requires a non-empty externalId string.');
            return;
        }
        // The server reserves this prefix for cookieless-derived ids and enforces it with a CEL rule over
        // the whole BatchCreateRequest. Accepting one would persist it as the externalId — the distinctId
        // on every later event — so every batch containing this user would be rejected wholesale, with
        // nothing pointing back at the identify() that caused it.
        if (externalId.startsWith(RESERVED_DISTINCT_ID_PREFIX)) {
            log.error(`identify() rejected: externalId must not start with the reserved "${RESERVED_DISTINCT_ID_PREFIX}" prefix, which the server uses for cookieless identities.`);
            return;
        }
        if (!state.trackingConsent.isGranted()) {
            if (state.trackingConsent.getConsent() === 'cookieless') {
                // Warn, not debug: isTrackingEnabled() is true in cookieless, so the obvious pre-flight
                // check takes the branch, resolves cleanly and identifies nobody — and a debug-gated message
                // is invisible to exactly the integrator debugging that. Once per init(), since a cookieless
                // site may call identify() on every page.
                if (!cookielessIdentifyWarned) {
                    cookielessIdentifyWarned = true;
                    log.warn('identify() is disabled in cookieless mode and this call was dropped — grant consent to enable identity. Gate on getTrackingConsent() === "granted" rather than isTrackingEnabled(), which is true in cookieless mode.');
                }
            }
            else {
                log.debug('identify() dropped because tracking consent is denied.');
            }
            return;
        }
        if (state.dryRun) {
            log.debug('dryRun: would identify');
            return;
        }
        const firstIdentify = !isIdentified();
        let deviceId = '';
        if (firstIdentify) {
            try {
                deviceId = localStorage.getItem(DEVICE_ID_KEY) ?? '';
            }
            catch (err) {
                log.warn('localStorage access failed for device ID, skipping push device linking:', err);
            }
        }
        const req = create(IdentifyRequestSchema, {
            externalId,
            traits,
            ...(firstIdentify && { anonymousId: getAnonymousId() }),
            ...(deviceId && { deviceId }),
        });
        try {
            await unaryCall(state.config.endpoint, state.apiKey, ProfilesSDKService.method.identify, req, ONE_SHOT_TIMEOUT_MS);
            markIdentified(externalId);
        }
        catch (err) {
            // The server is the sole validator by design, so a rejection here is the only signal that a
            // trait or externalId was invalid. Surfaced as-is, since RpcError carries the server's message.
            log.error('Failed to identify:', err);
        }
    }
    catch (err) {
        // Don't interpolate externalId: it is frequently PII (email, account id).
        log.error('Unexpected error in identify():', err);
    }
};
/** This function must never throw. Callers (e.g. monkey-patched history.pushState) rely on it being safe. */
export const track = (kind, props, opts) => {
    try {
        if (typeof window === 'undefined') {
            return;
        }
        if (!state) {
            reportNoState('track', 'track() called before init().');
            return;
        }
        const consent = state.trackingConsent.getConsent();
        // An allow-list, not a deny-check: written the other way an unhandled state fell through to the
        // full-identity arm, so a fourth state meaning "more restrictive than granted" would silently
        // get full tracking plus persisted identifiers. Here it drops, and `unreachable` makes widening
        // TrackingConsent a compile error at this dispatch — the one place that must decide.
        //
        // The cookieless arm never touches the identity modules, so their lazy-create/refresh paths
        // cannot write anything. Scoped to track(): init() and setTrackingConsent() do reach them.
        let identity = null;
        if (consent === 'granted') {
            identity = { sessionId: resolveSessionId(), distinctId: resolveDistinctId() };
        }
        else if (consent === 'cookieless') {
            identity = { cookieless: true };
        }
        else if (consent === 'denied') {
            log.debug(`track("${kind}") dropped because tracking consent is denied.`);
        }
        else {
            unreachable(consent);
            log.error(`track("${kind}") dropped: unhandled tracking consent state ${safeStringify(consent)}.`);
        }
        if (!identity) {
            return;
        }
        log.debug(`track("${kind}")`);
        const immediate = opts?.immediate ?? false;
        const event = toEvent(state.config.projectId, kind, identity, props, opts);
        if (!event) {
            // toEvent logged the reason (error, or debug for a beforeSend drop)
            return;
        }
        if (state.dryRun) {
            log.debug(`dryRun: would send "${kind}"`);
            return;
        }
        state.transport.send(event, { immediate }).catch((err) => log.error(`Failed to send event "${kind}":`, err));
    }
    catch (err) {
        log.error(`Unexpected error in track("${kind}"):`, err);
    }
};
