import type { Event } from './gen/sdk/events/v1/events_pb.js';
interface SendOptions {
    readonly immediate?: boolean;
}
export interface BatchConfig {
    readonly maxSize: number;
    readonly maxWaitMs: number;
    readonly maxQueueSize: number;
}
/**
 * `batch` as callers supply it — deliberately not `Partial<BatchConfig>`. Under
 * `exactOptionalPropertyTypes` (which `@tsconfig/strictest` enables) `Partial` produces
 * `maxSize?: number`, so a config builder holding the option as `number | undefined` is a TS2375 —
 * the one option surface that rejected the spelling `init-options.test-d.ts` pins everywhere else.
 */
export type BatchOptions = {
    readonly [K in keyof BatchConfig]?: BatchConfig[K] | undefined;
};
export declare const DEFAULT_BATCH_CONFIG: BatchConfig;
/**
 * What `purgeQueue()` reports. `ok` answers exactly one question — did the queues leave the
 * device; `destroyed` is how many events that cost. One shape shared with `purgeQueuedEvents` in
 * pug.ts, so the aggregate cannot be re-spelled narrower there and silently hide a new field.
 */
export interface PurgeResult {
    readonly ok: boolean;
    readonly destroyed: number;
}
export declare const createBatchedTransport: (endpoint: string, apiKey: string, projectId: string, partialConfig?: BatchOptions) => {
    send: (event: Event, options?: SendOptions) => Promise<void>;
    /**
     * Empties both queues from the device.
     *
     * `ok` answers exactly one question — "did the queues leave the device" — so it can feed the
     * teardown chain, whose meaning is device state. A dropped farewell beacon reports through
     * `reportBeaconLoss` but does **not** flip it.
     *
     * `destroyed` counts, per queue, what actually left the device. It is approximate in both
     * directions and is never an audit.
     *
     * `send` is true only for `reset()`. Every consent teardown passes false.
     *
     * The send is `beacon`, not `flush`: a synchronous user action must not wait on the network, and
     * the events must be gone from the device either way. `peekUnlocked()` excludes any in-flight
     * batch, whose later commit/rollback lands on an emptied buffer and is a harmless no-op.
     * @see docs/design-notes/batch.md#purge
     */
    purgeQueue: ({ send }: {
        send: boolean;
    }) => PurgeResult;
    destroy: () => void;
};
export {};
