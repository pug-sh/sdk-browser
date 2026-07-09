import { create, toBinary } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BatchCreateRequestSchema, BatchCreateResponseSchema, EventsService } from './gen/sdk/events/v1/events_pb.js'
import { RpcError, unaryCall } from './rpc.js'

const ENDPOINT = 'https://api.example.com'
const API_KEY = 'test-key'
const METHOD = EventsService.method.batchCreate
const BATCH_URL = 'https://api.example.com/sdk.events.v1.EventsService/BatchCreate'

const request = () => create(BatchCreateRequestSchema, { events: [] })

const okResponse = () => {
  const body = toBinary(BatchCreateResponseSchema, create(BatchCreateResponseSchema, {}))
  return new Response(body, { status: 200, headers: { 'content-type': 'application/proto' } })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('unaryCall', () => {
  it('POSTs binary protobuf to the service/method path with the api-key header', async () => {
    fetchMock.mockResolvedValue(okResponse())

    await unaryCall(ENDPOINT, API_KEY, METHOD, request())

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(BATCH_URL)
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/proto')
    expect(init.headers['connect-protocol-version']).toBe('1')
    expect(init.headers['x-api-key']).toBe(API_KEY)
    expect(init.body).toBeInstanceOf(Uint8Array)
  })

  it('strips trailing slashes from the endpoint', async () => {
    fetchMock.mockResolvedValue(okResponse())

    await unaryCall(`${ENDPOINT}//`, API_KEY, METHOD, request())

    expect(fetchMock.mock.calls[0][0]).toBe(BATCH_URL)
  })

  it('parses the binary protobuf response', async () => {
    fetchMock.mockResolvedValue(okResponse())

    const res = await unaryCall(ENDPOINT, API_KEY, METHOD, request())

    expect(res.$typeName).toBe('sdk.events.v1.BatchCreateResponse')
  })

  it('maps a Connect JSON error body to an RpcError with the numeric gRPC code', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'invalid_argument', message: 'bad request' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(unaryCall(ENDPOINT, API_KEY, METHOD, request())).rejects.toMatchObject({
      name: 'RpcError',
      code: 3, // InvalidArgument — permanent, so batch.ts drops rather than retries
      message: 'bad request',
    })
  })

  it('classifies a non-JSON HTTP error by status (mirrors connect-web) so proxy/CDN blocks get the right code', async () => {
    // A non-Connect error body (a proxy/CDN/WAF HTML page — e.g. a Cloudflare 403 bot block)
    // is classified by HTTP status. Without this, every such body collapsed to unknown(2),
    // which batch.ts treats as transient and retries on every flush forever. 4xx auth/routing
    // codes must be permanent (dropped); 429 and 5xx stay transient (retryable).
    const cases: Array<[number, number]> = [
      [400, 13], // internal — transient
      [401, 16], // unauthenticated — permanent
      [403, 7], // permission_denied — permanent (the Cloudflare WAF/bot-block case)
      [404, 12], // unimplemented — permanent
      [429, 14], // unavailable — transient (retry)
      [502, 14], // unavailable — transient
    ]
    for (const [status, code] of cases) {
      fetchMock.mockResolvedValueOnce(new Response('<html>blocked</html>', { status }))
      await expect(unaryCall(ENDPOINT, API_KEY, METHOD, request())).rejects.toMatchObject({ code })
    }
  })

  it('wraps a network failure as a transient RpcError (unavailable) so the batch layer retries', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const err = await unaryCall(ENDPOINT, API_KEY, METHOD, request()).catch(e => e)

    expect(err).toBeInstanceOf(RpcError)
    expect(err.code).toBe(14)
  })

  it('wraps a timeout (abort) as a transient RpcError (deadline_exceeded)', async () => {
    // Reject only once the request's own signal aborts, mimicking a stalled request.
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    await expect(unaryCall(ENDPOINT, API_KEY, METHOD, request(), 5)).rejects.toMatchObject({ code: 4 })
  })
})
