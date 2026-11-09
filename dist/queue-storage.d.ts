import { type Event } from './gen/sdk/events/v1/events_pb.js';
/**
 * What one queue's `purge()` reports, and what `PurgeResult` is aggregated from: `ok` is whether the
 * queue left the device, `dropped` how many events that cost.
 *
 * Declared and annotated on both implementations rather than inferred, for the reason `PurgeResult`
 * itself is declared: an inferred producer shape lets one queue grow or rename a field while the
 * other does not, and the aggregate reads whichever members happen to line up. That is the same
 * structural drift `PurgeResult` exists to prevent, one level down.
 */
export interface QueuePurgeResult {
    readonly ok: boolean;
    readonly dropped: number;
}
export declare const createMemoryQueueStorage: (maxQueueSize: number) => {
    push: (event: Event) => void;
    lock: (limit: number) => Event[];
    commit: () => void;
    peekUnlocked: () => Event[];
    rollback: () => number;
    dispose: () => void;
    sync: () => void;
    purge: () => QueuePurgeResult;
    readonly size: number;
};
export declare const createDefaultQueueStorage: (key: string, maxQueueSize: number, persistent: boolean) => {
    push: (event: Event) => void;
    lock: (limit: number) => Event[];
    commit: () => void;
    peekUnlocked: () => Event[];
    rollback: () => number;
    dispose: () => void;
    sync: () => void;
    purge: () => QueuePurgeResult;
    readonly size: number;
};
