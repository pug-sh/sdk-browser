import type { CookieLayer } from './cookie.js';
/**
 * Layered key-value persistence: an optional cross-subdomain cookie layer over localStorage.
 * Reads prefer the cookie (it is the shared source of truth across subdomains — a stale per-origin
 * localStorage value must not shadow it); writes go to every available layer; methods never throw.
 *
 * Every value carries an absolute expiry (see `encodeStored`), so nothing stored here outlives
 * `maxAgeDays` in any mode — including plain localStorage, which has no expiry of its own.
 * @see docs/design-notes/persistence.md
 */
export interface PersistentStore {
    /**
     * A read can delete: an expired or undecodable stored value is removed on sight rather than
     * ignored, logging an error when that removal cannot be confirmed. A pre-envelope value from an
     * older build reads as absent — see `getItemOrLegacy`.
     * @see docs/design-notes/persistence.md#retention
     */
    getItem(key: string): string | null;
    /**
     * `getItem`, but a pre-envelope (undecodable) value is returned instead of read as absent. It is
     * still removed from the device either way, so retention cannot be evaded; the caller validates
     * it and re-persists through `setItem`, which stamps a fresh envelope.
     *
     * A separate method rather than an option on `getItem` so the choice is visible in the call:
     * adopting a bare value is only ever correct for the consent record.
     * @see docs/design-notes/persistence.md#why-getitemorlegacy-is-a-separate-method
     */
    getItemOrLegacy(key: string): string | null;
    /**
     * Returns true when the value will be readable on the next page load. In cross-subdomain mode
     * that requires the cookie write to land (reads trust only the cookie); otherwise any layer
     * suffices — provided a stale cookie left by a failed cookie write was cleared, since reads
     * prefer the cookie and an uncleared one shadows the localStorage value with the previous one.
     * @see docs/design-notes/persistence.md#setitems-return-contract
     */
    setItem(key: string, value: string): boolean;
    /**
     * Returns true when a subsequent getItem would return null — the value is gone from every layer
     * reads consult (the cookie in cross-subdomain mode; both layers otherwise). Lets opt-out/reset
     * surface a privacy teardown that did not land.
     */
    removeItem(key: string): boolean;
    /** True when values are shared across subdomains via a domain-scoped cookie. */
    readonly crossSubdomain: boolean;
}
/**
 * Returns null only when no layer is usable (cookies absent and localStorage unavailable).
 * `maxAgeDays` bounds how long any stored value is kept, in every mode.
 */
export declare const createPersistentStore: (cookies: CookieLayer | null, maxAgeDays?: number) => PersistentStore | null;
/**
 * Resolves the store argument shared by configureSession / configureProfile / createTrackingConsent
 * — a genuinely optional trailing parameter on the last, a required positional (typed
 * `| undefined`) on the other two. `undefined` (non-init internal callers and tests) builds a
 * localStorage-only store; an explicit `null` (init() found no usable layer) means no persistence;
 * a provided store is used as-is.
 */
export declare const resolveStore: (provided?: PersistentStore | null) => PersistentStore | null;
