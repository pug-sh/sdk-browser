import { type DescMessage, type DescMethodUnary, fromBinary, type MessageShape, toBinary } from '@bufbuild/protobuf'

const DEFAULT_TIMEOUT_MS = 5000

// A subset of the canonical gRPC status codes we produce for network/timeout
// failures. Server errors carry whatever code the Connect JSON body reports.
const CODE_UNKNOWN = 2
const CODE_DEADLINE_EXCEEDED = 4
const CODE_UNAVAILABLE = 14

// Connect encodes errors as JSON with a *string* `code`; map it back to the numeric
// gRPC code so the batch layer can classify permanent vs. transient failures.
const CONNECT_CODE_TO_NUMBER: Record<string, number> = {
  canceled: 1,
  unknown: 2,
  invalid_argument: 3,
  deadline_exceeded: 4,
  not_found: 5,
  already_exists: 6,
  permission_denied: 7,
  resource_exhausted: 8,
  failed_precondition: 9,
  aborted: 10,
  out_of_range: 11,
  unimplemented: 12,
  internal: 13,
  unavailable: 14,
  data_loss: 15,
  unauthenticated: 16,
}

/**
 * Error thrown by {@link unaryCall}, carrying a numeric gRPC status code. Network
 * failures and timeouts surface as transient codes (`unavailable` / `deadline_exceeded`)
 * so `batch.ts` retries them; server rejections carry the code from the Connect JSON
 * error body. Replaces `@connectrpc/connect`'s `ConnectError` for the batch layer's
 * permanent-vs-transient classification.
 */
export class RpcError extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

// Fallback classification when an error body isn't a Connect JSON error — a proxy/CDN/WAF
// page (HTML, or non-Connect JSON) such as a Cloudflare 403 bot-block or a 429. Mirrors
// @connectrpc/connect's codeFromHttpStatus so 401/403/404 map to PERMANENT gRPC codes
// (batch.ts drops them) instead of collapsing to unknown(2)/transient and being retried on
// every flush forever. 429 and 5xx stay transient (unavailable), which is retryable.
const codeFromHttpStatus = (status: number): number => {
  switch (status) {
    case 400:
      return 13 // internal (transient)
    case 401:
      return 16 // unauthenticated (permanent)
    case 403:
      return 7 // permission_denied (permanent) — e.g. a Cloudflare WAF/bot block
    case 404:
      return 12 // unimplemented (permanent)
    case 429:
    case 502:
    case 503:
    case 504:
      return CODE_UNAVAILABLE // transient — retry
    default:
      return CODE_UNKNOWN
  }
}

const errorFromResponse = async (res: Response): Promise<RpcError> => {
  // Connect unary errors are JSON: { "code": "<string>", "message": "<text>" }.
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown }
    // A genuine Connect error carries a known string `code`; a non-Connect JSON body (proxy/CDN)
    // falls back to the HTTP status, same as a non-JSON body below.
    const code =
      typeof body.code === 'string'
        ? (CONNECT_CODE_TO_NUMBER[body.code] ?? codeFromHttpStatus(res.status))
        : codeFromHttpStatus(res.status)
    const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`
    return new RpcError(message, code)
  } catch {
    // Non-JSON error body (a proxy/gateway/CDN page). Classify by HTTP status so an
    // unretryable 4xx block (e.g. a Cloudflare WAF/bot 403) is dropped, not retried forever.
    return new RpcError(`HTTP ${res.status}`, codeFromHttpStatus(res.status))
  }
}

/**
 * Invokes a unary RPC over the Connect protocol with the binary (protobuf) codec — a
 * hand-rolled `fetch` replacing `@connectrpc/connect-web` to shrink the bundle. The
 * request message is serialized straight into the POST body and the response is parsed
 * from the binary body; the API key rides the `x-api-key` header. This is the same wire
 * format `transport.beacon` already uses.
 *
 * Always throws {@link RpcError} on failure (it never resolves on a non-2xx response),
 * so callers get a consistent, numeric-coded error regardless of whether the failure was
 * a server rejection, a network drop, or the request timing out.
 */
export const unaryCall = async <I extends DescMessage, O extends DescMessage>(
  endpoint: string,
  apiKey: string,
  method: DescMethodUnary<I, O>,
  message: MessageShape<I>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<MessageShape<O>> => {
  const url = `${endpoint.replace(/\/+$/, '')}/${method.parent.typeName}/${method.name}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/proto',
        'connect-protocol-version': '1',
        'x-api-key': apiKey,
      },
      body: toBinary(method.input, message),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw await errorFromResponse(res)
    }
    return fromBinary(method.output, new Uint8Array(await res.arrayBuffer()))
  } catch (err) {
    if (err instanceof RpcError) {
      throw err
    }
    // Aborted (timeout) or a network-level fetch rejection — both transient, so the
    // batch layer keeps the events queued and retries on the next flush.
    throw new RpcError(
      controller.signal.aborted ? 'RPC timed out' : 'network request failed',
      controller.signal.aborted ? CODE_DEADLINE_EXCEEDED : CODE_UNAVAILABLE,
    )
  } finally {
    clearTimeout(timer)
  }
}
