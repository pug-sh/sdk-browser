import { log } from './logger.js';
import { createDefaultQueueStorage, createMemoryQueueStorage } from './queue-storage.js';
import { GrpcCode, RpcError } from './rpc.js';
import { createTransport } from './transport.js';
import { isStorageAvailable, makeStorageKey, safeStringify } from './utils.js';
const DEFAULT_BATCH_CONFIG = {
    maxSize: 10,
    maxWaitMs: 5000,
    maxQueueSize: 1000,
};
/**
 * How each knob is validated, derived from `BatchConfig` by `satisfies` for the same reason
 * `KNOWN_CONSENT_KEYS` is derived from `TrackingConsentConfig`: a fourth member becomes a compile
 * error here until it has a rule. That closes the one asymmetry `BatchOptions` leaves open — the
 * mapped type makes a new member *settable* through `init({ batch })`, but nothing made it
 * *validated*, which is the mirror image of the hole the mapped type was introduced to fix.
 *
 * Keeping `kind` and `min` beside the name also stops the pairing being respelled at each call site,
 * where `validated('maxWaitMs', 'whole', 0)` — rounding a `setTimeout` duration that is fine
 * fractional — and `validated('maxSize', 'finite', 0)` — admitting the `lock(0)`-forever config the
 * floor exists to reject — both compiled clean.
 */
const BATCH_RULES = {
    // Whole because lock() reserves a count of events; floored at 1 so a flush always draws one.
    maxSize: { kind: 'whole', min: 1 },
    // Finite, not whole: a setTimeout duration is fine fractional. 0 means "flush on the next tick".
    maxWaitMs: { kind: 'finite', min: 0 },
    maxQueueSize: { kind: 'whole', min: 1 },
};
/** Derived from the rules, so a knob cannot be validated but unrecognized, or the reverse. */
const KNOWN_BATCH_KEYS = new Set(Object.keys(BATCH_RULES));
// gRPC codes for client errors / server rejections that retrying cannot fix. Uses the shared
// GrpcCode vocabulary from rpc.ts (the producer) so this consumer table can't silently drift
// from the codes rpc.ts actually emits.
const PERMANENT_GRPC_CODES = new Set([
    GrpcCode.InvalidArgument,
    GrpcCode.NotFound,
    GrpcCode.AlreadyExists,
    GrpcCode.PermissionDenied,
    GrpcCode.FailedPrecondition,
    GrpcCode.Unimplemented,
    GrpcCode.Unauthenticated,
]);
// The server accepts events per-event and reports the count (BatchCreateResponse.accepted). A
// shortfall means it silently rejected some — surface it, since committing the batch erases those
// events without a trace. The SDK leaves validation to the server (no client-side field checks),
// so this warn is the only signal an operator gets that otherwise-valid track() calls are dropping.
const warnIfPartiallyAccepted = (accepted, sent) => {
    if (accepted < sent) {
        log.warn(`Server accepted ${accepted}/${sent} events; ${sent - accepted} were rejected and dropped. ` +
            "Check event validity (kind must match ^[a-zA-Z0-9_.-]+$; custom-property keys must not start with '$').");
    }
};
const isPermanentError = (err) => {
    if (err instanceof RpcError) {
        return PERMANENT_GRPC_CODES.has(err.code);
    }
    // Non-RpcError errors (TypeError, SyntaxError, etc.) indicate code or
    // data bugs that retrying cannot fix. Treat them as permanent to avoid
    // poison events stalling the entire queue in an infinite retry loop.
    return true;
};
export const createBatchedTransport = (endpoint, apiKey, projectId, partialConfig) => {
    // Shape and key check ahead of the per-member reads — the half of the KNOWN_CONSENT_KEYS pattern
    // BATCH_RULES did not port. The rules make a fourth knob a compile error until it has one, but
    // nothing inspected the keys actually *supplied*, so `batch: 'oops'` and `{ maxsize: 1 }` alike
    // reached `partialConfig?.[name]`, yielded undefined, read as "not supplied" and took every
    // default in silence — on the one-tag install, where the value is data-options JSON no compiler
    // sees and a casing slip is the likeliest mistake.
    //
    // Warn and carry on, deliberately unlike trackingConsent's fail-closed: a mis-sized buffer has no
    // privacy dimension, so answering one typo by disabling batching would cost more than the typo.
    // Same posture as resolveIntent, and for the same reason.
    const rawConfig = partialConfig;
    if (rawConfig != null) {
        if (typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
            log.warn(`Invalid batch config ${safeStringify(rawConfig)}; expected an object. Using defaults for every member.`);
        }
        else {
            const unknownKeys = Object.keys(rawConfig).filter(key => !KNOWN_BATCH_KEYS.has(key));
            if (unknownKeys.length > 0) {
                log.warn(`Unknown batch key(s) ${JSON.stringify(unknownKeys)}; expected ${[...KNOWN_BATCH_KEYS]
                    .map(k => `'${k}'`)
                    .join(', ')}. Those members keep their defaults.`);
            }
        }
    }
    // Read per member with an explicit `=== undefined` check — not a spread, which lets an explicit
    // `undefined` (the config-builder spelling) replace the default, and not `??`, which would
    // silently coalesce the `null` the warning below exists to name.
    // Untrusted despite the type: the one-tag install supplies `batch` as `data-options` JSON that no
    // compiler sees, and a bare `value >= min` accepted every shape JSON.parse can produce. `Infinity`
    // (from `1e999`) passed, disabling the queue bound and size-triggered flushing outright; `null`
    // passed too (`null >= 0`), turning maxWaitMs into `setTimeout(fn, 0)` — one request per event.
    const resolve = (name) => {
        const { kind, min } = BATCH_RULES[name];
        const fallback = DEFAULT_BATCH_CONFIG[name];
        const value = partialConfig?.[name];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
            log.warn(`batch.${name} ${safeStringify(value)} must be a finite number >= ${min}; using ${fallback}.`);
            return fallback;
        }
        // Rounded down, not replaced by the default: defaulting would answer a too-tight maxQueueSize
        // (1.5 → 1) by widening it 1000x. See lock() for what a fractional count would do.
        if (kind === 'whole' && !Number.isInteger(value)) {
            const whole = Math.max(min, Math.trunc(value));
            log.warn(`batch.${name} ${safeStringify(value)} must be a whole number of events; using ${whole}.`);
            return whole;
        }
        return value;
    };
    /** The sole mint for `Validated` — one cast, so the brand means "resolve() checked this". */
    const validated = (name) => resolve(name);
    // Destructured off a `satisfies Record<keyof BatchConfig, Validated>` literal, not three loose
    // consts, and the two halves of that annotation do different jobs. `keyof BatchConfig` requires
    // every member to be *present* — BATCH_RULES already made a fourth knob a compile error until it
    // had a rule, but a member could still be settable through `init({ batch })`, documented, and
    // inert. `Validated` requires each one to have come back from `validated()`, which is the half
    // `satisfies BatchConfig` could not state: against a bare `number`, writing the new member as
    // `partialConfig?.maxRetries ?? DEFAULT_BATCH_CONFIG.maxRetries` typechecked clean and shipped
    // unchecked to the untrusted-JSON caller this whole apparatus exists for.
    const { maxSize, maxWaitMs, maxQueueSize } = {
        maxSize: validated('maxSize'),
        maxWaitMs: validated('maxWaitMs'),
        maxQueueSize: validated('maxQueueSize'),
    };
    const storageKey = makeStorageKey(projectId, 'queue');
    const inner = createTransport(endpoint, apiKey);
    // Decided once, here: recoverability is a property of the queue actually in use, not of a probe
    // at report time — a probe that healed after creation promised "will retry on next init()" about
    // a memory queue that dies with the page, and one that broke later condemned a disk-backed queue
    // whose earlier persists survive.
    const consentedQueuePersists = isStorageAvailable();
    const storage = createDefaultQueueStorage(storageKey, maxQueueSize, consentedQueuePersists);
    // Cookieless events must never touch the device, so they get a memory-only twin of the queue. A
    // hard-killed tab loses whatever it holds (the beacon covers ordinary navigation); the alternative
    // is persisting event payloads, which is the thing cookieless mode promises not to do.
    //
    // That loss is bounded by maxQueueSize, NOT maxWaitMs, which bounds only the happy path: a
    // transient failure rolls the batch back and retries indefinitely — measured at 60s with
    // maxWaitMs=50, still deliverable once sends recovered.
    const cookielessStorage = createMemoryQueueStorage(maxQueueSize);
    const storageFor = (event) => (event.cookieless ? cookielessStorage : storage);
    const totalSize = () => storage.size + cookielessStorage.size;
    let timer = null;
    let state = 'idle';
    // Round-robin cursor, consulted only when maxSize leaves one indivisible slot. See flush().
    let preferCookieless = false;
    /**
     * Reports a failed `sendBeacon` at the level each queue's outcome warrants — `beacon()` returns
     * false whenever `sendBeacon` is absent or blocked, which is routine with analytics blockers. The
     * consented queue is localStorage-backed and recovers on the next `init()`; the cookieless queue
     * dies with the page, so reporting both as "they remain queued" was wrong for half of them.
     *
     * `terminal` is the reset() farewell *once the purge has confirmed the queues left the device*:
     * the beacon was those events' one chance and the loss is permanent, so "will retry on next
     * init()" is false. The caller must therefore report after purging, not before — a consented purge
     * that fails leaves the key on disk and the events really do retry, which is why `terminal` is
     * passed `consented.ok` rather than a literal true.
     */
    const reportBeaconLoss = (consentedCount, cookielessCount, phase, terminal = false) => {
        if (consentedCount > 0) {
            if (terminal) {
                log.error(`sendBeacon failed ${phase}; ${consentedCount} events were dropped unsent — the queue is removed after its farewell beacon.`);
            }
            else if (consentedQueuePersists) {
                // Only recoverable if there is somewhere to recover from: the consented queue fell back to
                // in-memory when localStorage was unavailable at creation, and that loss is permanent too.
                log.warn(`sendBeacon failed ${phase}; ${consentedCount} events remain in the persisted queue and will retry on next init().`);
            }
            else {
                log.error(`sendBeacon failed ${phase}; ${consentedCount} events were dropped — the queue is memory-only, so it cannot be recovered.`);
            }
        }
        if (cookielessCount > 0) {
            log.error(`sendBeacon failed ${phase}; ${cookielessCount} cookieless events were dropped — the cookieless queue is memory-only and cannot be recovered.`);
        }
    };
    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    const scheduleFlush = () => {
        if (timer !== null || state === 'destroyed') {
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            flush();
        }, maxWaitMs);
    };
    const flush = () => {
        if (state !== 'idle') {
            return;
        }
        clearTimer();
        // One in-flight batch at a time, drawn from BOTH queues in a single request. Targeting one queue
        // per flush starved the cookieless queue for the whole duration of any continuous consented
        // stream, while `totalSize() >= maxSize` still tripped on every arriving event — degrading
        // consented traffic to one request per event. And since `storage` is localStorage-backed, a
        // single transiently-failing event survived page loads and could block cookieless collection
        // on that device indefinitely.
        //
        // So reserve part of the budget whenever the cookieless queue has anything waiting, floored on
        // the *cookieless* side. Flooring the consented side made that floor the entire budget at
        // maxSize 1 — a legal, natural setting for per-event delivery — so cookieless got lock(0)
        // forever. When the two floors cannot both fit the queues alternate; any fixed split degenerates
        // there, and only alternation is correct at every maxSize.
        const cookielessPending = cookielessStorage.size;
        // Annotated `number`, not left to infer `Validated` off maxSize: what the brand marks is "this
        // came back from the validator", and a budget derived by arithmetic below is not that.
        let consentedBudget = maxSize;
        if (cookielessPending > 0) {
            const cookielessReserve = Math.min(cookielessPending, Math.max(1, Math.floor(maxSize / 2)));
            consentedBudget = maxSize - cookielessReserve;
            if (consentedBudget < 1) {
                // No room for both. Take turns, so neither queue can be starved by a sustained stream in
                // the other. The flag advances only here, so it cannot drift on flushes that never contend.
                consentedBudget = preferCookieless ? 0 : 1;
                preferCookieless = !preferCookieless;
            }
        }
        const consented = storage.lock(consentedBudget);
        const cookieless = cookielessStorage.lock(maxSize - consented.length);
        const batch = [...consented, ...cookieless];
        if (batch.length === 0) {
            return;
        }
        state = 'flushing';
        // Only a queue that contributed holds a lock; committing or rolling back the other would act on
        // a lock it does not own. Mirrors the guarded form in destroy().
        const settle = (outcome) => {
            if (consented.length > 0) {
                outcome === 'commit' ? storage.commit() : storage.rollback();
            }
            if (cookieless.length > 0) {
                outcome === 'commit' ? cookielessStorage.commit() : cookielessStorage.rollback();
            }
        };
        inner
            .sendBatch(batch)
            .then(res => {
            warnIfPartiallyAccepted(res.accepted, batch.length);
            settle('commit');
        })
            .catch(err => {
            if (isPermanentError(err)) {
                settle('commit');
                log.error(`Permanent error, ${batch.length} events dropped (will NOT retry):`, err);
            }
            else {
                settle('rollback');
                // "will retry" is only true if the events are still queued. A purgeQueue() that landed
                // while this batch was in flight empties the buffer under it, so the rollback restores
                // nothing and the retry never happens — reporting one would misdescribe the outcome.
                if (totalSize() > 0) {
                    log.warn('Transient error sending batch, will retry:', err);
                }
                else {
                    log.warn(`Transient error sending batch; the queue was cleared while it was in flight, so ${batch.length} events were dropped:`, err);
                }
            }
        })
            .finally(() => {
            if (state === 'destroyed') {
                return;
            }
            state = 'idle';
            if (totalSize() > 0) {
                scheduleFlush();
            }
        });
    };
    const beaconFlush = () => {
        if (state === 'destroyed') {
            return;
        }
        clearTimer();
        if (state === 'flushing') {
            // In-flight flush owns the locked events. Best-effort beacon the
            // unlocked tail from both queues — they stay queued regardless, so
            // duplicates are possible if the page survives but events aren't lost.
            const consentedTail = storage.peekUnlocked();
            const cookielessTail = cookielessStorage.peekUnlocked();
            const unlocked = [...consentedTail, ...cookielessTail];
            // The return value was discarded here, so a blocked sendBeacon lost the cookieless tail with
            // no diagnostic at all — the one branch that said nothing about the one loss that is permanent.
            if (unlocked.length > 0 && !inner.beacon?.(unlocked)) {
                // To disk before the report, so "remain in the persisted queue" is true when printed.
                storage.sync();
                reportBeaconLoss(consentedTail.length, cookielessTail.length, 'on page hide');
            }
            return;
        }
        // Drain both queues in one payload — there may not be another chance to
        // send on page hide, and BatchCreate accepts mixed events.
        const a = storage.lock(storage.size);
        const b = cookielessStorage.lock(cookielessStorage.size);
        const batch = [...a, ...b];
        if (batch.length === 0) {
            return;
        }
        // Guarded on contribution like flush()/destroy(), rather than relying on the unstated invariant
        // that no lock is held at `idle`. That invariant does hold here (the early return above), but
        // destroy()'s comment explains why acting on a lock you do not own is a real hazard — leaving
        // one call site unguarded invites a reader to conclude it is safe everywhere.
        if (inner.beacon?.(batch)) {
            if (a.length > 0) {
                storage.commit();
            }
            if (b.length > 0) {
                cookielessStorage.commit();
            }
        }
        else {
            if (a.length > 0) {
                storage.rollback();
            }
            if (b.length > 0) {
                cookielessStorage.rollback();
            }
            // rollback() restores the buffer but not the disk: events younger than the persist debounce
            // would die with the page while the report below promised they were queued.
            storage.sync();
            reportBeaconLoss(a.length, b.length, 'on page hide');
        }
    };
    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            beaconFlush();
        }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', beaconFlush);
    return {
        send: async (event, options) => {
            if (state === 'destroyed') {
                return;
            }
            if (options?.immediate) {
                try {
                    const res = await inner.send(event);
                    warnIfPartiallyAccepted(res.accepted, 1);
                }
                catch (err) {
                    if (isPermanentError(err)) {
                        log.error('Permanent error sending event, dropping:', err);
                        return;
                    }
                    storageFor(event).push(event);
                    scheduleFlush();
                }
                return;
            }
            storageFor(event).push(event);
            if (totalSize() >= maxSize) {
                flush();
            }
            else {
                scheduleFlush();
            }
        },
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
        purgeQueue: ({ send }) => {
            // Held, not reported, until the purge below has run. The counts are captured here because
            // purge() empties the buffers, but the *message* depends on whether the queues actually left
            // the device: announced first, a failed consented purge printed "dropped unsent — the queue is
            // removed" one line above purge()'s own "may be sent on a later visit", and the second is the
            // true one. Same reasoning that keys purgeQueuedEvents' warning on `destroyed`.
            let beaconLoss = null;
            if (send && state !== 'destroyed') {
                const consentedTail = storage.peekUnlocked();
                const cookielessTail = cookielessStorage.peekUnlocked();
                const pending = [...consentedTail, ...cookielessTail];
                // The third beacon call site, and the only one that discarded this result — so a blocked
                // sendBeacon destroyed everything collected under valid consent, returned true, and said
                // nothing. Both other sites (beaconFlush, destroy) already report through reportBeaconLoss.
                if (pending.length > 0 && !inner.beacon?.(pending)) {
                    beaconLoss = { consented: consentedTail.length, cookieless: cookielessTail.length };
                }
            }
            // To disk before purging: events younger than the 1s persist debounce live only in the buffer,
            // which purge() clears while cancelling the pending write, so an unsynced purge that failed to
            // remove the key destroyed exactly that tail while the surviving key made every report claim
            // it back.
            //
            // Gated on `send`, i.e. reset() only — every consent teardown must not write at all, and a
            // rewrite-then-remove is still a device write.
            // @see docs/design-notes/batch.md#the-sync-before-purge-under-send
            if (send) {
                storage.sync();
            }
            // Each queue counts its own buffer, in-flight locked batch included — see purge(). An
            // in-flight batch may still be delivered, so `destroyed` can overstate. Under `send` it no
            // longer undercounts, the sync above having put every event it counts 0 for on the device;
            // on the consent teardown the undercount stands, deliberately, for the reason given there.
            const consented = storage.purge();
            const cookieless = cookielessStorage.purge();
            if (beaconLoss) {
                // `terminal` is the purge's answer, not an assumption: a surviving key means those events
                // really do retry on the next init().
                reportBeaconLoss(beaconLoss.consented, beaconLoss.cookieless, 'during reset', consented.ok);
            }
            return {
                ok: consented.ok && cookieless.ok,
                destroyed: (consented.ok ? consented.dropped : 0) + cookieless.dropped,
            };
        },
        destroy: () => {
            state = 'destroyed';
            clearTimer();
            storage.dispose();
            cookielessStorage.dispose();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', beaconFlush);
            // An in-flight flush owns that queue's lock, so lock() returns [] and we beacon its *unlocked
            // tail* instead — never committing it, since committing under a held lock would splice that
            // batch out from under the flush. A queue we lock ourselves is committed on beacon success.
            //
            // Duplicate risk, as in beaconFlush: a peeked tail is sent but stays queued, so a surviving
            // page whose in-flight flush then succeeds delivers twice. Accepted — losing them is worse,
            // and BatchCreate is keyed by eventId.
            const a = storage.lock(storage.size);
            const b = cookielessStorage.lock(cookielessStorage.size);
            const consentedTail = a.length === 0 ? storage.peekUnlocked() : [];
            const cookielessTail = b.length === 0 ? cookielessStorage.peekUnlocked() : [];
            const payload = [...a, ...b, ...consentedTail, ...cookielessTail];
            if (payload.length > 0) {
                if (inner.beacon?.(payload)) {
                    if (a.length > 0) {
                        storage.commit();
                    }
                    if (b.length > 0) {
                        cookielessStorage.commit();
                    }
                }
                else {
                    if (a.length > 0) {
                        storage.rollback();
                    }
                    if (b.length > 0) {
                        cookielessStorage.rollback();
                    }
                    reportBeaconLoss(a.length + consentedTail.length, b.length + cookielessTail.length, 'during destroy()');
                }
            }
        },
    };
};
