import { create, toBinary } from '@bufbuild/protobuf';
import { BatchCreateRequestSchema, EventsService } from './gen/sdk/events/v1/events_pb.js';
import { log } from './logger.js';
import { connectHeaders, unaryCall } from './rpc.js';
// Browsers refuse keepalive bodies, and sendBeacon payloads, above 64 KiB in flight per page.
const KEEPALIVE_BODY_LIMIT = 64 * 1024;
const supportsKeepalive = () => typeof Request !== 'undefined' && 'keepalive' in Request.prototype;
export const createTransport = (endpoint, apiKey) => {
    const batchCreateUrl = `${endpoint.replace(/\/$/, '')}/sdk.events.v1.EventsService/BatchCreate`;
    // Our own pending keepalive bodies. The browser's budget is shared and rejects asynchronously, after
    // the caller has already committed its queue, so a batch our own requests would push over the limit
    // is refused here instead, while the caller can still roll it back. Other scripts' requests share
    // the budget too; only `onRejected` can catch those.
    let keepaliveBytesInFlight = 0;
    return {
        send: (event) => unaryCall(endpoint, apiKey, EventsService.method.batchCreate, create(BatchCreateRequestSchema, { events: [event] })),
        sendBatch: (events) => unaryCall(endpoint, apiKey, EventsService.method.batchCreate, create(BatchCreateRequestSchema, { events })),
        /**
         * Hands the batch to the browser so it survives the page closing. Returns whether the browser
         * accepted it, not whether it was delivered. `onRejected` runs if an accepted keepalive request
         * then fails without reaching the server, while the page is still alive to run it.
         */
        beacon: (events, onRejected) => {
            try {
                const bytes = toBinary(BatchCreateRequestSchema, create(BatchCreateRequestSchema, { events }));
                if (supportsKeepalive()) {
                    if (keepaliveBytesInFlight + bytes.byteLength > KEEPALIVE_BODY_LIMIT) {
                        return false;
                    }
                    keepaliveBytesInFlight += bytes.byteLength;
                    // Not sendBeacon: it always sends cookies, and the SDK endpoints answer CORS with a wildcard
                    // origin, so the browser blocks its preflight. A keepalive fetch can omit credentials.
                    fetch(batchCreateUrl, {
                        method: 'POST',
                        keepalive: true,
                        credentials: 'omit',
                        headers: connectHeaders(apiKey),
                        body: bytes,
                    })
                        .then(() => undefined, (err) => {
                        log.debug('keepalive flush failed:', err);
                        onRejected?.();
                    })
                        .finally(() => {
                        keepaliveBytesInFlight -= bytes.byteLength;
                    })
                        .catch((err) => log.error('handling a failed keepalive flush failed:', err));
                    return true;
                }
                if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
                    return false;
                }
                // sendBeacon cannot carry headers, so the API key rides a query param.
                const blob = new Blob([bytes], { type: 'application/proto' });
                return navigator.sendBeacon(`${batchCreateUrl}?api_key=${encodeURIComponent(apiKey)}`, blob);
            }
            catch (err) {
                log.error('beacon serialization/send failed:', err);
                return false;
            }
        },
    };
};
