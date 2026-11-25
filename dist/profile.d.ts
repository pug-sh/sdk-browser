import { type PersistentStore } from './persistence.js';
import type { GrantedGate } from './tracking-consent.js';
export declare const configureProfile: (projectId: string, persistentStore: PersistentStore | null | undefined, isGranted: GrantedGate) => void;
export declare const getAnonymousId: () => string;
export declare const isIdentified: () => boolean;
export declare const markIdentified: (id: string) => void;
export declare const resolveDistinctId: () => string;
/**
 * Drops the persisted anonymous and external IDs. Returns false when a removal could not be
 * confirmed — in cross-subdomain mode that means the shared identity cookie survived on the
 * registrable domain and will resurface on the next read, which callers acting on a consent
 * withdrawal must be able to detect rather than infer from console output.
 */
export declare const clearProfile: () => boolean;
export declare const destroyProfile: () => void;
