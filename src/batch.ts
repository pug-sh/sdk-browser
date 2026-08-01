import { fromJson, JsonValue, toJson } from '@bufbuild/protobuf'
import { type Event, EventSchema } from './gen/sdk/events/v1/events_pb.js'
import { log } from './logger.js'
import { GrpcCode, RpcError } from './rpc.js'
import { createTransport } from './transport.js'
import { isStorageAvailable, makeStorageKey, safeStringify } from './utils.js'

interface SendOptions {
  readonly immediate?: boolean
}

/**
 * What one queue's `purge()` reports, and what `PurgeResult` is aggregated from: `ok` is whether the
 * queue left the device, `dropped` how many events that cost.
 *
 * Declared and annotated on both implementations rather than inferred, for the reason `PurgeResult`
 * itself is declared: an inferred producer shape lets one queue grow or rename a field while the
 * other does not, and the aggregate reads whichever members happen to line up. That is the same
 * structural drift `PurgeResult` exists to prevent, one level down.
 */
interface QueuePurgeResult {
  readonly ok: boolean
  readonly dropped: number
}

// Queue storage uses a two-phase lock/commit/rollback protocol:
// lock(n) reserves up to n events and returns them; while locked, size and
// peekUnlocked() exclude locked events and subsequent lock() calls return [].
// commit() permanently removes locked events. rollback() releases the lock
// without removing events. Only one lock can be active at a time.
// n is truncated to a whole, non-negative count: un-truncated, slice() ignores a fraction while
// `locked` keeps it, and a flush releases only the queues that returned events — lock(0.5) would
// return [] and then lock that queue for the life of the page.
const createMemoryQueueStorage = (maxQueueSize: number) => {
  const buffer: Event[] = []
  let locked = 0

  return {
    push: (event: Event) => {
      if (buffer.length >= maxQueueSize) {
        if (locked >= buffer.length) {
          log.warn('Queue full and flush in progress, dropping new event')
          return
        }
        log.warn('Queue full, dropping oldest unlocked event')
        buffer.splice(locked, 1)
      }
      buffer.push(event)
    },
    lock: (limit: number) => {
      if (locked > 0) {
        return []
      }
      locked = Math.min(Math.max(0, Math.trunc(limit)), buffer.length)
      return buffer.slice(0, locked)
    },
    commit: () => {
      buffer.splice(0, locked)
      locked = 0
    },
    peekUnlocked: () => buffer.slice(locked),
    rollback: () => (locked = 0),
    dispose: () => {},
    // Shares the shape with the localStorage queue; there is no disk to sync to.
    sync: () => {},
    // Consent teardown. Nothing to confirm — this queue never reaches the device — but it shares the
    // shape so callers can purge both without asking which is which.
    purge: (): QueuePurgeResult => {
      // buffer.length, not `size`: purge discards the in-flight locked batch too, and the caller's
      // warning is gated on this count — `size` made it silent in exactly the highest-loss case.
      const dropped = buffer.length
      buffer.length = 0
      locked = 0
      return { ok: true, dropped }
    },
    get size() {
      return buffer.length - locked
    },
  }
}

const createLocalStorageQueueStorage = (key: string, maxQueueSize: number) => {
  let buffer: Event[]
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      // Deserialize per-item so valid events survive when individual entries
      // are corrupt (e.g. after an SDK upgrade changes the proto schema).
      let dropped = 0
      buffer = parsed.reduce<Event[]>((acc, item: unknown, i: number) => {
        try {
          acc.push(fromJson(EventSchema, item as JsonValue))
        } catch (e) {
          dropped++
          log.warn(`Skipping corrupt event at index ${i} during hydration:`, e)
        }
        return acc
      }, [])
      if (dropped > 0) {
        log.warn(`Dropped ${dropped} corrupt event(s) during hydration, ${buffer.length} recovered.`)
      }
    } else {
      if (parsed !== null) {
        log.warn('Corrupt queue in localStorage (not an array), discarding.')
        localStorage.removeItem(key)
      }
      buffer = []
    }
  } catch (err) {
    // JSON.parse or localStorage.getItem failed — the entire payload is unreadable.
    log.error('Failed to hydrate queue from localStorage, discarding:', err)
    try {
      localStorage.removeItem(key)
    } catch (removeErr) {
      log.warn('Also failed to remove corrupt queue from localStorage:', removeErr)
    }
    buffer = []
  }

  const persist = () => {
    try {
      if (buffer.length === 0) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify(buffer.map(e => toJson(EventSchema, e))))
      }
    } catch (err) {
      log.warn('localStorage write failed, events may be lost:', err)
    }
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedPersist = () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
    }
    persistTimer = setTimeout(() => {
      persistTimer = null
      persist()
    }, 1000)
  }

  let locked = 0

  return {
    push: (event: Event) => {
      if (buffer.length >= maxQueueSize) {
        if (locked >= buffer.length) {
          log.warn('Queue full and flush in progress, dropping new event')
          return
        }
        log.warn('Queue full, dropping oldest unlocked event')
        buffer.splice(locked, 1)
      }
      buffer.push(event)
      debouncedPersist()
    },
    lock: (limit: number) => {
      if (locked > 0) {
        return []
      }
      locked = Math.min(Math.max(0, Math.trunc(limit)), buffer.length)
      return buffer.slice(0, locked)
    },
    commit: () => {
      buffer.splice(0, locked)
      locked = 0
      persist()
    },
    peekUnlocked: () => buffer.slice(locked),
    rollback: () => (locked = 0),
    dispose: () => {
      if (persistTimer !== null) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      persist()
    },
    /**
     * Flushes the buffer to disk now, ahead of the 1s debounce. For the beacon-failure paths on
     * page hide: events younger than the debounce exist only in memory, and the pending timer dies
     * with the page — so "remain in the persisted queue" was false for exactly the tail (the click
     * that triggered the navigation) most worth saving.
     */
    sync: () => {
      if (persistTimer !== null) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      persist()
    },
    /**
     * Consent teardown: drop every queued event and remove the key from the device.
     *
     * Cancels the pending debounce first — otherwise a persist scheduled before the withdrawal
     * fires afterwards and rewrites the very payloads this just removed. Returns false when the key
     * is still readable, so a withdrawal that did not fully land is detectable rather than assumed.
     */
    purge: (): QueuePurgeResult => {
      if (persistTimer !== null) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      const dropped = buffer.length
      buffer = []
      locked = 0
      try {
        localStorage.removeItem(key)
        if (localStorage.getItem(key) === null) {
          return { ok: true, dropped }
        }
        // A Storage shim, an extension proxy or a quota-locked store no-ops the removal without
        // throwing. Reported here because pug.ts deliberately adds no message of its own when
        // purgeQueue() is false — this site is the only diagnostic anywhere.
        log.error(
          'Failed to drop the persisted event queue — queued events carry sessionId and distinctId, and may be sent on a later visit.',
        )
        return { ok: false, dropped }
      } catch (err) {
        // Same outcome as the no-op above — the key survives on the device — so the same level and
        // the same consequence sentence; the mechanism of failure does not pick the severity.
        log.error(
          'Failed to drop the persisted event queue — queued events carry sessionId and distinctId, and may be sent on a later visit.',
          err,
        )
        return { ok: false, dropped }
      }
    },
    get size() {
      return buffer.length - locked
    },
  }
}

const createDefaultQueueStorage = (key: string, maxQueueSize: number, persistent: boolean) => {
  if (persistent) {
    return createLocalStorageQueueStorage(key, maxQueueSize)
  }
  log.warn('localStorage not available, using in-memory queue (events will not persist across page loads)')
  return createMemoryQueueStorage(maxQueueSize)
}

export interface BatchConfig {
  readonly maxSize: number
  readonly maxWaitMs: number
  readonly maxQueueSize: number
}

/**
 * `batch` as callers supply it — deliberately not `Partial<BatchConfig>`. Under
 * `exactOptionalPropertyTypes` (which `@tsconfig/strictest` enables) `Partial` produces
 * `maxSize?: number`, so a config builder holding the option as `number | undefined` is a TS2375 —
 * the one option surface that rejected the spelling `init-options.test-d.ts` pins everywhere else.
 */
export type BatchOptions = { readonly [K in keyof BatchConfig]?: BatchConfig[K] | undefined }

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxSize: 10,
  maxWaitMs: 5000,
  maxQueueSize: 1000,
}

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
} satisfies Record<keyof BatchConfig, { readonly kind: 'whole' | 'finite'; readonly min: number }>

/**
 * What `purgeQueue()` reports. `ok` answers exactly one question — did the queues leave the
 * device; `destroyed` is how many events that cost. One shape shared with `purgeQueuedEvents` in
 * pug.ts, so the aggregate cannot be re-spelled narrower there and silently hide a new field.
 */
export interface PurgeResult {
  readonly ok: boolean
  readonly destroyed: number
}

// gRPC codes for client errors / server rejections that retrying cannot fix. Uses the shared
// GrpcCode vocabulary from rpc.ts (the producer) so this consumer table can't silently drift
// from the codes rpc.ts actually emits.
const PERMANENT_GRPC_CODES = new Set<GrpcCode>([
  GrpcCode.InvalidArgument,
  GrpcCode.NotFound,
  GrpcCode.AlreadyExists,
  GrpcCode.PermissionDenied,
  GrpcCode.FailedPrecondition,
  GrpcCode.Unimplemented,
  GrpcCode.Unauthenticated,
])

// The server accepts events per-event and reports the count (BatchCreateResponse.accepted). A
// shortfall means it silently rejected some — surface it, since committing the batch erases those
// events without a trace. The SDK leaves validation to the server (no client-side field checks),
// so this warn is the only signal an operator gets that otherwise-valid track() calls are dropping.
const warnIfPartiallyAccepted = (accepted: number, sent: number) => {
  if (accepted < sent) {
    log.warn(
      `Server accepted ${accepted}/${sent} events; ${sent - accepted} were rejected and dropped. ` +
        "Check event validity (kind must match ^[a-zA-Z0-9_.-]+$; custom-property keys must not start with '$').",
    )
  }
}

const isPermanentError = (err: unknown) => {
  if (err instanceof RpcError) {
    return PERMANENT_GRPC_CODES.has(err.code)
  }
  // Non-RpcError errors (TypeError, SyntaxError, etc.) indicate code or
  // data bugs that retrying cannot fix. Treat them as permanent to avoid
  // poison events stalling the entire queue in an infinite retry loop.
  return true
}

type TransportState = 'idle' | 'flushing' | 'destroyed'

export const createBatchedTransport = (
  endpoint: string,
  apiKey: string,
  projectId: string,
  partialConfig?: BatchOptions,
) => {
  // Read per member with an explicit `=== undefined` check — not a spread, which lets an explicit
  // `undefined` (the config-builder spelling) replace the default, and not `??`, which would
  // silently coalesce the `null` the warning below exists to name.
  // Untrusted despite the type: the one-tag install supplies `batch` as `data-options` JSON that no
  // compiler sees, and a bare `value >= min` accepted every shape JSON.parse can produce. `Infinity`
  // (from `1e999`) passed, disabling the queue bound and size-triggered flushing outright; `null`
  // passed too (`null >= 0`), turning maxWaitMs into `setTimeout(fn, 0)` — one request per event.
  const validated = (name: keyof BatchConfig): number => {
    const { kind, min } = BATCH_RULES[name]
    const fallback = DEFAULT_BATCH_CONFIG[name]
    const value: unknown = partialConfig?.[name]
    if (value === undefined) {
      return fallback
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
      log.warn(`batch.${name} ${safeStringify(value)} must be a finite number >= ${min}; using ${fallback}.`)
      return fallback
    }
    // Rounded down, not replaced by the default: defaulting would answer a too-tight maxQueueSize
    // (1.5 → 1) by widening it 1000x. See lock() for what a fractional count would do.
    if (kind === 'whole' && !Number.isInteger(value)) {
      const whole = Math.max(min, Math.trunc(value))
      log.warn(`batch.${name} ${safeStringify(value)} must be a whole number of events; using ${whole}.`)
      return whole
    }
    return value
  }

  // Destructured off a `satisfies BatchConfig` literal, not three loose consts. BATCH_RULES makes a
  // fourth knob a compile error until it has a *rule*; nothing made it a compile error until it was
  // actually *validated*, so a member could be settable through `init({ batch })`, documented, and
  // inert — the mirror of the hole BATCH_RULES itself was added to close. `satisfies` requires every
  // member of BatchConfig to be present here, which is the missing half.
  const { maxSize, maxWaitMs, maxQueueSize } = {
    maxSize: validated('maxSize'),
    maxWaitMs: validated('maxWaitMs'),
    maxQueueSize: validated('maxQueueSize'),
  } satisfies BatchConfig
  const storageKey = makeStorageKey(projectId, 'queue')

  const inner = createTransport(endpoint, apiKey)
  // Decided once, here: recoverability is a property of the queue actually in use, not of a probe
  // at report time — a probe that healed after creation promised "will retry on next init()" about
  // a memory queue that dies with the page, and one that broke later condemned a disk-backed queue
  // whose earlier persists survive.
  const consentedQueuePersists = isStorageAvailable()
  const storage = createDefaultQueueStorage(storageKey, maxQueueSize, consentedQueuePersists)
  // Cookieless events must never touch the device, so they get a memory-only twin of the queue. A
  // hard-killed tab loses whatever it holds (the beacon covers ordinary navigation); the alternative
  // is persisting event payloads, which is the thing cookieless mode promises not to do.
  //
  // That loss is bounded by maxQueueSize, NOT maxWaitMs, which bounds only the happy path: a
  // transient failure rolls the batch back and retries indefinitely — measured at 60s with
  // maxWaitMs=50, still deliverable once sends recovered.
  const cookielessStorage = createMemoryQueueStorage(maxQueueSize)
  const storageFor = (event: Event) => (event.cookieless ? cookielessStorage : storage)
  const totalSize = () => storage.size + cookielessStorage.size
  let timer: ReturnType<typeof setTimeout> | null = null
  let state: TransportState = 'idle'
  // Round-robin cursor, consulted only when maxSize leaves one indivisible slot. See flush().
  let preferCookieless = false

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
  const reportBeaconLoss = (consentedCount: number, cookielessCount: number, phase: string, terminal = false): void => {
    if (consentedCount > 0) {
      if (terminal) {
        log.error(
          `sendBeacon failed ${phase}; ${consentedCount} events were dropped unsent — the queue is removed after its farewell beacon.`,
        )
      } else if (consentedQueuePersists) {
        // Only recoverable if there is somewhere to recover from: the consented queue fell back to
        // in-memory when localStorage was unavailable at creation, and that loss is permanent too.
        log.warn(
          `sendBeacon failed ${phase}; ${consentedCount} events remain in the persisted queue and will retry on next init().`,
        )
      } else {
        log.error(
          `sendBeacon failed ${phase}; ${consentedCount} events were dropped — the queue is memory-only, so it cannot be recovered.`,
        )
      }
    }
    if (cookielessCount > 0) {
      log.error(
        `sendBeacon failed ${phase}; ${cookielessCount} cookieless events were dropped — the cookieless queue is memory-only and cannot be recovered.`,
      )
    }
  }

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const scheduleFlush = () => {
    if (timer !== null || state === 'destroyed') {
      return
    }
    timer = setTimeout(() => {
      timer = null
      flush()
    }, maxWaitMs)
  }

  const flush = () => {
    if (state !== 'idle') {
      return
    }
    clearTimer()
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
    const cookielessPending = cookielessStorage.size
    let consentedBudget = maxSize
    if (cookielessPending > 0) {
      const cookielessReserve = Math.min(cookielessPending, Math.max(1, Math.floor(maxSize / 2)))
      consentedBudget = maxSize - cookielessReserve
      if (consentedBudget < 1) {
        // No room for both. Take turns, so neither queue can be starved by a sustained stream in
        // the other. The flag advances only here, so it cannot drift on flushes that never contend.
        consentedBudget = preferCookieless ? 0 : 1
        preferCookieless = !preferCookieless
      }
    }
    const consented = storage.lock(consentedBudget)
    const cookieless = cookielessStorage.lock(maxSize - consented.length)
    const batch = [...consented, ...cookieless]
    if (batch.length === 0) {
      return
    }

    state = 'flushing'

    // Only a queue that contributed holds a lock; committing or rolling back the other would act on
    // a lock it does not own. Mirrors the guarded form in destroy().
    const settle = (outcome: 'commit' | 'rollback') => {
      if (consented.length > 0) {
        outcome === 'commit' ? storage.commit() : storage.rollback()
      }
      if (cookieless.length > 0) {
        outcome === 'commit' ? cookielessStorage.commit() : cookielessStorage.rollback()
      }
    }

    inner
      .sendBatch(batch)
      .then(res => {
        warnIfPartiallyAccepted(res.accepted, batch.length)
        settle('commit')
      })
      .catch(err => {
        if (isPermanentError(err)) {
          settle('commit')
          log.error(`Permanent error, ${batch.length} events dropped (will NOT retry):`, err)
        } else {
          settle('rollback')
          // "will retry" is only true if the events are still queued. A purgeQueue() that landed
          // while this batch was in flight empties the buffer under it, so the rollback restores
          // nothing and the retry never happens — reporting one would misdescribe the outcome.
          if (totalSize() > 0) {
            log.warn('Transient error sending batch, will retry:', err)
          } else {
            log.warn(
              `Transient error sending batch; the queue was cleared while it was in flight, so ${batch.length} events were dropped:`,
              err,
            )
          }
        }
      })
      .finally(() => {
        if (state === 'destroyed') {
          return
        }
        state = 'idle'
        if (totalSize() > 0) {
          scheduleFlush()
        }
      })
  }

  const beaconFlush = () => {
    if (state === 'destroyed') {
      return
    }
    clearTimer()
    if (state === 'flushing') {
      // In-flight flush owns the locked events. Best-effort beacon the
      // unlocked tail from both queues — they stay queued regardless, so
      // duplicates are possible if the page survives but events aren't lost.
      const consentedTail = storage.peekUnlocked()
      const cookielessTail = cookielessStorage.peekUnlocked()
      const unlocked = [...consentedTail, ...cookielessTail]
      // The return value was discarded here, so a blocked sendBeacon lost the cookieless tail with
      // no diagnostic at all — the one branch that said nothing about the one loss that is permanent.
      if (unlocked.length > 0 && !inner.beacon?.(unlocked)) {
        // To disk before the report, so "remain in the persisted queue" is true when printed.
        storage.sync()
        reportBeaconLoss(consentedTail.length, cookielessTail.length, 'on page hide')
      }
      return
    }
    // Drain both queues in one payload — there may not be another chance to
    // send on page hide, and BatchCreate accepts mixed events.
    const a = storage.lock(storage.size)
    const b = cookielessStorage.lock(cookielessStorage.size)
    const batch = [...a, ...b]
    if (batch.length === 0) {
      return
    }
    // Guarded on contribution like flush()/destroy(), rather than relying on the unstated invariant
    // that no lock is held at `idle`. That invariant does hold here (the early return above), but
    // destroy()'s comment explains why acting on a lock you do not own is a real hazard — leaving
    // one call site unguarded invites a reader to conclude it is safe everywhere.
    if (inner.beacon?.(batch)) {
      if (a.length > 0) {
        storage.commit()
      }
      if (b.length > 0) {
        cookielessStorage.commit()
      }
    } else {
      if (a.length > 0) {
        storage.rollback()
      }
      if (b.length > 0) {
        cookielessStorage.rollback()
      }
      // rollback() restores the buffer but not the disk: events younger than the persist debounce
      // would die with the page while the report below promised they were queued.
      storage.sync()
      reportBeaconLoss(a.length, b.length, 'on page hide')
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      beaconFlush()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', beaconFlush)

  return {
    send: async (event: Event, options?: SendOptions) => {
      if (state === 'destroyed') {
        return
      }
      if (options?.immediate) {
        try {
          const res = await inner.send(event)
          warnIfPartiallyAccepted(res.accepted, 1)
        } catch (err) {
          if (isPermanentError(err)) {
            log.error('Permanent error sending event, dropping:', err)
            return
          }
          storageFor(event).push(event)
          scheduleFlush()
        }
        return
      }
      storageFor(event).push(event)
      if (totalSize() >= maxSize) {
        flush()
      } else {
        scheduleFlush()
      }
    },

    /**
     * Empties both queues from the device. `ok` is false when a persisted key survived the removal —
     * it answers exactly one question, "did the queues leave the device", so it can feed the teardown
     * chain whose meaning is device state. A dropped farewell beacon reports through reportBeaconLoss
     * but does not flip it: beacons fail routinely under analytics blockers, so folding delivery in
     * made reset() "fail" on blocker-equipped browsers whose devices were verifiably clean — and the
     * README's recipe puts that boolean in front of end users, telling them a stored identifier may
     * have survived.
     *
     * `destroyed` counts only events that actually left the device, per queue: the memory-only
     * cookieless queue always destroys what it held, while a consented queue whose key survived
     * destroyed nothing — save its un-persisted debounced tail, gone with the memory buffer yet
     * uncounted. With the in-flight overcount (a locked batch is included but may still be
     * delivered), the number is approximate in both directions, never an audit. A single
     * `ok && total` could not say any of that — `ok` is structurally the localStorage queue's
     * answer alone, so it made a real cookieless loss unreportable.
     *
     * `send` is true only for `reset()` — a logout, where consent is unchanged and those events were
     * agreed to at collection time. Every consent teardown passes false: transmitting after the user
     * said no is fresh processing of data they just withdrew, and Art. 7(3) protects the prior
     * collection, not a later send.
     *
     * Queued events carry `sessionId` and `distinctId` — after `identify()` the `distinctId` IS the
     * `externalId` — so the queue is identity storage in every sense the profile and session keys
     * are, and it was the one such store the consent teardown never reached.
     *
     * The send is `beacon`, not `flush`: a synchronous user action must not wait on the network, and
     * the events must be gone from the device either way. `peekUnlocked()` excludes any in-flight
     * batch, whose later commit/rollback lands on an emptied buffer and is a harmless no-op.
     */
    purgeQueue: ({ send }: { send: boolean }): PurgeResult => {
      // Held, not reported, until the purge below has run. The counts are captured here because
      // purge() empties the buffers, but the *message* depends on whether the queues actually left
      // the device: announced first, a failed consented purge printed "dropped unsent — the queue is
      // removed" one line above purge()'s own "may be sent on a later visit", and the second is the
      // true one. Same reasoning that keys purgeQueuedEvents' warning on `destroyed`.
      let beaconLoss: { readonly consented: number; readonly cookieless: number } | null = null
      if (send && state !== 'destroyed') {
        const consentedTail = storage.peekUnlocked()
        const cookielessTail = cookielessStorage.peekUnlocked()
        const pending = [...consentedTail, ...cookielessTail]
        // The third beacon call site, and the only one that discarded this result — so a blocked
        // sendBeacon destroyed everything collected under valid consent, returned true, and said
        // nothing. Both other sites (beaconFlush, destroy) already report through reportBeaconLoss.
        if (pending.length > 0 && !inner.beacon?.(pending)) {
          beaconLoss = { consented: consentedTail.length, cookieless: cookielessTail.length }
        }
      }
      // Each queue counts its own buffer, in-flight locked batch included — see purge(). An
      // in-flight batch may still be delivered, so `destroyed` can overstate; the undercount runs
      // the other way — on a failed consented purge, events younger than the persist debounce were
      // destroyed with the buffer (never on disk, memory now cleared) yet count 0 along with the
      // rest of the surviving key. Approximate in both directions, never an audit.
      const consented = storage.purge()
      const cookieless = cookielessStorage.purge()
      if (beaconLoss) {
        // `terminal` is the purge's answer, not an assumption: a surviving key means those events
        // really do retry on the next init().
        reportBeaconLoss(beaconLoss.consented, beaconLoss.cookieless, 'during reset', consented.ok)
      }
      return {
        ok: consented.ok && cookieless.ok,
        destroyed: (consented.ok ? consented.dropped : 0) + cookieless.dropped,
      }
    },
    destroy: () => {
      state = 'destroyed'
      clearTimer()
      storage.dispose()
      cookielessStorage.dispose()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', beaconFlush)

      // An in-flight flush owns that queue's lock, so lock() returns [] and we beacon its *unlocked
      // tail* instead — never committing it, since committing under a held lock would splice that
      // batch out from under the flush. A queue we lock ourselves is committed on beacon success.
      //
      // Duplicate risk, as in beaconFlush: a peeked tail is sent but stays queued, so a surviving
      // page whose in-flight flush then succeeds delivers twice. Accepted — losing them is worse,
      // and BatchCreate is keyed by eventId.
      const a = storage.lock(storage.size)
      const b = cookielessStorage.lock(cookielessStorage.size)
      const consentedTail = a.length === 0 ? storage.peekUnlocked() : []
      const cookielessTail = b.length === 0 ? cookielessStorage.peekUnlocked() : []
      const payload = [...a, ...b, ...consentedTail, ...cookielessTail]
      if (payload.length > 0) {
        if (inner.beacon?.(payload)) {
          if (a.length > 0) {
            storage.commit()
          }
          if (b.length > 0) {
            cookielessStorage.commit()
          }
        } else {
          if (a.length > 0) {
            storage.rollback()
          }
          if (b.length > 0) {
            cookielessStorage.rollback()
          }
          reportBeaconLoss(a.length + consentedTail.length, b.length + cookielessTail.length, 'during destroy()')
        }
      }
    },
  }
}
