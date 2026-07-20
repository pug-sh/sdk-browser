import { afterEach, describe, expect, it, vi } from 'vitest'

// Only the wire is mocked — everything between track() and the transport
// (consent, session, profile, persistence, batching) is real, so this suite
// catches ANY code path that writes to the device in cookieless mode.
const { sendBatch, send, beacon } = vi.hoisted(() => ({
  sendBatch: vi.fn(() => Promise.resolve({ accepted: 1 })),
  send: vi.fn(() => Promise.resolve({ accepted: 1 })),
  beacon: vi.fn(() => true),
}))
vi.mock('./transport.js', () => ({ createTransport: () => ({ send, sendBatch, beacon }) }))

const { init, track, destroy } = await import('./pug.js')

describe('cookieless storage silence', () => {
  afterEach(() => {
    vi.useRealTimers()
    destroy()
    localStorage.clear()
  })

  it('a full cookieless session writes nothing to the device', async () => {
    vi.useFakeTimers()
    init('proj-silence', { apiKey: 'k', trackingConsent: 'cookieless' })
    track('page_view')
    track('click', { x: 1 })
    await vi.advanceTimersByTimeAsync(10_000) // flush timers + queue debounce

    expect(localStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('the same flow under granted consent does persist identity (control)', async () => {
    vi.useFakeTimers()
    init('proj-control', { apiKey: 'k', trackingConsent: 'granted' })
    track('page_view')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(localStorage.length).toBeGreaterThan(0)
  })
})
