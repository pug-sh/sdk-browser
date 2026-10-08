import { create, toBinary } from '@bufbuild/protobuf'
import { BatchCreateRequestSchema, type Event, EventsService } from './gen/sdk/events/v1/events_pb.js'
import { log } from './logger.js'
import { connectHeaders, unaryCall } from './rpc.js'

// Browsers refuse keepalive bodies, and sendBeacon payloads, above 64 KiB.
const KEEPALIVE_BODY_LIMIT = 64 * 1024

const supportsKeepalive = () => typeof Request !== 'undefined' && 'keepalive' in Request.prototype

export const createTransport = (endpoint: string, apiKey: string) => {
  const batchCreateUrl = `${endpoint.replace(/\/$/, '')}/sdk.events.v1.EventsService/BatchCreate`

  return {
    send: (event: Event) =>
      unaryCall(
        endpoint,
        apiKey,
        EventsService.method.batchCreate,
        create(BatchCreateRequestSchema, { events: [event] }),
      ),
    sendBatch: (events: Event[]) =>
      unaryCall(endpoint, apiKey, EventsService.method.batchCreate, create(BatchCreateRequestSchema, { events })),
    /**
     * Hands the batch to the browser so it survives the page closing. Returns whether the browser
     * accepted it, not whether it was delivered.
     */
    beacon: (events: Event[]) => {
      try {
        const bytes = toBinary(BatchCreateRequestSchema, create(BatchCreateRequestSchema, { events }))
        if (supportsKeepalive()) {
          if (bytes.byteLength > KEEPALIVE_BODY_LIMIT) {
            return false
          }
          // Not sendBeacon: it always sends cookies, and the SDK endpoints answer CORS with a wildcard
          // origin, so the browser blocks its preflight. A keepalive fetch can omit credentials.
          fetch(batchCreateUrl, {
            method: 'POST',
            keepalive: true,
            credentials: 'omit',
            headers: connectHeaders(apiKey),
            body: bytes,
          }).catch((err: unknown) => log.debug('keepalive flush failed:', err))
          return true
        }
        if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
          return false
        }
        // sendBeacon cannot carry headers, so the API key rides a query param.
        const blob = new Blob([bytes], { type: 'application/proto' })
        return navigator.sendBeacon(`${batchCreateUrl}?api_key=${encodeURIComponent(apiKey)}`, blob)
      } catch (err) {
        log.error('beacon serialization/send failed:', err)
        return false
      }
    },
  }
}
