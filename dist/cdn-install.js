import { log } from './logger.js';
/**
 * Every method the loader snippet stubs and `cdn.ts` installs on `window.pug` — the single source
 * of truth for the copies that must agree: the `api` object in `cdn.ts` (enforced at compile time
 * via `satisfies`), the snippet's method string in README.md (enforced by the snippet
 * fixture test), and the test expectations.
 */
export const STUB_METHODS = [
    'init',
    'track',
    'identify',
    'reset',
    'destroy',
    'setAutoCapture',
    'setTrackingConsent',
    'optInTracking',
    'optOutTracking',
    'isTrackingEnabled',
    'getTrackingConsent',
    'isConsentPending',
    'rotate',
    'ready',
];
/**
 * Methods that work without init() and so are exempt from replayQueue's "queued before pug.init()"
 * warning. Grows alongside STUB_METHODS when init-independent features ship (e.g. push).
 */
const INIT_INDEPENDENT_METHODS = new Set(['ready']);
/**
 * Installs the real API over the snippet stub (or a fresh object for bare script-tag loads) and
 * returns the drained queue for the entry to replay. Returns `null` when installation must not
 * proceed: `window.pug` already holds a loaded SDK (duplicate script tag, GTM double-fire, SPA
 * re-mount) or a foreign object (e.g. the pug template-engine runtime) — never clobber either.
 */
export const installPug = (w, api) => {
    const existing = w.pug;
    if (existing != null && typeof existing.__loaded === 'string') {
        log.warn(`Pug SDK v${existing.__loaded} is already loaded; ignoring duplicate load of v${api.version}.`);
        return null;
    }
    if (existing != null && !Array.isArray(existing._q)) {
        log.warn('window.pug is already defined and is not the Pug loader stub; leaving it untouched — the Pug SDK is not installed.');
        return null;
    }
    const target = existing ?? {};
    const queue = Array.isArray(target._q) ? target._q : [];
    // Drain without replacing the array: snippet stub methods close over this exact array.
    const pending = queue.splice(0, queue.length);
    for (const key of Object.keys(api)) {
        target[key] = api[key];
    }
    target.__loaded = api.version;
    const dispatch = (call) => {
        if (!Array.isArray(call)) {
            log.warn('Ignoring malformed queue entry (expected a [method, args] tuple):', call);
            return;
        }
        const method = call[0];
        // Own-property lookup only: api[method] would otherwise resolve inherited Object.prototype
        // members (constructor, toString, hasOwnProperty), invoking them instead of failing closed.
        const fn = Object.prototype.hasOwnProperty.call(api, method) ? api[method] : undefined;
        if (typeof fn !== 'function') {
            log.warn(`Ignoring queued call to unknown method "${String(method)}".`);
            return;
        }
        try {
            // Queued callers received undefined instead of the real return value, so nobody can .catch()
            // a promise-returning method — log its rejection here or it becomes an unhandled rejection.
            const result = fn(...Array.from(call[1] ?? []));
            if (result != null && typeof result.then === 'function') {
                result.then(undefined, (err) => {
                    log.error(`Queued ${method}() call rejected:`, err);
                });
            }
        }
        catch (err) {
            // A queued init('') throws by design; one bad call must not kill the rest of the replay.
            log.error(`Queued ${method}() call failed:`, err);
        }
    };
    // Stub *method* references captured before load push into the original array. Route those late
    // pushes to live dispatch so they are not silently parked in a drained queue. (This also keeps
    // the snippet's 1,000-entry cap inert after load: the queue length stays 0.)
    queue.push = (...calls) => {
        for (const call of calls) {
            dispatch(call);
        }
        return queue.length;
    };
    target._q = queue;
    if (existing == null) {
        w.pug = target;
    }
    return { pending, dispatch };
};
/**
 * Replays queued calls in strict FIFO order (each isolated by `dispatch`'s try/catch). No
 * init-hoisting: reordering would change consent semantics — an init with autocapture enabled
 * fires a page view before a queued optOutTracking() would replay. `initialized` means auto-init
 * already ran, so nothing precedes init even when the queue itself contains no init call.
 */
export const replayQueue = (pending, dispatch, initialized) => {
    if (!initialized) {
        const firstInit = pending.findIndex(call => Array.isArray(call) && call[0] === 'init');
        const dropped = pending.filter((call, i) => (firstInit === -1 || i < firstInit) && Array.isArray(call) && !INIT_INDEPENDENT_METHODS.has(call[0]));
        if (dropped.length > 0) {
            const names = dropped.map(call => `${call[0]}()`).join(', ');
            log.warn(`${dropped.length} call(s) were queued before pug.init() and will be dropped by the SDK (${names}). Call ` +
                'pug.init() first in your snippet. To start opted out, pass the trackingConsent init option instead of ' +
                'calling optOutTracking() before init.');
        }
    }
    for (const call of pending) {
        dispatch(call);
    }
};
/**
 * One-tag install: initializes from the script tag's data attributes when the page used
 * `<script src=... data-project-id=... data-api-key=... [data-endpoint=...] [data-options='{…}']>`
 * instead of the loader snippet. Returns whether init ran. Silent only when NO auto-init attribute
 * is present (the loader-snippet case); any present-but-empty or partial set is one-tag intent
 * with a broken config (e.g. a failed server-side template interpolation) and must be loud. Fails
 * closed on any malformed input — initializing with half a config could violate an intended
 * consent default (e.g. a mangled `trackingConsent` in data-options must not fall back to consent
 * granted).
 */
export const autoInitFromScript = (script, initFn) => {
    if (!script || typeof script.getAttribute !== 'function') {
        return false;
    }
    const projectId = script.getAttribute('data-project-id');
    const apiKey = script.getAttribute('data-api-key');
    const rawOptions = script.getAttribute('data-options');
    const rawEndpoint = script.getAttribute('data-endpoint');
    if (projectId === null && apiKey === null && rawOptions === null && rawEndpoint === null) {
        return false;
    }
    if (!projectId || !apiKey) {
        const bad = [!projectId && 'data-project-id', !apiKey && 'data-api-key'].filter(Boolean).join(', ');
        log.error(`Auto-init requires non-empty data-project-id and data-api-key (missing/empty: ${bad}); not initializing.`);
        return false;
    }
    let extra = {};
    if (rawOptions) {
        let parsed;
        try {
            parsed = JSON.parse(rawOptions);
        }
        catch (err) {
            log.error('Invalid data-options JSON; skipping auto-init:', err);
            return false;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            log.error('data-options must be a JSON object; skipping auto-init.');
            return false;
        }
        extra = parsed;
    }
    try {
        // Flat attributes win over data-options keys; an empty data-endpoint counts as absent.
        initFn(projectId, { ...extra, apiKey, ...(rawEndpoint ? { endpoint: rawEndpoint } : {}) });
        return true;
    }
    catch (err) {
        log.error('Auto-init failed:', err);
        return false;
    }
};
