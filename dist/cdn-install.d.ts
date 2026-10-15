/**
 * Every method the loader snippet stubs and `cdn.ts` installs on `window.pug` — the single source
 * of truth for the copies that must agree: the `api` object in `cdn.ts` (enforced at compile time
 * via `satisfies`), the snippet's method string in README.md (enforced by the snippet
 * fixture test), and the test expectations.
 */
export declare const STUB_METHODS: readonly ['init', 'track', 'identify', 'reset', 'destroy', 'setAutoCapture', 'setTrackingConsent', 'optInTracking', 'optOutTracking', 'isTrackingEnabled', 'getTrackingConsent', 'isConsentPending', 'rotate', 'ready'];
export type StubMethod = (typeof STUB_METHODS)[number];
/** One call recorded by the loader snippet before the bundle loaded: [method name, arguments]. */
export type QueuedCall = [string, ArrayLike<unknown>];
/**
 * The object the loader snippet leaves on `window.pug` before this bundle loads: `_q` holds the
 * calls made before load (capped at 1,000 entries by the snippet so a blocked bundle cannot grow
 * memory unboundedly), `_v` is the snippet format version, and every public method is a stub that
 * pushes into `_q`. After install the same object (identity preserved — integrators may have
 * captured references to it) carries the real API plus `__loaded` (the SDK version), which doubles
 * as the duplicate-load sentinel.
 */
export interface PugStub {
    _q?: QueuedCall[];
    _v?: number;
    __loaded?: string;
    [key: string]: unknown;
}
/** The API surface `cdn.ts` installs on `window.pug`. */
export type CdnApi = {
    readonly version: string;
} & Record<string, unknown>;
export interface InstallResult {
    readonly pending: readonly QueuedCall[];
    readonly dispatch: (call: QueuedCall) => void;
}
/**
 * Installs the real API over the snippet stub (or a fresh object for bare script-tag loads) and
 * returns the drained queue for the entry to replay. Returns `null` when installation must not
 * proceed: `window.pug` already holds a loaded SDK (duplicate script tag, GTM double-fire, SPA
 * re-mount) or a foreign object (e.g. the pug template-engine runtime) — never clobber either.
 */
export declare const installPug: (w: {
    pug?: PugStub;
}, api: CdnApi) => InstallResult | null;
/**
 * Replays queued calls in strict FIFO order (each isolated by `dispatch`'s try/catch). No
 * init-hoisting: reordering would change consent semantics — an init with autocapture enabled
 * fires a page view before a queued optOutTracking() would replay. `initialized` means auto-init
 * already ran, so nothing precedes init even when the queue itself contains no init call.
 */
export declare const replayQueue: (pending: readonly QueuedCall[], dispatch: (call: QueuedCall) => void, initialized: boolean) => void;
type InitFn = (projectId: string, options: {
    apiKey: string;
}) => void;
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
export declare const autoInitFromScript: (script: Element | null | undefined, initFn: InitFn) => boolean;
export {};
