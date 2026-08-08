export declare const DEVICE_ID_KEY = "pug_device_id";
/**
 * Reserved by the server for the daily-rotating ids it derives for cookieless events, enforced by
 * the `batch.distinct_id_reserved_prefix` CEL rule over the whole BatchCreateRequest.
 *
 * Shared by `identify()` (which rejects it as input) and `configureProfile()` (which rejects it on
 * restore): a device poisoned before the input check existed would otherwise keep replaying it.
 */
export declare const RESERVED_DISTINCT_ID_PREFIX = "cookieless-";
/** Default backend base URL used when `init()` is called without an explicit `endpoint`. */
export declare const DEFAULT_ENDPOINT = "https://api.pugs.dev";
export declare const makeStorageKey: (projectId: string, name: string) => string;
export declare const SECONDS_PER_DAY: number;
/**
 * Default retention for values persisted through the `PersistentStore`; override with
 * `init({ maxAgeDays })`. Not everything on the device: the batch queue, the tab registry and
 * `pug_device_id` stay on raw localStorage outside the store — the `maxAgeDays` JSDoc in `pug.ts`
 * names all three and why.
 */
export declare const DEFAULT_MAX_AGE_DAYS = 365;
/**
 * An enveloped stored string, as opposed to a bare value. The brand keeps the two apart at the
 * persistence↔cookie seam: `CookieLayer.set()` and the store's localStorage write accept only
 * enveloped strings, because a bare value written through either reads as undecodable and is
 * deleted by the store's next `getItem` — silent identity loss with no compile error. Reads stay
 * unbranded (`string`): what comes back off the device is not trustworthy enough to carry the brand.
 */
export type StoredEnvelope = string & {
    readonly __envelope: true;
};
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
export declare const encodeStored: (value: string, expiresAt: number) => StoredEnvelope;
/** Unwraps `encodeStored`'s envelope; null for a bare pre-envelope value or a malformed one. */
export declare const decodeStored: (raw: string | null) => {
    value: string;
    expiresAt: number;
} | null;
/**
 * Wired from `init({ redactUrlParams })`: `undefined` restores the default list, `false` disables
 * redaction, an array replaces the list. `init()` validates the untrusted value first (this module
 * stays free of imports so test suites can mock the logger).
 */
export declare const configureUrlRedaction: (params?: readonly string[] | false) => void;
/**
 * Redacts sensitive query/fragment params out of a captured URL. Never throws; returns the input
 * unchanged when nothing matched, so URLs are not re-encoded for no reason.
 */
export declare const scrubUrl: (raw: string) => string;
/**
 * True when `el` or any ancestor carries `data-pug-no-capture` — the marker integrators put on
 * sensitive DOM regions, covering everything inside it.
 *
 * Only free *text* is redacted; structural fields (`id`, `class`, `tag`, coordinates) are still sent
 * so the interaction keeps counting, so keep PII out of `id`/`class`.
 */
export declare const isCaptureSuppressed: (el: Element | null) => boolean;
/**
 * The element's own text, capped at `maxLength` — direct child text nodes only, never the subtree.
 * `innerText`/`textContent` return every descendant's, so clicking a card sent every name and email
 * it wrapped, and a `data-pug-no-capture` marker on the sensitive leaf never ran.
 */
export declare const getSafeElementText: (el: Element | null, maxLength: number) => string;
/**
 * JSON.stringify for log interpolation of untrusted values — the values being *rejected* are
 * exactly the ones most likely to make JSON.stringify itself throw (circular refs, bigint, a
 * throwing toJSON), which turned a validation warning into an exception out of the validator.
 * Never throws; JSON.stringify's `undefined` results (undefined itself, functions, symbols) fall
 * through to String() rather than interpolating as the literal text "undefined" of a missing value.
 */
export declare const safeStringify: (value: unknown) => string;
export declare const isStorageAvailable: () => boolean;
