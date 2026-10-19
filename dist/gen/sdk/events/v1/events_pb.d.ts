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
     * `day_out_of_range` is client clock skew that will drop again on every retry.
     *
     * @generated from field: map<string, uint32> dropped_by_reason = 3;
     */
    droppedByReason: {
        [key: string]: number;
    };
};
/**
 * Describes the message sdk.events.v1.BatchCreateResponse.
 * Use `create(BatchCreateResponseSchema)` to create a new message.
 */
export declare const BatchCreateResponseSchema: GenMessage<BatchCreateResponse>;
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
     * Empty only when cookieless (event.identity_required_unless_cookieless);
     * never client-settable to a 'cookieless-'-prefixed value
     * (batch.distinct_id_reserved_prefix).
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
     * A UUID whenever set; omit entirely in cookieless mode (an explicit "" is
     * also rejected — set fields must satisfy the uuid rule).
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
