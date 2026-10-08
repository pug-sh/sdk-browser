import { type PersistentStore } from './persistence.js';
import type { GrantedGate } from './tracking-consent.js';
export interface SessionConfig {
    readonly idleTimeoutMinutes?: number | undefined;
    readonly maxSessionMinutes?: number | undefined;
}
export declare const configureSession: (projectId: string, sessionConfig: SessionConfig | undefined, persistentStore: PersistentStore | null | undefined, isGranted: GrantedGate) => void;
/**
 * Re-arms the tab registry after consent is granted mid-page. Called by setTrackingConsent() —
 * without it the liveness heuristic stays dead for the rest of the page's life, and the README's
 * recommended consent-first flow (init() before the banner is answered) never arms it at all.
 */
export declare const onConsentGranted: () => void;
export declare const rotate: () => void;
export declare const resolveSessionId: () => string;
/**
 * Resets both session and device ID — call on logout. Returns false when the reset could not be made
 * durable: both failure arms log and return rather than throw, so a catch-only guard in reset()
 * reported success while the previous user's ids were still on the device.
 */
export declare const resetIdentity: () => boolean;
export declare const clearSession: () => boolean;
export declare const destroySession: () => void;
