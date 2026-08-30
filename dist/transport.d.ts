import { type Event } from './gen/sdk/events/v1/events_pb.js';
export declare const createTransport: (endpoint: string, apiKey: string) => {
    send: (event: Event) => Promise<import("./gen/sdk/events/v1/events_pb.js").BatchCreateResponse>;
    sendBatch: (events: Event[]) => Promise<import("./gen/sdk/events/v1/events_pb.js").BatchCreateResponse>;
    beacon: (events: Event[]) => boolean;
};
