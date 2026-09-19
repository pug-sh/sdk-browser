import { fromJson, toJson } from '@bufbuild/protobuf';
import { EventSchema } from './gen/sdk/events/v1/events_pb.js';
import { log } from './logger.js';
// Queue storage uses a two-phase lock/commit/rollback protocol:
// lock(n) reserves up to n events and returns them; while locked, size and
// peekUnlocked() exclude locked events and subsequent lock() calls return [].
// commit() permanently removes locked events. rollback() releases the lock
// without removing events. Only one lock can be active at a time.
// n is truncated to a whole, non-negative count: un-truncated, slice() ignores a fraction while
// `locked` keeps it, and a flush releases only the queues that returned events — lock(0.5) would
// return [] and then lock that queue for the life of the page.
export const createMemoryQueueStorage = (maxQueueSize) => {
    const buffer = [];
    let locked = 0;
    return {
        push: (event) => {
            if (buffer.length >= maxQueueSize) {
                if (locked >= buffer.length) {
                    log.warn('Queue full and flush in progress, dropping new event');
                    return;
                }
                log.warn('Queue full, dropping oldest unlocked event');
                buffer.splice(locked, 1);
            }
            buffer.push(event);
        },
        lock: (limit) => {
            if (locked > 0) {
                return [];
            }
            locked = Math.min(Math.max(0, Math.trunc(limit)), buffer.length);
            return buffer.slice(0, locked);
        },
        commit: () => {
            buffer.splice(0, locked);
            locked = 0;
        },
        peekUnlocked: () => buffer.slice(locked),
        rollback: () => (locked = 0),
        dispose: () => { },
        // Shares the shape with the localStorage queue; there is no disk to sync to.
        sync: () => { },
        // Consent teardown. Nothing to confirm — this queue never reaches the device — but it shares the
        // shape so callers can purge both without asking which is which.
        purge: () => {
            // buffer.length, not `size`: purge discards the in-flight locked batch too, and the caller's
            // warning is gated on this count — `size` made it silent in exactly the highest-loss case.
            const dropped = buffer.length;
            buffer.length = 0;
            locked = 0;
            return { ok: true, dropped };
        },
        get size() {
            return buffer.length - locked;
        },
    };
};
const createLocalStorageQueueStorage = (key, maxQueueSize) => {
    let buffer;
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) {
            // Deserialize per-item so valid events survive when individual entries
            // are corrupt (e.g. after an SDK upgrade changes the proto schema).
            let dropped = 0;
            buffer = parsed.reduce((acc, item, i) => {
                try {
                    acc.push(fromJson(EventSchema, item));
                }
                catch (e) {
                    dropped++;
                    log.warn(`Skipping corrupt event at index ${i} during hydration:`, e);
                }
                return acc;
            }, []);
            if (dropped > 0) {
                log.warn(`Dropped ${dropped} corrupt event(s) during hydration, ${buffer.length} recovered.`);
            }
        }
        else {
            if (parsed !== null) {
                log.warn('Corrupt queue in localStorage (not an array), discarding.');
                localStorage.removeItem(key);
            }
            buffer = [];
        }
    }
    catch (err) {
        // JSON.parse or localStorage.getItem failed — the entire payload is unreadable.
        log.error('Failed to hydrate queue from localStorage, discarding:', err);
        try {
            localStorage.removeItem(key);
        }
        catch (removeErr) {
            log.warn('Also failed to remove corrupt queue from localStorage:', removeErr);
        }
        buffer = [];
    }
    const persist = () => {
        try {
            if (buffer.length === 0) {
                localStorage.removeItem(key);
            }
            else {
                localStorage.setItem(key, JSON.stringify(buffer.map(e => toJson(EventSchema, e))));
            }
        }
        catch (err) {
            log.warn('localStorage write failed, events may be lost:', err);
        }
    };
    let persistTimer = null;
    const debouncedPersist = () => {
        if (persistTimer !== null) {
            clearTimeout(persistTimer);
        }
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persist();
        }, 1000);
    };
    let locked = 0;
    return {
        push: (event) => {
            if (buffer.length >= maxQueueSize) {
                if (locked >= buffer.length) {
                    log.warn('Queue full and flush in progress, dropping new event');
                    return;
                }
                log.warn('Queue full, dropping oldest unlocked event');
                buffer.splice(locked, 1);
            }
            buffer.push(event);
            debouncedPersist();
        },
        lock: (limit) => {
            if (locked > 0) {
                return [];
            }
            locked = Math.min(Math.max(0, Math.trunc(limit)), buffer.length);
            return buffer.slice(0, locked);
        },
        commit: () => {
            buffer.splice(0, locked);
            locked = 0;
            persist();
        },
        peekUnlocked: () => buffer.slice(locked),
        rollback: () => (locked = 0),
        dispose: () => {
            if (persistTimer !== null) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            persist();
        },
        /**
         * Flushes the buffer to disk now, ahead of the 1s debounce. For the beacon-failure paths on
         * page hide: events younger than the debounce exist only in memory, and the pending timer dies
         * with the page — so "remain in the persisted queue" was false for exactly the tail (the click
         * that triggered the navigation) most worth saving.
         */
        sync: () => {
            if (persistTimer !== null) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            persist();
        },
        /**
         * Consent teardown: drop every queued event and remove the key from the device.
         *
         * Cancels the pending debounce first — otherwise a persist scheduled before the withdrawal
         * fires afterwards and rewrites the very payloads this just removed. Returns false when the key
         * is still readable, so a withdrawal that did not fully land is detectable rather than assumed.
         */
        purge: () => {
            if (persistTimer !== null) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            const dropped = buffer.length;
            buffer = [];
            locked = 0;
            try {
                localStorage.removeItem(key);
                if (localStorage.getItem(key) === null) {
                    return { ok: true, dropped };
                }
                // A Storage shim, an extension proxy or a quota-locked store no-ops the removal without
                // throwing. Reported here because pug.ts deliberately adds no message of its own when
                // purgeQueue() is false — this site is the only diagnostic anywhere.
                log.error('Failed to drop the persisted event queue — queued events carry sessionId and distinctId, and may be sent on a later visit.');
                return { ok: false, dropped };
            }
            catch (err) {
                // Same outcome as the no-op above — the key survives on the device — so the same level and
                // the same consequence sentence; the mechanism of failure does not pick the severity.
                log.error('Failed to drop the persisted event queue — queued events carry sessionId and distinctId, and may be sent on a later visit.', err);
                return { ok: false, dropped };
            }
        },
        get size() {
            return buffer.length - locked;
        },
    };
};
export const createDefaultQueueStorage = (key, maxQueueSize, persistent) => {
    if (persistent) {
        return createLocalStorageQueueStorage(key, maxQueueSize);
    }
    log.warn('localStorage not available, using in-memory queue (events will not persist across page loads)');
    return createMemoryQueueStorage(maxQueueSize);
};
