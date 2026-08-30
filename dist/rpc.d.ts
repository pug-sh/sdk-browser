import { type DescMessage, type DescMethodUnary, type MessageShape } from '@bufbuild/protobuf';
/**
 * Timeout for one-shot RPCs (`identify`, push `subscribe`), which unlike batched events are never
 * retried — aborting a cold-started backend at the 5s batch default would lose them permanently.
 */
export declare const ONE_SHOT_TIMEOUT_MS = 15000;
/**
 * The gRPC status codes, shared by the producer here and `batch.ts`'s permanent-vs-transient set so
 * the two tables cannot drift. A frozen object rather than a `const enum` because the esbuild-based
 * (per-file) test transform cannot inline enum members across files.
 */
export declare const GrpcCode: {
    readonly Canceled: 1;
    readonly Unknown: 2;
    readonly InvalidArgument: 3;
    readonly DeadlineExceeded: 4;
    readonly NotFound: 5;
    readonly AlreadyExists: 6;
    readonly PermissionDenied: 7;
    readonly ResourceExhausted: 8;
    readonly FailedPrecondition: 9;
    readonly Aborted: 10;
    readonly OutOfRange: 11;
    readonly Unimplemented: 12;
    readonly Internal: 13;
    readonly Unavailable: 14;
    readonly DataLoss: 15;
    readonly Unauthenticated: 16;
};
export type GrpcCode = (typeof GrpcCode)[keyof typeof GrpcCode];
/**
 * Server rejections and network/timeout failures, carrying a numeric gRPC code the batch layer
 * classifies. Network drops and timeouts surface as transient codes with the original error as
 * `cause`. Replaces `@connectrpc/connect`'s `ConnectError`.
 *
 * Deliberately not every failure: a 2xx body that isn't protobuf and a `toBinary` bug surface raw,
 * so `batch.ts` (non-`RpcError` → permanent) drops them instead of retrying the same bad call.
 */
export declare class RpcError extends Error {
    readonly code: GrpcCode;
    readonly cause?: unknown;
    constructor(message: string, code: GrpcCode, cause?: unknown);
}
/**
 * A unary RPC over the Connect protocol with the binary codec — hand-rolled `fetch` replacing
 * `@connectrpc/connect-web` to shrink the bundle, on the same wire format `transport.beacon` uses.
 *
 * Throws an {@link RpcError} for server rejections, network drops and timeouts, or the raw error for
 * a permanent local failure the batch layer must not retry.
 */
export declare const unaryCall: <I extends DescMessage, O extends DescMessage>(endpoint: string, apiKey: string, method: DescMethodUnary<I, O>, message: MessageShape<I>, timeoutMs?: number) => Promise<MessageShape<O>>;
