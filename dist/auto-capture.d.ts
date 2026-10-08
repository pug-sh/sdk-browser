import type { TrackFn } from './track.js';
import type { TrackingGate } from './tracking-consent.js';
/**
 * Per-listener allowlist: a listener runs only when its key is explicitly `true`, and every omitted
 * key is off — so `{}` disables everything, like passing `false`. List what you want enabled
 * (`{ pageView: true }`); for a value known only at runtime write `scroll: flag || undefined`.
 *
 * Values are `true`, not `boolean`, so `{ scroll: false }` — which reads as "everything except
 * scroll" but under an allowlist means "nothing at all" — is a compile error. The `| undefined`
 * keeps the runtime-flag idiom compiling under `exactOptionalPropertyTypes` without weakening that.
 */
export interface AutoCaptureSelection {
    readonly pageView?: true | undefined;
    readonly click?: true | undefined;
    readonly scroll?: true | undefined;
    readonly form?: true | undefined;
    readonly rageClick?: true | undefined;
    readonly deadClick?: true | undefined;
}
/** `true` enables all listeners, `false` disables all, an object is a per-listener allowlist. */
export type AutoCaptureConfig = boolean | AutoCaptureSelection;
/**
 * Owns the auto-capture lifecycle: holds the desired selection and reconciles live listeners against
 * it, gated on `isTrackingActive` (granted **or** cookieless). Cleanup is tracked per tracker, so
 * the selection can change at runtime without tearing down listeners that stay enabled.
 */
export declare const createAutoCaptureController: (track: TrackFn, isTrackingActive: TrackingGate) => {
    /** Store the selection and reconcile against current consent. Validates here so a bad selection
     * is reported when set, even while consent is denied. */
    setDesired: (autoCapture: AutoCaptureConfig | undefined) => void;
    /** Re-reconcile after a consent change, reusing the stored selection. */
    apply: () => void;
    /** Tear down every active listener (called on `destroy()`). */
    destroy: () => void;
};
export type AutoCaptureController = ReturnType<typeof createAutoCaptureController>;
