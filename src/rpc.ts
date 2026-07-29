import { type DescMessage, type DescMethodUnary, fromBinary, type MessageShape, toBinary } from '@bufbuild/protobuf'
import { log } from './logger.js'

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Timeout for one-shot RPCs (`identify`, push `subscribe`), which unlike batched events are never
 * retried — aborting a cold-started backend at the 5s batch default would lose them permanently.
 */
export const ONE_SHOT_TIMEOUT_MS = 15000

/**
 * The gRPC status codes, shared by the producer here and `batch.ts`'s permanent-vs-transient set so
 * the two tables cannot drift. A frozen object rather than a `const enum` because the esbuild-based
 * (per-file) test transform cannot inline enum members across files.
 */
export const GrpcCode = {
  Canceled: 1,
  Unknown: 2,
  InvalidArgument: 3,
  DeadlineExceeded: 4,
  NotFound: 5,
  AlreadyExists: 6,
  PermissionDenied: 7,
  ResourceExhausted: 8,
  FailedPrecondition: 9,
  Aborted: 10,
  OutOfRange: 11,
  Unimplemented: 12,
  Internal: 13,
  Unavailable: 14,
  DataLoss: 15,
  Unauthenticated: 16,
} as const
export type GrpcCode = (typeof GrpcCode)[keyof typeof GrpcCode]

// Connect encodes errors as JSON with a *string* code; map it back to the numeric one.
const CONNECT_CODE_TO_NUMBER: Record<string, GrpcCode> = {
  canceled: GrpcCode.Canceled,
  unknown: GrpcCode.Unknown,
  invalid_argument: GrpcCode.InvalidArgument,
  deadline_exceeded: GrpcCode.DeadlineExceeded,
  not_found: GrpcCode.NotFound,
  already_exists: GrpcCode.AlreadyExists,
  permission_denied: GrpcCode.PermissionDenied,
  resource_exhausted: GrpcCode.ResourceExhausted,
  failed_precondition: GrpcCode.FailedPrecondition,
  aborted: GrpcCode.Aborted,
  out_of_range: GrpcCode.OutOfRange,
  unimplemented: GrpcCode.Unimplemented,
  internal: GrpcCode.Internal,
  unavailable: GrpcCode.Unavailable,
  data_loss: GrpcCode.DataLoss,
  unauthenticated: GrpcCode.Unauthenticated,
}

/**
 * Server rejections and network/timeout failures, carrying a numeric gRPC code the batch layer
 * classifies. Network drops and timeouts surface as transient codes with the original error as
 * `cause`. Replaces `@connectrpc/connect`'s `ConnectError`.
 *
 * Deliberately not every failure: a 2xx body that isn't protobuf and a `toBinary` bug surface raw,
 * so `batch.ts` (non-`RpcError` → permanent) drops them instead of retrying the same bad call.
 */
export class RpcError extends Error {
  readonly code: GrpcCode
  // Declared explicitly: the ES2020 lib's `Error` has no `cause` (that arrived in ES2022).
  readonly cause?: unknown
  constructor(message: string, code: GrpcCode, cause?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

// Fallback when the error body isn't Connect JSON — a proxy/CDN/WAF page. Classifying by status
// *class* keeps 4xx permanent; collapsing them to unknown(2) made batch.ts retry forever.
const codeFromHttpStatus = (status: number): GrpcCode => {
  switch (status) {
    case 401:
      return GrpcCode.Unauthenticated
    case 403:
      return GrpcCode.PermissionDenied // e.g. a Cloudflare WAF/bot block
    case 404:
      return GrpcCode.Unimplemented
    case 408: // request timeout
    case 429: // rate limited
      return GrpcCode.Unavailable
  }
  // Any other 4xx is a client/proxy rejection a retry cannot fix.
  return status >= 400 && status < 500 ? GrpcCode.InvalidArgument : GrpcCode.Unavailable
}

const errorFromResponse = async (res: Response, methodName: string): Promise<RpcError> => {
  try {
    // Connect unary errors are JSON: { code: "<string>", message: "<text>" }. A non-Connect JSON
    // body (proxy/CDN) has no known string code and falls back to the HTTP status.
    const body = (await res.json()) as { code?: unknown; message?: unknown }
    const code =
      typeof body.code === 'string'
        ? (CONNECT_CODE_TO_NUMBER[body.code] ?? codeFromHttpStatus(res.status))
        : codeFromHttpStatus(res.status)
    const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`
    return new RpcError(message, code)
  } catch (err) {
    // Logged at debug so a truncated real Connect error stays distinguishable from a proxy page.
    log.debug(`RPC ${methodName}: error body was not Connect JSON:`, err)
    return new RpcError(`HTTP ${res.status}`, codeFromHttpStatus(res.status))
  }
}

/**
 * A unary RPC over the Connect protocol with the binary codec — hand-rolled `fetch` replacing
 * `@connectrpc/connect-web` to shrink the bundle, on the same wire format `transport.beacon` uses.
 *
 * Throws an {@link RpcError} for server rejections, network drops and timeouts, or the raw error for
 * a permanent local failure the batch layer must not retry.
 */
export const unaryCall = async <I extends DescMessage, O extends DescMessage>(
  endpoint: string,
  apiKey: string,
  method: DescMethodUnary<I, O>,
  message: MessageShape<I>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<MessageShape<O>> => {
  const url = `${endpoint.replace(/\/+$/, '')}/${method.parent.typeName}/${method.name}`
  // Serialized outside the try: a toBinary failure is permanent, and catching it below would
  // mislabel it a network drop.
  const body = toBinary(method.input, message)
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
      body,
      signal: controller.signal,
    })
    if (!res.ok) {
      throw await errorFromResponse(res, method.name)
    }
    // A 2xx whose body isn't protobuf (a captive portal, a CDN health page) makes fromBinary throw a
    // cryptic wire-format error; check the content-type first so the message names the real cause.
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !contentType.includes('proto')) {
      throw new Error(`RPC ${method.name}: expected a protobuf response but got content-type "${contentType}"`)
    }
    return fromBinary(method.output, new Uint8Array(await res.arrayBuffer()))
  } catch (err) {
    if (err instanceof RpcError) {
      throw err
    }
    // A timeout aborts the controller; a network-level rejection throws TypeError. Both are
    // transient, so the batch layer keeps the events queued. The original rides as `cause` so
    // CORS/DNS/mixed-content drops are not all logged alike.
    if (controller.signal.aborted) {
      throw new RpcError('RPC timed out', GrpcCode.DeadlineExceeded, err)
    }
    if (err instanceof TypeError) {
      throw new RpcError('network request failed', GrpcCode.Unavailable, err)
    }
    // Anything else repeats identically on every retry, so surface it raw and let batch.ts drop it
    // rather than loop every ~5s forever. This is the edge @connectrpc/connect-web classified for us.
    throw err
  } finally {
    clearTimeout(timer)
  }
}
