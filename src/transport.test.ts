import { create } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Event, EventSchema, EventsService } from './gen/sdk/events/v1/events_pb.js'

// send/sendBatch are thin wrappers over unaryCall; mock it so we can assert the delegation
// (endpoint, api key, method descriptor, request message) without a real fetch.
const { unaryCall } = vi.hoisted(() => ({ unaryCall: vi.fn(() => Promise.resolve()) }))
vi.mock('./rpc.js', async importOriginal => ({ ...(await importOriginal<typeof import('./rpc.js')>()), unaryCall }))

const { createTransport } = await import('./transport.js')

const ENDPOINT = 'https://api.example.com'
// Includes reserved characters so the ?api_key= encoding is actually exercised.
const KEY = 'k/e y+?&='
const evt = (kind = 'e'): Event => create(EventSchema, { kind })

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('send / sendBatch delegate to unaryCall', () => {
  it('send() posts a single-event BatchCreate', () => {
    createTransport(ENDPOINT, KEY).send(evt('a'))

    expect(unaryCall).toHaveBeenCalledTimes(1)
    const [endpoint, apiKey, method, message] = unaryCall.mock.calls[0]
    expect(endpoint).toBe(ENDPOINT)
    expect(apiKey).toBe(KEY)
    expect(method).toBe(EventsService.method.batchCreate)
    expect(message.$typeName).toBe('sdk.events.v1.BatchCreateRequest')
    expect(message.events).toHaveLength(1)
    expect(message.events[0].kind).toBe('a')
  })

  it('sendBatch() posts every event in one BatchCreate', () => {
    createTransport(ENDPOINT, KEY).sendBatch([evt('a'), evt('b'), evt('c')])

    const [, , method, message] = unaryCall.mock.calls[0]
    expect(method).toBe(EventsService.method.batchCreate)
    expect(message.events.map((e: Event) => e.kind)).toEqual(['a', 'b', 'c'])
  })
})

// `'keepalive' in Request.prototype` is how the transport detects keepalive fetch support.
const KeepaliveRequest = class {
  get keepalive() {
    return true
  }
}
const LegacyRequest = class {}

describe('beacon with keepalive fetch', () => {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null)))
  const sendBeacon = vi.fn(() => true)

  beforeEach(() => {
    vi.stubGlobal('Request', KeepaliveRequest)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { sendBeacon })
  })

  it('posts the batch with keepalive, without credentials, and the key as a header', () => {
    const ok = createTransport(`${ENDPOINT}/`, KEY).beacon([evt()])

    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    // Cookies would fail the preflight against the endpoints' wildcard CORS, so they must be omitted.
    expect(url).toBe(`${ENDPOINT}/sdk.events.v1.EventsService/BatchCreate`)
    expect(init).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { 'content-type': 'application/proto', 'connect-protocol-version': '1', 'x-api-key': KEY },
    })
    expect(init.body).toBeInstanceOf(Uint8Array)
    expect(sendBeacon).not.toHaveBeenCalled()
  })

  it('refuses a batch over the 64 KiB keepalive budget without sending it', () => {
    expect(createTransport(ENDPOINT, KEY).beacon([evt('x'.repeat(70_000))])).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a failed keepalive fetch, since the page may already be gone', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(createTransport(ENDPOINT, KEY).beacon([evt()])).toBe(true)
    // An unhandled rejection would fail the run here.
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})

describe('beacon without keepalive support falls back to sendBeacon', () => {
  beforeEach(() => vi.stubGlobal('Request', LegacyRequest))

  it('returns false when navigator.sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', { sendBeacon: undefined })

    expect(createTransport(ENDPOINT, KEY).beacon([evt()])).toBe(false)
  })

  it('appends the api key as an encoded ?api_key= param, strips one trailing slash, sends proto', () => {
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { sendBeacon })

    const ok = createTransport(`${ENDPOINT}/`, KEY).beacon([evt()])

    expect(ok).toBe(true)
    const [url, blob] = sendBeacon.mock.calls[0]
    expect(url).toBe(`${ENDPOINT}/sdk.events.v1.EventsService/BatchCreate?api_key=${encodeURIComponent(KEY)}`)
    // The raw key contains reserved chars that must not appear un-encoded in the query.
    expect(url).not.toContain('k/e y')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/proto')
  })

  it('propagates the sendBeacon boolean result (false when the browser refuses to queue)', () => {
    const sendBeacon = vi.fn(() => false)
    vi.stubGlobal('navigator', { sendBeacon })

    expect(createTransport(ENDPOINT, KEY).beacon([evt()])).toBe(false)
  })
})
