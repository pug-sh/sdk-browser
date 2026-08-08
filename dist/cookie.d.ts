import type { GrantedGate } from './tracking-consent.js';
import { type StoredEnvelope } from './utils.js';
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
export type CrossSubdomainConfig = boolean | {
    readonly domain: string;
    readonly maxAgeDays?: never;
};
/** Minimal document surface the cookie layer needs — injectable so tests can target other origins. */
export interface CookieDocument {
    cookie: string;
    readonly location: {
        readonly hostname: string;
        readonly protocol: string;
    };
}
export interface CookieLayer {
    get(name: string): string | null;
    /**
     * Returns true only when the write verifiably landed (read-back matches).
     *
     * `maxAgeSeconds` is the value's remaining lifetime, so the cookie expires with the value it
     * holds. Required, never defaulted: a defaulted lifetime is one nobody chose.
     *
     * `value` is the *enveloped* string minted by `encodeStored`, never a bare one — reads prefer this
     * layer, and a bare value here reads as undecodable and is deleted by the store's next getItem.
     */
    set(name: string, value: StoredEnvelope, maxAgeSeconds: number): boolean;
    /**
     * Returns true only when the key is verifiably gone (read-back is null).
     *
     * `intent` picks who reports a failure, not what is attempted: a `'teardown'` reports here, a
     * `'write'` stays silent because `persistence.setItem()` already warns with the consequence in
     * hand. @see docs/design-notes/cookie.md#remove-and-the-intent-parameter
     */
    remove(name: string, intent?: 'teardown' | 'write'): boolean;
    /** True when the cookie is scoped to a shared domain and therefore visible across subdomains. */
    readonly crossSubdomain: boolean;
}
/**
 * Finds the widest domain the browser will set a cookie on — the registrable domain (eTLD+1).
 * Probes widest-first: everything wider than eTLD+1 is a public suffix the browser refuses, so the
 * first accepted candidate is the answer and no bundled suffix list is needed. Returns '' when
 * nothing is accepted (caller falls back to a host-only cookie).
 * @see docs/design-notes/cookie.md#domain-discovery
 */
export declare const seekRegistrableDomain: (doc: CookieDocument) => string;
/**
 * Creates the cookie layer used by `createPersistentStore()`, or null when cookies are disabled by
 * config or unavailable (blocked, sandboxed frame, non-browser environment). Environment failures
 * degrade to localStorage-only persistence — the layer itself never throws. The one throw is the
 * head guard on an omitted consent gate: internal misuse, which must fail loud at creation.
 */
export declare const createCookieLayer: (config: CrossSubdomainConfig, isGranted: GrantedGate, doc?: CookieDocument | null) => CookieLayer | null;
