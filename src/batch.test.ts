import { create } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BatchCreateResponseSchema, type Event, EventSchema } from './gen/sdk/events/v1/events_pb.js'
import { log } from './logger.js'
import { GrpcCode, RpcError } from './rpc.js'
import { makeStorageKey } from './utils.js'

// A controllable stand-in for the inner RPC transport so we can drive batch.ts's flush routing
// (permanent → drop, transient → retain+retry) directly, without a real fetch. vi.hoisted lets
// the vi.mock factory (which is hoisted above imports) reference these mocks.
const { sendBatch, send, beacon } = vi.hoisted(() => ({
  sendBatch: vi.fn(),
  send: vi.fn(),
  beacon: vi.fn(),
}))
vi.mock('./transport.js', () => ({ createTransport: () => ({ send, sendBatch, beacon }) }))

const { createBatchedTransport: createRawBatchedTransport } = await import('./batch.js')

// Every transport registers `pagehide`/`visibilitychange` listeners in its constructor and only
// removes them in destroy(). Tests that never destroyed theirs left those listeners live, so a
// later `dispatchEvent('pagehide')` fired every previous test's beaconFlush too — the beacon test
// below passed only because those stale queues happened to be empty and ours registered last.
// Tracking every transport and destroying it in afterEach keeps that coupling out of the suite.
const liveTransports: Array<ReturnType<typeof createRawBatchedTransport>> = []
const createBatchedTransport = (...args: Parameters<typeof createRawBatchedTransport>) => {
  const t = createRawBatchedTransport(...args)
  liveTransports.push(t)
  return t
}

const ENDPOINT = 'https://api.example.com'
const KEY = 'test-key'
let projectCounter = 0

const evt = (kind: string): Event => create(EventSchema, { kind })
const okResponse = (accepted: number) => create(BatchCreateResponseSchema, { accepted })
// A fresh project id per transport keeps each test's localStorage queue isolated.
const freshProject = () => `proj-${projectCounter++}`

// `Event` in this module is the protobuf message type (type-only import, erased at runtime), so a
// bare `new Event('pagehide')` calls a shadowed identifier with no runtime value — it works only via
// that erasure, and CodeQL reads it as invoking undefined. `window.Event` names the DOM constructor.
const firePagehide = () => window.dispatchEvent(new window.Event('pagehide'))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sendBatch.mockReset()
  send.mockReset()
  beacon.mockReset().mockReturnValue(true)
})

afterEach(() => {
  for (const t of liveTransports.splice(0)) {
    t.destroy()
  }
  vi.useRealTimers()
})

describe('createBatchedTransport flush routing', () => {
  it('drops the whole batch on a permanent RpcError and never resends it', async () => {
    sendBatch.mockRejectedValue(new RpcError('denied', GrpcCode.PermissionDenied)) // code 7

    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 2, maxWaitMs: 50 })
    await t.send(evt('a'))
    await t.send(evt('b')) // size hits maxSize → flush()
    await vi.advanceTimersByTimeAsync(0) // settle the flush promise chain

    expect(sendBatch).toHaveBeenCalledTimes(1)

    // Batch was committed (dropped). Advancing well past any retry timer must not resend it.
    sendBatch.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sendBatch).not.toHaveBeenCalled()
  })

  it('treats a non-RpcError (TypeError from a codec/programming bug) as permanent and drops it', async () => {
    sendBatch.mockRejectedValue(new TypeError('boom'))

    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 1, maxWaitMs: 50 })
    await t.send(evt('a'))
    await vi.advanceTimersByTimeAsync(0)

    expect(sendBatch).toHaveBeenCalledTimes(1)

    sendBatch.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sendBatch).not.toHaveBeenCalled()
  })

  it('retains the batch on a transient RpcError and resends the same events on the next flush', async () => {
    sendBatch
      .mockRejectedValueOnce(new RpcError('unavailable', GrpcCode.Unavailable)) // code 14 → rollback
      .mockResolvedValueOnce(okResponse(1)) // retry succeeds

    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 1, maxWaitMs: 50 })
    await t.send(evt('a'))
    await vi.advanceTimersByTimeAsync(0)

    expect(sendBatch).toHaveBeenCalledTimes(1)

    // The failed flush leaves the event queued and schedules a retry. Fire the retry timer.
    await vi.advanceTimersByTimeAsync(60)

    expect(sendBatch).toHaveBeenCalledTimes(2)
    const resent = sendBatch.mock.calls[1][0] as Event[]
    expect(resent).toHaveLength(1)
    expect(resent[0].kind).toBe('a')
  })
})

describe('createBatchedTransport partial-acceptance reporting (C1)', () => {
  it('warns when the server accepts fewer events than were sent', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    sendBatch.mockResolvedValue(okResponse(1)) // sent 2, server accepted only 1

    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 2, maxWaitMs: 50 })
    await t.send(evt('a'))
    await t.send(evt('b'))
    await vi.advanceTimersByTimeAsync(0)

    expect(sendBatch).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1/2'))
    warnSpy.mockRestore()
  })

  it('does not warn when the server accepts every event', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    sendBatch.mockResolvedValue(okResponse(2))

    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 2, maxWaitMs: 50 })
    await t.send(evt('a'))
    await t.send(evt('b'))
    await vi.advanceTimersByTimeAsync(0)

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('accepted'))
    warnSpy.mockRestore()
  })
})

describe('cookieless queue routing', () => {
  const cookielessEvt = (id: string): Event => create(EventSchema, { eventId: id, kind: 'k', cookieless: true })
  const consentedEvt = (id: string): Event =>
    create(EventSchema, { eventId: id, kind: 'k', sessionId: 's', distinctId: 'd' })

  it('never writes cookieless events to localStorage, even while retrying', async () => {
    const project = freshProject()
    const t = createBatchedTransport(ENDPOINT, KEY, project, { maxSize: 10, maxWaitMs: 50 })
    // Transient failure keeps the event queued past the localStorage queue's 1s
    // debounced persist — a single-queue implementation would write it to disk here.
    sendBatch.mockRejectedValue(new RpcError('down', GrpcCode.Unavailable))
    await t.send(cookielessEvt('c1'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(localStorage.getItem(`__pug_${project}_queue__`)).toBeNull()
    t.destroy()
  })

  it('flushes both queues', async () => {
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 10, maxWaitMs: 50 })
    sendBatch.mockResolvedValue(okResponse(1))
    await t.send(consentedEvt('a'))
    await t.send(cookielessEvt('c'))
    await vi.advanceTimersByTimeAsync(200)
    const sentIds = sendBatch.mock.calls.flatMap(([events]: [Event[]]) => events.map(e => e.eventId))
    expect(sentIds.sort()).toEqual(['a', 'c'])
    t.destroy()
  })

  it('beacon drains both queues on page hide', async () => {
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 10, maxWaitMs: 60_000 })
    await t.send(consentedEvt('a'))
    await t.send(cookielessEvt('c'))
    firePagehide()
    // Content-addressed rather than positional: find the call that carries our events instead of
    // assuming ours is last, so the assertion does not depend on listener registration order.
    const ourCall = (beacon.mock.calls as Array<[Event[]]>).find(([events]) =>
      events.some(e => e.eventId === 'a' || e.eventId === 'c'),
    )
    expect(ourCall?.[0].map(e => e.eventId).sort()).toEqual(['a', 'c'])
    t.destroy()
  })

  // I4: `target = storage.size > 0 ? storage : cookielessStorage` meant a continuous consented
  // stream always selected the consented queue, so cookieless events waited for a gap in traffic —
  // while `totalSize() >= maxSize` counted the stalled cookieless backlog and tripped the flush
  // threshold on every arriving event, degrading consented traffic to one request per event.
  it('drains cookieless events even under a continuous consented stream', async () => {
    sendBatch.mockResolvedValue(okResponse(10))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 10, maxWaitMs: 5000 })

    for (let i = 0; i < 9; i++) {
      await t.send(cookielessEvt(`c${i}`))
    }
    // A consented event every 2s for 24s — never a pause long enough for the old code to switch.
    for (let i = 0; i < 12; i++) {
      await t.send(consentedEvt(`a${i}`))
      await vi.advanceTimersByTimeAsync(2000)
    }

    const sentIds = sendBatch.mock.calls.flatMap(([events]: [Event[]]) => events.map(e => e.eventId))
    const cookielessSent = sentIds.filter(id => id.startsWith('c'))
    expect(cookielessSent).toHaveLength(9)
    // And the consented queue is genuinely batched rather than one request per event.
    expect(sendBatch.mock.calls.length).toBeLessThan(12)
  })

  it('builds a single batch from both queues, capped at maxSize', async () => {
    sendBatch.mockResolvedValue(okResponse(4))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 4, maxWaitMs: 50 })
    await t.send(consentedEvt('a1'))
    await t.send(cookielessEvt('c1'))
    await t.send(consentedEvt('a2'))
    await t.send(cookielessEvt('c2'))
    await vi.advanceTimersByTimeAsync(100)

    const [firstBatch] = sendBatch.mock.calls[0] as [Event[]]
    expect(firstBatch.map(e => e.eventId).sort()).toEqual(['a1', 'a2', 'c1', 'c2'])
    expect(firstBatch.length).toBeLessThanOrEqual(4)
  })

  // I6: identical failure (beacon returns false, which happens whenever sendBeacon is absent or
  // blocked — not only on payload rejection), but destroy() is the terminal path: the cookieless
  // queue is memory-only and dies with the transport, so its events are irrecoverable. That was
  // the one path with permanent loss and the one path with no logging at all.
  it('destroy() reports beacon failure, distinguishing recoverable from permanent loss', async () => {
    beacon.mockReturnValue(false)
    const warn = vi.spyOn(log, 'warn')
    const error = vi.spyOn(log, 'error')
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 10, maxWaitMs: 60_000 })
    await t.send(consentedEvt('a'))
    await t.send(cookielessEvt('c'))

    t.destroy()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('remain in the persisted queue'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('cannot be recovered'))
  })
})

describe('cookieless loss reporting and flush fairness', () => {
  const cookielessEvt = (id: string): Event => create(EventSchema, { eventId: id, kind: 'k', cookieless: true })

  // destroy() already splits these two levels; beaconFlush is the path that actually runs on every
  // real navigation and reported both as "they remain queued for next flush". For the memory-only
  // cookieless queue there is no next flush — it dies with the page, so the message said the
  // opposite of what happened. beacon() returns false whenever sendBeacon is absent or blocked,
  // which is routine with analytics-blocking extensions rather than exotic.
  it('reports a failed page-hide beacon of cookieless events as permanent loss', async () => {
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    beacon.mockReturnValue(false)
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 50, maxWaitMs: 60_000 })
    await t.send(cookielessEvt('c1'))
    await t.send(cookielessEvt('c2'))

    // Scope the assertion to this dispatch alone: spies on the shared `log` object outlive a test
    // unless restored, so an unscoped one also sees other transports' teardown output.
    errSpy.mockClear()
    warnSpy.mockClear()
    firePagehide()

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('2 cookieless events'))
    // The consented queue contributed nothing, so nothing should claim to be recoverable.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('remain in the persisted queue'))
    errSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('reports a failed page-hide beacon of consented events as recoverable', async () => {
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    beacon.mockReturnValue(false)
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 50, maxWaitMs: 60_000 })
    await t.send(evt('a'))

    errSpy.mockClear()
    warnSpy.mockClear()
    firePagehide()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 events'))
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining('cookieless'))
    errSpy.mockRestore()
    warnSpy.mockRestore()
  })

  // Routing cookieless events to their own queue narrowed the starvation but did not close it: the
  // consented queue was drained first with the FULL maxSize budget, so `lock(maxSize - consented)`
  // was lock(0) on every flush whenever the consented backlog was >= maxSize. Measured before the
  // fix: 204 send attempts, none carrying a cookieless event.
  // maxSize is swept, not fixed at 3: the reservation `Math.max(1, maxSize - min(pending, ceil(n/2)))`
  // floors the consented budget at 1, which at maxSize:1 IS the whole budget — so cookieless got
  // lock(0) on every flush forever. maxSize:1 is legal (validated with min 1) and is the natural
  // choice for per-event delivery. A single fixed maxSize could never have caught it.
  it.each([
    1, 2, 3, 10,
  ])('does not starve cookieless events behind a maxSize consented backlog (maxSize: %i)', async maxSize => {
    sendBatch.mockRejectedValue(new RpcError('down', GrpcCode.Unavailable))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize, maxWaitMs: 500 })
    for (const k of ['b0', 'b1', 'b2']) {
      await t.send(evt(k))
    }
    await vi.advanceTimersByTimeAsync(3000)

    await t.send(cookielessEvt('c0'))
    await vi.advanceTimersByTimeAsync(5000)

    const attempted = sendBatch.mock.calls.flatMap((c: unknown) => (c as [Event[]])[0].map(e => e.eventId || e.kind))
    expect(attempted).toContain('c0')
  })

  // Same starvation, reached through the config instead of the reserve arithmetic: a fractional
  // maxSize makes `lock(maxSize - consented.length)` reserve 0.5 events, which slice() returns as []
  // while `locked` stays 0.5 — and settle() releases only the queues that contributed, so every
  // later lock() short-circuits on `locked > 0`. Measured at maxSize 1.5 before the fix: 18 send
  // attempts, not one carrying a cookieless event, for the life of the page.
  it('does not strand the cookieless queue on a fractional maxSize', async () => {
    sendBatch.mockRejectedValue(new RpcError('down', GrpcCode.Unavailable))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 1.5, maxWaitMs: 500 })
    for (const k of ['b0', 'b1', 'b2']) {
      await t.send(evt(k))
    }
    await vi.advanceTimersByTimeAsync(3000)

    await t.send(cookielessEvt('c0'))
    await vi.advanceTimersByTimeAsync(5000)

    const attempted = sendBatch.mock.calls.flatMap((c: unknown) => (c as [Event[]])[0].map(e => e.eventId || e.kind))
    expect(attempted).toContain('c0')
  })

  // purgeQueue()'s boolean answers one question: did the queues leave the device? The farewell
  // beacon (send: true is reset()-only — a logout; consent teardowns pass false) reports its own
  // loss through reportBeaconLoss but must not flip the return: beacons fail routinely under
  // analytics blockers, so folding delivery in made reset() "fail" on blocker-equipped browsers
  // whose devices were verifiably clean — and the README's recipe shows that false to the user as
  // "your data may remain".
  it('reports a blocked beacon during reset() without failing the storage purge', async () => {
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    await t.send(cookielessEvt('ck'))
    beacon.mockReturnValue(false)

    expect(t.purgeQueue({ send: true }).ok).toBe(true)
    // The cookieless queue is memory-only, so its loss is permanent — error, not warn.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cookieless'))
    errSpy.mockRestore()
  })

  it('does not claim the destroyed queue will retry when the reset beacon is blocked', async () => {
    // reportBeaconLoss's consented arm says "remain in the persisted queue and will retry on next
    // init()" — true for the page-hide and destroy() phases, where the events roll back and sync()
    // puts them on disk. During reset() the very next statement is storage.purge(), which removes
    // the key: nothing remains and nothing retries. An integrator debugging lost logout events was
    // told the opposite of what happened by the one message that exists to be truthful about it.
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    beacon.mockReturnValue(false)

    expect(t.purgeQueue({ send: true }).ok).toBe(true)

    const claims = [...warnSpy.mock.calls, ...errSpy.mock.calls].map(c => String(c[0]))
    expect(claims.some(m => m.includes('will retry'))).toBe(false)
    expect(claims.some(m => m.includes('dropped unsent'))).toBe(true)
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('does not claim a terminal drop when the persisted purge did not land', async () => {
    // The inverse of the case above, and why the farewell report has to run *after* the purge rather
    // than before it: announced first, it asserted an outcome only the purge knows. With a blocked
    // beacon *and* a surviving key, the console carried "dropped unsent — the queue is removed" one
    // line above purge()'s own "may be sent on a later visit", and the second is the true one — the
    // events really do hydrate and send on the next init(). Claiming destruction is the wrong
    // direction for a privacy-relevant message: it says data is gone while it is still on the device.
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    await vi.advanceTimersByTimeAsync(1100) // debounce the key to disk so a failed removal leaves it
    beacon.mockReturnValue(false)
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})

    expect(t.purgeQueue({ send: true }).ok).toBe(false)

    const claims = [...warnSpy.mock.calls, ...errSpy.mock.calls].map(c => String(c[0]))
    expect(claims.some(m => m.includes('dropped unsent'))).toBe(false)
    expect(claims.some(m => m.includes('will retry'))).toBe(true)
    removeSpy.mockRestore()
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('puts the debounced tail on disk before purging, so "will retry" is true when it prints', async () => {
    // The case above debounces the key to disk by hand before failing the removal. Without that
    // step the freshest events — the click that triggered the navigation — exist only in the
    // buffer, and purge() clears the buffer and cancels the pending persist. The warning still
    // said they "remain in the persisted queue and will retry on next init()", which was false for
    // exactly those events: they were destroyed, and `destroyed` counts 0 for a surviving key, so
    // the one line that would have said so does not print either.
    //
    // beaconFlush() already syncs before reporting for this reason ("To disk before the report");
    // this call site is the one that could not, because it is about to purge. Syncing first makes
    // the message true rather than rewording it: on a failed purge the key really does survive
    // holding the tail.
    const project = freshProject()
    const key = makeStorageKey(project, 'queue')
    const t = createBatchedTransport(ENDPOINT, KEY, project, { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('older'))
    await vi.advanceTimersByTimeAsync(1100) // on disk, so the failed removal below leaves a key
    await t.send(evt('navigation-click')) // memory only — the 1s debounce has not fired
    expect(localStorage.getItem(key)).not.toContain('navigation-click')
    beacon.mockReturnValue(false)
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})

    expect(t.purgeQueue({ send: true }).ok).toBe(false)

    // The surviving key means the report takes the non-terminal arm and promises a retry for both.
    expect(warnSpy.mock.calls.map(c => String(c[0])).some(m => m.includes('will retry'))).toBe(true)
    // Which is only true if the tail went to disk first: unsynced, purge() cleared the buffer and
    // cancelled the pending persist, so this event was destroyed while the message promised it back.
    expect(localStorage.getItem(key)).toContain('navigation-click')
    expect(localStorage.getItem(key)).toContain('older')
    removeSpy.mockRestore()
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('beacons the pending events on a reset purge before dropping them', async () => {
    // The happy path of { send: true }: a logout delivers what was collected under unchanged
    // consent before the queues leave the device. The blocked-beacon test above proves the call
    // only transitively (reportBeaconLoss cannot fire without it); this pins the payload going out
    // and the device ending clean.
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('a'))
    await t.send(evt('b'))

    expect(t.purgeQueue({ send: true }).ok).toBe(true)

    expect(beacon).toHaveBeenCalledTimes(1)
    expect((beacon.mock.calls[0] as unknown as [Event[]])[0].map(e => e.kind)).toEqual(['a', 'b'])
    // Nothing left to send: a later page hide carries nothing.
    firePagehide()
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('persists the debounced tail before reporting a blocked beacon during an in-flight flush', async () => {
    // beaconFlush's in-flight branch: the flush owns the locked batch, so only the unlocked tail
    // is beaconed. When that beacon is blocked, sync() must flush the queue's 1s persist debounce
    // first — the tail is younger than the debounce, so without the sync "remain in the persisted
    // queue" was false for exactly the click that triggered the navigation.
    let resolveFlush: (v: unknown) => void = () => {}
    sendBatch.mockImplementation(() => new Promise(resolve => (resolveFlush = resolve)))
    const p = freshProject()
    const queueKey = `__pug_${p}_queue__`
    const t = createBatchedTransport(ENDPOINT, KEY, p, { maxSize: 1, maxWaitMs: 60_000 })

    await t.send(evt('a')) // maxSize 1 → flush() → in flight, lock held on 'a'
    await t.send(evt('b')) // the tail: buffered, persist debounced — memory-only right now
    expect(localStorage.getItem(queueKey) ?? '').not.toContain('"b"')

    beacon.mockReturnValue(false)
    firePagehide()

    expect(localStorage.getItem(queueKey) ?? '').toContain('"b"') // on disk before the debounce fired
    resolveFlush(okResponse(1))
  })

  it('reports a surviving queue key at error level and returns false', async () => {
    // The last-signal path: pug.ts deliberately logs nothing when purgeQueue() is false, on the
    // strength of this site reporting. A revert to `return true` after removeItem leaves a logout
    // on a shared device with the previous user's identified payloads on disk and nothing logged.
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    await vi.advanceTimersByTimeAsync(1100) // let the debounce write the key to disk
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})

    expect(t.purgeQueue({ send: false }).ok).toBe(false)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('sessionId and distinctId'))
    removeSpy.mockRestore()
    errSpy.mockRestore()
  })

  // `destroyed` counts each queue's whole buffer, in-flight locked batch included: a consent
  // teardown arriving mid-flush is the highest-loss case — the locked batch can be the entire
  // queue — and counting `size` (which excludes locked events) made the caller's "Dropped N queued
  // event(s)" warning silent exactly there. Every other purge test here runs with no lock held, so
  // only this one distinguishes buffer.length from size.
  it('counts the in-flight locked batch in destroyed', async () => {
    let resolveFlush: (v: unknown) => void = () => {}
    sendBatch.mockImplementation(() => new Promise(resolve => (resolveFlush = resolve)))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 2, maxWaitMs: 60_000 })
    await t.send(evt('a'))
    await t.send(evt('b')) // hits maxSize → flush() → both events locked, request in flight
    await vi.advanceTimersByTimeAsync(0)
    expect(sendBatch).toHaveBeenCalledTimes(1)

    expect(t.purgeQueue({ send: false })).toEqual({ ok: true, destroyed: 2 })
    resolveFlush(okResponse(2)) // settle the in-flight request; its commit lands on an empty buffer
  })

  // `ok` is structurally the localStorage queue's answer alone — the memory-only cookieless queue
  // hardcodes true — so `destroyed` has to be counted per queue: the surviving consented key
  // destroyed nothing, while the cookieless events are gone for good. Summing both buffers instead
  // (and gating the caller's report on `ok`) got it backwards in both directions at once.
  it('counts only the queues whose removal landed as destroyed', async () => {
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented-1'))
    await t.send(evt('consented-2'))
    await t.send(cookielessEvt('c1'))
    await vi.advanceTimersByTimeAsync(1100) // let the debounce write the consented key to disk
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})

    // Not 3: the two consented events are still on the device and hydrate on the next init().
    expect(t.purgeQueue({ send: false })).toEqual({ ok: false, destroyed: 1 })
    removeSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('reports a throwing queue removal at error level with the consequence', async () => {
    // Same outcome as the silent no-op — the key survives on the device — so the same level and the
    // same consequence sentence. At warn, the one description of what the failure *means* vanished
    // the moment pug.ts stopped adding its own error.
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    await vi.advanceTimersByTimeAsync(1100)
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('locked')
    })

    expect(t.purgeQueue({ send: false }).ok).toBe(false)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('sessionId and distinctId'), expect.any(Error))
    removeSpy.mockRestore()
    errSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('does not transmit the queue when purging without send', async () => {
    // Consent teardown: beaconing after the user withdrew consent would be a fresh transmission of
    // exactly the data they refused.
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    await t.send(cookielessEvt('ck'))

    expect(t.purgeQueue({ send: false }).ok).toBe(true)
    expect(beacon).not.toHaveBeenCalled()
  })

  // R2-S18: the !isStorageAvailable() arm of reportBeaconLoss was dead to the suite — making it
  // unreachable left 421/421 green. Without localStorage the consented queue is memory-backed too,
  // so "will retry on next init()" is false and the loss is permanent.
  it('escalates consented beacon loss to an error when localStorage is unavailable', async () => {
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    // Spying on the *instance*, not Storage.prototype: a prototype spy never fires in this jsdom
    // environment, so isStorageAvailable() would keep returning true and the branch stay unreached.
    // Once-scoped: mockRestore() does not reliably heal an instance spy over jsdom's Storage proxy,
    // and a permanently broken setItem leaks into every later test in the file.
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('blocked')
    })
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    beacon.mockReturnValue(false)

    firePagehide()

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cannot be recovered'))
    beacon.mockReturnValue(true) // afterEach destroy() delivers the leftover queue silently
    setSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('persists the fresh tail when the page-hide beacon fails', async () => {
    // Events younger than the 1s persist debounce exist only in memory, and the debounce timer dies
    // with the page — so with the beacon blocked, reportBeaconLoss promised they "remain in the
    // persisted queue" while they were about to vanish. The failure path must flush them to disk.
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const project = freshProject()
    const t = createBatchedTransport(ENDPOINT, KEY, project, { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('fresh'))
    beacon.mockReturnValue(false)

    firePagehide()

    expect(localStorage.getItem(`__pug_${project}_queue__`)).toContain('fresh')
    beacon.mockReturnValue(true) // afterEach destroy() delivers the leftover queue silently
    warnSpy.mockRestore()
  })

  it('reports a consented beacon loss as permanent when the queue is memory-backed, even if storage probes fine at report time', async () => {
    // Recoverability is a property of the queue actually in use, not of a probe at report time: a
    // transport built while storage was unavailable keeps its memory queue for life, so a probe
    // that later passes produced "will retry on next init()" about events dying with the page.
    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    // Once-scoped so the availability probe fails at creation only; later probes see real storage.
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('blocked')
    })
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: 99_999 })
    await t.send(evt('consented'))
    beacon.mockReturnValue(false)

    firePagehide()

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cannot be recovered'))
    beacon.mockReturnValue(true) // afterEach destroy() delivers the leftover queue silently
    setSpy.mockRestore()
    errSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

describe('rollback messaging after a concurrent purge', () => {
  // If a flush is in flight when purgeQueue() runs, purge() empties the buffer and the in-flight
  // transient .catch then rolls back onto nothing — while logging "will retry". Nothing will retry;
  // those events are gone. The message actively misdescribed the outcome.
  it('does not claim a retry when the queue was purged mid-flight', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    let rejectSend: (err: unknown) => void = () => {}
    sendBatch.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject
        }),
    )

    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 1, maxWaitMs: 50 })
    await t.send(evt('a')) // hits maxSize -> flush() -> in flight
    await vi.advanceTimersByTimeAsync(0)

    t.purgeQueue({ send: false }) // empties the buffer under the in-flight batch
    rejectSend(new RpcError('down', GrpcCode.Unavailable))
    await vi.advanceTimersByTimeAsync(10)

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('will retry'), expect.anything())
    warnSpy.mockRestore()
  })
})

// `batch` reaches the SDK as untyped `data-options` JSON on the one-tag install, so every member is
// runtime-untrusted. A bare `value >= min` accepted everything JSON.parse can produce, and the two
// that matter both disable a safety bound rather than merely mis-sizing it.
describe('batch config validation against untrusted input', () => {
  const warnFor = (batch: unknown) => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), batch as never)
    const messages = warn.mock.calls.map(c => String(c[0]))
    warn.mockRestore()
    t.destroy()
    return messages
  }

  // The other half of the KNOWN_CONSENT_KEYS pattern. BATCH_RULES made a fourth knob a compile
  // error until it had a rule, but nothing looked at the keys actually *supplied* — so every shape
  // below reached `partialConfig?.[name]`, yielded undefined, read as "not supplied" and took the
  // default in silence. `data-options` JSON is where a casing typo happens and it is exactly where
  // no compiler is watching.
  it('names batch keys it does not recognize instead of silently defaulting', () => {
    const messages = warnFor({ maxsize: 1, maxWaitMS: 3, bogus: 9 }).join()
    expect(messages).toContain('maxsize')
    expect(messages).toContain('maxWaitMS')
    expect(messages).toContain('bogus')
    // Names what it expected, so the casing slip is visible rather than merely reported as unknown.
    expect(messages).toContain('maxSize')
  })

  it('names a batch config that is not an object at all', () => {
    // A string or a number discards the integrator's entire batch configuration, not one member.
    expect(warnFor('oops').join()).toContain('oops')
    expect(warnFor(7).join()).toContain('7')
  })

  it('stays silent for the shapes that legitimately configure nothing', () => {
    // null/undefined are the documented "no batch options" case, and an empty object embeds no
    // misconception — the same reasoning that keeps `{}` silent in resolveAutoCapture.
    expect(warnFor(undefined)).toEqual([])
    expect(warnFor(null)).toEqual([])
    expect(warnFor({})).toEqual([])
  })

  it('still applies the valid members alongside an unrecognized one', () => {
    // Warn and carry on, not fail closed: unlike trackingConsent a mis-sized buffer has no privacy
    // dimension, so answering one typo by disabling batching would be worse than the typo.
    // Required because this test drives a real size-triggered flush: beforeEach's mockReset() leaves
    // sendBatch returning undefined, and flush() calls .then() on it, so the run reports an
    // unhandled rejection while every test still passes.
    sendBatch.mockResolvedValue(okResponse(2))
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 2, bogus: 9 } as never)
    warn.mockRestore()
    void t.send(evt('a'))
    void t.send(evt('b'))
    // maxSize: 2 was honored despite the unknown sibling — a flush went out at the second event.
    expect(sendBatch).toHaveBeenCalledTimes(1)
    t.destroy()
  })

  it('rejects Infinity, which JSON.parse yields for 1e999', () => {
    // Infinity >= 1 is true, so this passed: `buffer.length >= maxQueueSize` never fires and the
    // persisted queue grows until QuotaExceededError — maxAgeDays does not bound the queue either.
    expect(warnFor({ maxQueueSize: Number.POSITIVE_INFINITY }).join()).toContain('maxQueueSize')
    // And on maxSize it disables size-triggered flushing outright.
    expect(warnFor({ maxSize: Number.POSITIVE_INFINITY }).join()).toContain('maxSize')
    // Named, not rendered as "null": JSON.stringify maps the non-finite numbers to the string
    // "null", so the warning for the case this test exists for reported the value as the *other*
    // documented rejection below, and an integrator went looking for a null they never wrote.
    expect(warnFor({ maxSize: Number.POSITIVE_INFINITY }).join()).toContain('Infinity')
  })

  it('rejects null, which passes a bare >= check', () => {
    // `null >= 0` is true, and setTimeout(fn, null) fires immediately — batching becomes one
    // request per event.
    expect(warnFor({ maxWaitMs: null }).join()).toContain('maxWaitMs')
    // Still distinguishable from the Infinity case above, which is what makes either report useful.
    expect(warnFor({ maxWaitMs: null }).join()).toContain('null')
  })

  it('rounds a fractional event count down while still allowing a fractional wait', () => {
    // The counts index arrays: lock()/slice()/splice() truncate a fraction, so maxSize 1.5 reserves
    // half an event and strands a queue (pinned behaviorally above).
    expect(warnFor({ maxSize: 1.5 }).join()).toContain('maxSize')
    // "using 1." — truncation, not the "using 10." a default-replacement arm would print; the
    // message is the only place the two are distinguishable for maxSize (for maxQueueSize the
    // eviction test below pins the behavior too).
    expect(warnFor({ maxSize: 1.5 }).join()).toContain('using 1.')
    expect(warnFor({ maxQueueSize: 1.5 }).join()).toContain('maxQueueSize')
    // maxWaitMs is a duration handed to setTimeout, which is happy with a fraction.
    expect(warnFor({ maxWaitMs: 1.5 })).toEqual([])
  })

  it('treats an explicit undefined member as absent, silently', () => {
    // The config-builder spelling BatchOptions exists for: `{ maxSize: cfg.maxSize }` with the
    // option unset. validated() reads per member with an explicit === undefined check, so this
    // must mean "default, no warning" — a spread-then-validate revert would warn about the exact
    // spelling the type deliberately admits (pinned compile-side in init-options.test-d.ts).
    expect(warnFor({ maxSize: undefined, maxWaitMs: undefined, maxQueueSize: undefined })).toEqual([])
  })

  // Rounded down, not replaced by the default: for the one knob bounding how much
  // sessionId/distinctId-bearing data sits in localStorage, falling back to 1000 would answer a
  // fractional bound (1.5 → 1) by widening it 1000x — the opposite of what rejecting bad input is
  // for.
  it('keeps a fractional maxQueueSize as a bound rather than widening it to the default', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxQueueSize: 1.5, maxWaitMs: 60_000 })
    for (const k of ['a', 'b', 'c']) {
      await t.send(evt(k))
    }

    // Bounded at 1, so each arrival evicts the previous one; at the 1000 default nothing evicts.
    expect(warn.mock.calls.filter(c => String(c[0]).includes('Queue full'))).toHaveLength(2)
    warn.mockRestore()
  })

  it('rejects non-numbers and NaN', () => {
    expect(warnFor({ maxSize: '5' }).join()).toContain('maxSize')
    expect(warnFor({ maxSize: true }).join()).toContain('maxSize')
    expect(warnFor({ maxWaitMs: Number.NaN }).join()).toContain('maxWaitMs')
  })

  it('rejects below-minimum values', () => {
    // 0 and negatives pass typeof/isFinite; without the >= min arm, maxSize 0 reaches lock(0) and
    // stalls delivery for the life of the page, and maxQueueSize -1 evicts every arriving event.
    expect(warnFor({ maxSize: 0 }).join()).toContain('maxSize')
    expect(warnFor({ maxQueueSize: -1 }).join()).toContain('maxQueueSize')
  })

  // The warnings above prove the validator *spoke*; these prove it *acted*. A warn-but-accept
  // implementation — log the message, then use the invalid value anyway — passed every message-only
  // case while shipping exactly the stalls and floods the messages describe.
  it('applies the default after rejecting an invalid maxSize, size-triggering at 10', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    sendBatch.mockResolvedValue(okResponse(10))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), {
      maxSize: Number.POSITIVE_INFINITY,
      maxWaitMs: 60_000,
    })
    for (let i = 0; i < 10; i++) {
      await t.send(evt(`e${i}`))
    }
    // No timer has fired, so this flush can only be size-triggered at the default 10. Accepted,
    // Infinity disables size-triggered flushing outright and nothing sends here.
    expect(sendBatch).toHaveBeenCalledTimes(1)
    expect((sendBatch.mock.calls[0] as [Event[]])[0]).toHaveLength(10)
    warn.mockRestore()
  })

  it('applies the default after rejecting a below-minimum maxSize', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    sendBatch.mockResolvedValue(okResponse(10))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 0, maxWaitMs: 60_000 })
    for (let i = 0; i < 10; i++) {
      await t.send(evt(`e${i}`))
    }
    // Accepted, maxSize 0 trips the size threshold on every send but lock(0) hands flush an empty
    // batch — nothing ever sends.
    expect(sendBatch).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('applies the default wait after rejecting an invalid maxWaitMs', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    sendBatch.mockResolvedValue(okResponse(1))
    const t = createBatchedTransport(ENDPOINT, KEY, freshProject(), { maxSize: 99, maxWaitMs: null as never })
    await t.send(evt('a'))
    // Accepted, setTimeout(fn, null) fires immediately — one request per event.
    await vi.advanceTimersByTimeAsync(4999)
    expect(sendBatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(sendBatch).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('still accepts a valid config silently', () => {
    expect(warnFor({ maxSize: 5, maxWaitMs: 0, maxQueueSize: 20 })).toEqual([])
  })
})
