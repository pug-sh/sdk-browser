import { type AutoCaptureConfig, type AutoCaptureSelection } from './auto-capture.js';
import { type BatchOptions } from './batch.js';
import { type CrossSubdomainConfig } from './cookie.js';
import { type SessionConfig } from './session.js';
import { type BeforeSendFn, type JsonValue, type TrackFn } from './track.js';
import { type RejectConsent, type TrackingConsent, type TrackingConsentConfig } from './tracking-consent.js';
export interface PugConfig {
    readonly endpoint: string;
    readonly projectId: string;
}
export interface InitOptions {
    readonly endpoint?: string | undefined;
    readonly apiKey: string;
    readonly batch?: BatchOptions | undefined;
    readonly dryRun?: boolean | undefined;
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
    readonly debug?: boolean | undefined;
    readonly session?: SessionConfig | undefined;
    readonly autoCapture?: AutoCaptureConfig | undefined;
    /**
     * The consent state to start from, or a `TrackingConsentConfig` (`initial`, `onReject`,
     * `persist`, `respectGpc`). **Defaults to `'cookieless'`**: events flow, but no identifier is
     * written to the device until the user actually answers — pass `'granted'` to opt into full
     * identity from the first event, or `'denied'` to capture nothing at all. A bare string is a
     * per-load seed; use the config form with `persist: true` to record the user's choice across
     * reloads.
     */
    readonly trackingConsent?: TrackingConsent | TrackingConsentConfig | undefined;
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
    readonly crossSubdomainTracking?: CrossSubdomainConfig | undefined;
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
     * `'granted'`, or landing on `'denied'`); it survives only a transition that does neither — a
     * re-assert of an unchanged cookieless state (identity-free events by construction), or a
     * `'denied'` → `'cookieless'` thaw, where the entry to `'denied'` already emptied it. `reset()`
     * additionally sends-and-drops the queue but leaves the registry, which holds per-tab timestamps
     * and no identifiers (and whose stale entries are pruned by their own idle timeout). A queue that
     * cannot reach the network is bounded by `batch.maxQueueSize`, not by this deadline.
     */
    readonly maxAgeDays?: number | undefined;
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
    readonly redactUrlParams?: readonly string[] | false | undefined;
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
    readonly beforeSend?: BeforeSendFn | undefined;
}
export type { AutoCaptureConfig, AutoCaptureSelection, CrossSubdomainConfig, RejectConsent, TrackingConsent, TrackingConsentConfig, };
export declare const init: (projectId: string, options: InitOptions) => void;
export declare const setAutoCapture: (autoCapture: AutoCaptureConfig) => void;
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
 * genuinely ignored, which a banner racing initialization is most likely to hit. A failed
 * tab-registry re-arm on entering `'granted'` warns without failing the call: it is neither
 * identity nor durability, and a later grant or `init()` re-arms it.
 */
export declare const setTrackingConsent: (consent: TrackingConsent) => boolean;
export declare const optInTracking: () => boolean;
/**
 * Applies the rejection state: `'denied'`, or `trackingConsent.onReject` when configured — pass
 * `onReject: 'cookieless'` and the banner's reject branch keeps identity-free traffic counts without
 * naming the state itself. Either way persisted identity is torn down (see setTrackingConsent);
 * consent stays persisted so the rejection survives reloads.
 */
export declare const optOutTracking: () => boolean;
/**
 * Whether events are being tracked right now — true for granted **and** cookieless; use
 * `getTrackingConsent()` to distinguish them. Reflects consent only, independent of `dryRun`.
 * `false` before `init()` is accurate rather than a placeholder: nothing is being tracked yet.
 */
export declare const isTrackingEnabled: () => boolean;
/**
 * The consent state the SDK is acting on, or `undefined` before `init()` — a persisted choice is only
 * read from storage during `init()`, so before then there is genuinely no answer. `undefined` rather
 * than `'denied'`, which a banner would read as a real opt-out and re-prompt someone who opted in.
 */
export declare const getTrackingConsent: () => TrackingConsent | undefined;
/**
 * Whether the user has yet to make a choice — the banner gate. `getTrackingConsent()` cannot answer
 * this: before any answer it reports the `initial` seed, so a seeded state and a chosen one read
 * identically. `true` before `init()`, since nothing has been read from storage yet.
 */
export declare const isConsentPending: () => boolean;
export declare const destroy: () => void;
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
export declare const reset: () => boolean;
/**
 * Never throws — invalid input, calls before init(), denied consent, dryRun, and RPC failures are
 * logged and the promise resolves without sending. Callers may await it without their own try/catch.
 * On first identify, includes anonymousId (for profile merge) and, if available, deviceId (for push device linking).
 */
export declare const identify: (externalId: string, traits?: Record<string, JsonValue>) => Promise<void>;
/** This function must never throw. Callers (e.g. monkey-patched history.pushState) rely on it being safe. */
export declare const track: TrackFn;
