import { type Event } from './gen/sdk/events/v1/events_pb.js';
export declare const createTransport: (endpoint: string, apiKey: string) => {
    send: (event: Event) => Promise<import("./gen/sdk/events/v1/events_pb.js").BatchCreateResponse>;
    sendBatch: (events: Event[]) => Promise<import("./gen/sdk/events/v1/events_pb.js").BatchCreateResponse>;
    /**
     * Hands the batch to the browser so it survives the page closing. Returns whether the browser
     * accepted it, not whether it was delivered. `onRejected` runs if an accepted keepalive request
     * then fails without reaching the server, while the page is still alive to run it.
     */
    beacon: (events: Event[], onRejected?: () => void) => boolean;
};
