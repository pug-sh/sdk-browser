import { type PersistentStore } from './persistence.js';
/**
 * The valid consent states, and the single source of `TrackingConsent`. Derived rather than written
 * alongside: maintained separately, `isConsent` still compiled against the old union while
 * advertising `value is TrackingConsent`, so a newly added state was un-settable and reported as
 * invalid input.
 */
declare const CONSENT_STATES: readonly ["granted", "denied", "cookieless"];
export type TrackingConsent = (typeof CONSENT_STATES)[number];
/**
 * What a rejection may resolve to. `'granted'` is excluded deliberately — a CMP mapping its reject
 * branch onto full consent is the one misconfiguration here that cannot be recovered from.
 */
declare const REJECT_STATES: readonly ["denied", "cookieless"];
export type RejectConsent = (typeof REJECT_STATES)[number];
export interface TrackingConsentConfig {
    /**
     * First-run seed used when nothing is persisted yet. Defaults to `'cookieless'`: events flow, but
     * nothing is written to the device until the user actually chooses, so an install that never
     * configures consent still does not store identifiers before it has a basis to. Pass `'granted'`
     * to opt into full identity from the first event, or `'denied'` to capture nothing at all.
     *
     * Named `initial` rather than `default`: the latter is a reserved word, so `const { default } =
     * cfg` is a SyntaxError and consumers had to write `const { default: initial } = cfg`.
     */
    readonly initial?: TrackingConsent | undefined;
    /**
     * What `optOutTracking()` resolves to. Defaults to `'denied'`; set `'cookieless'` to keep
     * identity-free traffic counts after a rejection, so the banner's reject branch needs no
     * cookieless knowledge of its own. `setTrackingConsent('denied')` always means literally denied.
     */
    readonly onReject?: RejectConsent | undefined;
    /** Persist opt in/out and restore any persisted value on construction (i.e. on the next init()). Defaults to false. */
    readonly persist?: boolean | undefined;
    /**
     * Honor the browser's Global Privacy Control signal, resolving it to `onReject`. Defaults to
     * false. Read once per `init()`; a choice made on this site outranks it.
     */
    readonly respectGpc?: boolean | undefined;
}
/**
 * A consent predicate, nominally tagged with the question it answers. Both gates are `() => boolean`
 * and injected positionally, so passing the wrong one compiled silently.
 *
 * The member is **required**: optional, it could be laundered off by `const f: () => boolean = g`.
 * The generic is deliberately **not exported** — exported, `type Gate = ConsentGate<'granted'>` then
 * `fn as Gate` renames the brand out of every containment rule.
 * @see docs/design-notes/tracking-consent.md#the-two-gates
 */
type ConsentGate<K extends string> = (() => boolean) & {
    readonly __gate: K;
};
/** May we write identity to the device? Full consent only. */
export type GrantedGate = ConsentGate<'granted'>;
/** Are events flowing at all? Granted **or** cookieless. */
export type TrackingGate = ConsentGate<'tracking'>;
/**
 * A granted gate for a controller that does not exist yet. `init()` must build the cookie layer
 * before the controller — the controller needs the store, the store needs the layer — so the layer's
 * gate resolves lazily.
 *
 * Until it resolves this reads as **not granted**: no `?? true` here means no fail-open default
 * anywhere in the gate chain, so the window cannot become a hole if a future edit moves a store
 * access above the assignment.
 *
 * Lives here so the `as GrantedGate` cast stays in the module that owns the brand.
 * @see docs/design-notes/tracking-consent.md#containment
 */
export declare const deferredGrantedGate: (controller: () => TrackingConsentController | null) => GrantedGate;
export declare const createTrackingConsent: (projectId: string, config?: TrackingConsent | TrackingConsentConfig, persistentStore?: PersistentStore | null) => {
    getConsent: () => TrackingConsent;
    /**
     * Whether the resolved state is a durable record of the user's own choice rather than the
     * integrator's pre-banner placeholder — the gate on init()'s identity purge.
     *
     * Requires BOTH persistence and that the value came back from storage. `persist` alone is a
     * data-loss bug: nothing is written until an explicit set(), so adding `{ initial: 'denied',
     * persist: true }` to an existing deployment would purge every returning visitor's identity once,
     * on deploy day. Without `persist` the value is a per-load placeholder, and purging on that
     * destroys identity on every page load. A GPC-resolved state qualifies — equally durable, being
     * re-asserted by the browser each load.
     */
    isAuthoritative: () => boolean;
    /** True only for full consent — gates identity-storage writes, NOT event flow. */
    isGranted: GrantedGate;
    /**
     * True when events flow at all (granted or cookieless). Gates auto-capture listener attachment
     * and answers the public isTrackingEnabled() — but gates neither track() nor identify(), which
     * check differently: identify() requires isGranted(), and track() branches on getConsent()
     * directly because it needs all three states.
     */
    isTracking: TrackingGate;
    /**
     * Whether the user has yet to answer, so `status` is still the `initial` seed. Answers "should I
     * show the banner?", which neither other getter could: a seeded 'granted' and a chosen 'granted'
     * are the same value.
     */
    isPending: () => boolean;
    /** The state a rejection resolves to — `onReject`, or 'denied'. */
    getRejectState: () => RejectConsent;
    set: (value: TrackingConsent) => boolean;
    optIn: () => boolean;
    optOut: () => boolean;
};
export type TrackingConsentController = ReturnType<typeof createTrackingConsent>;
export {};
