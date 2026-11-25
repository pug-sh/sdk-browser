import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { PropertyValue } from "../../../common/v1/property_value_pb.js";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file sdk/events/v1/events.proto.
 */
export declare const file_sdk_events_v1_events: GenFile;
/**
 * @generated from message sdk.events.v1.BatchCreateRequest
 */
export type BatchCreateRequest = Message<"sdk.events.v1.BatchCreateRequest"> & {
    /**
     * BatchCreate validates each event on its own, as an IncomingEvent, so an
     * event that breaks a rule, or repeats an earlier kept event's event_id, is
     * dropped as invalid_event and the rest are kept.
     *
     * @generated from field: repeated sdk.events.v1.Event events = 1;
     */
    events: Event[];
};
/**
 * Describes the message sdk.events.v1.BatchCreateRequest.
 * Use `create(BatchCreateRequestSchema)` to create a new message.
 */
export declare const BatchCreateRequestSchema: GenMessage<BatchCreateRequest>;
/**
 * @generated from message sdk.events.v1.BatchCreateResponse
 */
export type BatchCreateResponse = Message<"sdk.events.v1.BatchCreateResponse"> & {
    /**
     * @generated from field: uint32 accepted = 1;
     */
    accepted: number;
    /**
     * Events the server refused to ingest; accepted + dropped equals the number
     * sent. A drop is deliberately not an error: a batch may legitimately mix
     * cookieless and consented events, so failing the request would discard
     * healthy traffic to report a fault affecting only part of it. That makes
     * this field the only signal to the caller that anything was lost.
     *
     * @generated from field: uint32 dropped = 2;
     */
    dropped: number;
    /**
     * Per-reason breakdown of `dropped`, keyed by a stable reason token. This is
     * what makes a drop actionable rather than merely visible: `salt_unavailable`
     * is a server-side fault and the same payload may be retried, whereas
     * `day_out_of_range` is client clock skew and `invalid_event` an event that
     * broke a validation rule or repeated an earlier kept event's event_id, and
     * both drop again on every retry.
     *
     * @generated from field: map<string, uint32> dropped_by_reason = 3;
     */
    droppedByReason: {
        [key: string]: number;
    };
    /**
     * The events dropped as `invalid_event`, in request order.
     *
     * @generated from field: repeated sdk.events.v1.InvalidEvent invalid_events = 4;
     */
    invalidEvents: InvalidEvent[];
};
/**
 * Describes the message sdk.events.v1.BatchCreateResponse.
 * Use `create(BatchCreateResponseSchema)` to create a new message.
 */
export declare const BatchCreateResponseSchema: GenMessage<BatchCreateResponse>;
/**
 * @generated from message sdk.events.v1.InvalidEvent
 */
export type InvalidEvent = Message<"sdk.events.v1.InvalidEvent"> & {
    /**
     * Position in BatchCreateRequest.events, counting from 0.
     *
     * @generated from field: uint32 index = 1;
     */
    index: number;
    /**
     * The rules it broke, e.g. "event.kind: does not match regex pattern `^[a-zA-Z0-9_.-]+$`".
     * At most 10, then one more entry that counts the rest, e.g. "and 3 more".
     *
     * @generated from field: repeated string violations = 2;
     */
    violations: string[];
};
/**
 * Describes the message sdk.events.v1.InvalidEvent.
 * Use `create(InvalidEventSchema)` to create a new message.
 */
export declare const InvalidEventSchema: GenMessage<InvalidEvent>;
/**
 * Never sent. BatchCreate validates each event as one: Event's rules plus those
 * that hold only at the SDK boundary, since the server fills a cookieless or
 * crawler_request event's identity, with 'cookieless-' or 'crawler-' ids,
 * before the EventBatch envelope re-validates it.
 *
 * @generated from message sdk.events.v1.IncomingEvent
 */
export type IncomingEvent = Message<"sdk.events.v1.IncomingEvent"> & {
    /**
     * @generated from field: sdk.events.v1.Event event = 1;
     */
    event?: Event | undefined;
};
/**
 * Describes the message sdk.events.v1.IncomingEvent.
 * Use `create(IncomingEventSchema)` to create a new message.
 */
export declare const IncomingEventSchema: GenMessage<IncomingEvent>;
/**
 * The requester a customer's server saw. The server checks it and drops it.
 *
 * @generated from message sdk.events.v1.Client
 */
export type Client = Message<"sdk.events.v1.Client"> & {
    /**
     * Empty when the caller doesn't know it.
     *
     * @generated from field: string ip = 1;
     */
    ip: string;
    /**
     * @generated from field: string user_agent = 2;
     */
    userAgent: string;
};
/**
 * Describes the message sdk.events.v1.Client.
 * Use `create(ClientSchema)` to create a new message.
 */
export declare const ClientSchema: GenMessage<Client>;
/**
 * @generated from message sdk.events.v1.Event
 */
export type Event = Message<"sdk.events.v1.Event"> & {
    /**
     * @generated from field: string event_id = 1;
     */
    eventId: string;
    /**
     * @generated from field: map<string, common.v1.PropertyValue> auto_properties = 2;
     */
    autoProperties: {
        [key: string]: PropertyValue;
    };
    /**
     * @generated from field: map<string, common.v1.PropertyValue> custom_properties = 3;
     */
    customProperties: {
        [key: string]: PropertyValue;
    };
    /**
     * Empty only when cookieless or a crawler_request
     * (event.identity_required_unless_cookieless); never client-settable to a
     * 'cookieless-' or 'crawler-'-prefixed value
     * (incoming_event.distinct_id_reserved_prefix and
     * incoming_event.distinct_id_reserved_crawler_prefix).
     *
     * @generated from field: string distinct_id = 4;
     */
    distinctId: string;
    /**
     * Same character set as common.v1.EventFilter.kind (filters.proto); + requires non-empty at ingest.
     *
     * @generated from field: string kind = 5;
     */
    kind: string;
    /**
     * @generated from field: google.protobuf.Timestamp occur_time = 6;
     */
    occurTime?: Timestamp | undefined;
    /**
     * A UUID whenever set; omit entirely in cookieless mode (an explicit "" also
     * drops the event as invalid_event, since a set field must be a UUID).
     *
     * @generated from field: string session_id = 7;
     */
    sessionId: string;
    /**
     * Cookieless (no-consent) mode: the client stores nothing on the device and
     * sends no identity; the ingest server derives an ephemeral daily-rotating
     * distinct_id and a stitched session_id. See docs/architecture/ingestion.md.
     *
     * @generated from field: bool cookieless = 8;
     */
    cookieless: boolean;
    /**
     * Only on a crawler_request event, and only from a private key, which a crawler
     * collector sends from the site's server.
     *
     * @generated from field: sdk.events.v1.Client client = 9;
     */
    client?: Client | undefined;
};
/**
 * Describes the message sdk.events.v1.Event.
 * Use `create(EventSchema)` to create a new message.
 */
export declare const EventSchema: GenMessage<Event>;
/**
 * @generated from message sdk.events.v1.EventBatch
 */
export type EventBatch = Message<"sdk.events.v1.EventBatch"> & {
    /**
     * @generated from field: repeated sdk.events.v1.Event events = 1;
     */
    events: Event[];
    /**
     * @generated from field: string project_id = 2;
     */
    projectId: string;
};
/**
 * Describes the message sdk.events.v1.EventBatch.
 * Use `create(EventBatchSchema)` to create a new message.
 */
export declare const EventBatchSchema: GenMessage<EventBatch>;
/**
 * @generated from service sdk.events.v1.EventsService
 */
export declare const EventsService: GenService<{
    /**
     * @generated from rpc sdk.events.v1.EventsService.BatchCreate
     */
    batchCreate: {
        methodKind: "unary";
        input: typeof BatchCreateRequestSchema;
        output: typeof BatchCreateResponseSchema;
    };
}>;
