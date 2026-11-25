import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file sdk/profiles/v1/profiles.proto.
 */
export declare const file_sdk_profiles_v1_profiles: GenFile;
/**
 * @generated from message sdk.profiles.v1.IdentifyRequest
 */
export type IdentifyRequest = Message<"sdk.profiles.v1.IdentifyRequest"> & {
    /**
     * Stable, unique user identifier: your database user ID, not an email, which
     * can change.
     * The 'cookieless-' and 'crawler-' prefixes are server-owned: ingest mints
     * those ids and the reserved-prefix rules on an incoming event's distinct_id
     * already refuse them from clients. external_id needs the same guard because
     * post-identify events are keyed by external_id, so an id accepted here comes
     * back as a distinct_id and BatchCreate drops every event of that user.
     *
     * @generated from field: string external_id = 1;
     */
    externalId: string;
    /**
     * Profile properties, shallow-merged into existing properties. On key conflict,
     * these values take precedence over previously stored values. A trait whose key,
     * or any string in it, holds a NUL can't be stored and is dropped.
     *
     * @generated from field: google.protobuf.Struct traits = 2;
     */
    traits?: JsonObject | undefined;
    /**
     * The SDK-generated anonymous ID. The SDK should send this on first identify
     * to trigger merge-and-soft-delete of the anonymous profile. Must start with "anon-".
     *
     * @generated from field: string anonymous_id = 3;
     */
    anonymousId: string;
    /**
     * The device to assign to this profile. The SDK should send this on first
     * identify and on account switch (external_id changed), not on every call,
     * to avoid unnecessary DB writes. Omit for web SDKs without push support.
     *
     * @generated from field: string device_id = 4;
     */
    deviceId: string;
};
/**
 * Describes the message sdk.profiles.v1.IdentifyRequest.
 * Use `create(IdentifyRequestSchema)` to create a new message.
 */
export declare const IdentifyRequestSchema: GenMessage<IdentifyRequest>;
/**
 * @generated from message sdk.profiles.v1.IdentifyResponse
 */
export type IdentifyResponse = Message<"sdk.profiles.v1.IdentifyResponse"> & {};
/**
 * Describes the message sdk.profiles.v1.IdentifyResponse.
 * Use `create(IdentifyResponseSchema)` to create a new message.
 */
export declare const IdentifyResponseSchema: GenMessage<IdentifyResponse>;
/**
 * @generated from message sdk.profiles.v1.BatchIdentifyRequest
 */
export type BatchIdentifyRequest = Message<"sdk.profiles.v1.BatchIdentifyRequest"> & {
    /**
     * BatchIdentify validates each item on its own with IdentifyRequest's rules,
     * so an invalid item is skipped and the rest are queued.
     *
     * @generated from field: repeated sdk.profiles.v1.IdentifyRequest identifies = 1;
     */
    identifies: IdentifyRequest[];
};
/**
 * Describes the message sdk.profiles.v1.BatchIdentifyRequest.
 * Use `create(BatchIdentifyRequestSchema)` to create a new message.
 */
export declare const BatchIdentifyRequestSchema: GenMessage<BatchIdentifyRequest>;
/**
 * @generated from message sdk.profiles.v1.BatchIdentifyResponse
 */
export type BatchIdentifyResponse = Message<"sdk.profiles.v1.BatchIdentifyResponse"> & {
    /**
     * Identifies queued for the worker, not yet applied.
     *
     * @generated from field: uint32 accepted = 1;
     */
    accepted: number;
    /**
     * The items skipped for breaking a validation rule, in request order.
     *
     * @generated from field: repeated sdk.profiles.v1.InvalidIdentify invalid_identifies = 2;
     */
    invalidIdentifies: InvalidIdentify[];
};
/**
 * Describes the message sdk.profiles.v1.BatchIdentifyResponse.
 * Use `create(BatchIdentifyResponseSchema)` to create a new message.
 */
export declare const BatchIdentifyResponseSchema: GenMessage<BatchIdentifyResponse>;
/**
 * @generated from message sdk.profiles.v1.InvalidIdentify
 */
export type InvalidIdentify = Message<"sdk.profiles.v1.InvalidIdentify"> & {
    /**
     * Position in BatchIdentifyRequest.identifies, counting from 0.
     *
     * @generated from field: uint32 index = 1;
     */
    index: number;
    /**
     * The rules it broke, e.g. "external_id: external_id must not start with the
     * reserved 'cookieless-' prefix". At most 10, then one more entry that counts
     * the rest, e.g. "and 3 more".
     *
     * @generated from field: repeated string violations = 2;
     */
    violations: string[];
};
/**
 * Describes the message sdk.profiles.v1.InvalidIdentify.
 * Use `create(InvalidIdentifySchema)` to create a new message.
 */
export declare const InvalidIdentifySchema: GenMessage<InvalidIdentify>;
/**
 * ProfileIdentifyMessage is the internal NATS envelope for the identify worker.
 * project_id is injected server-side from the authenticated principal.
 *
 * @generated from message sdk.profiles.v1.ProfileIdentifyMessage
 */
export type ProfileIdentifyMessage = Message<"sdk.profiles.v1.ProfileIdentifyMessage"> & {
    /**
     * Mirrors IdentifyRequest.external_id: the worker re-validates this envelope,
     * so its rules hold at both stages rather than trusting that the value only
     * ever arrives from an already-validated request.
     *
     * @generated from field: string external_id = 1;
     */
    externalId: string;
    /**
     * @generated from field: google.protobuf.Struct traits = 2;
     */
    traits?: JsonObject | undefined;
    /**
     * @generated from field: string project_id = 3;
     */
    projectId: string;
    /**
     * @generated from field: string anonymous_id = 4;
     */
    anonymousId: string;
    /**
     * @generated from field: string device_id = 5;
     */
    deviceId: string;
};
/**
 * Describes the message sdk.profiles.v1.ProfileIdentifyMessage.
 * Use `create(ProfileIdentifyMessageSchema)` to create a new message.
 */
export declare const ProfileIdentifyMessageSchema: GenMessage<ProfileIdentifyMessage>;
/**
 * @generated from service sdk.profiles.v1.ProfilesSDKService
 */
export declare const ProfilesSDKService: GenService<{
    /**
     * Identify creates or updates a profile by external_id. When anonymous_id
     * is provided, the anonymous profile is merged into the identified one
     * (properties, devices) and then soft-deleted.
     *
     * @generated from rpc sdk.profiles.v1.ProfilesSDKService.Identify
     */
    identify: {
        methodKind: "unary";
        input: typeof IdentifyRequestSchema;
        output: typeof IdentifyResponseSchema;
    };
    /**
     * BatchIdentify publishes many identifies in one request for the identify
     * worker. Items for one external_id that only set traits may merge in order,
     * later values winning. It is not atomic: an error can follow a partial publish,
     * and a retry repeats what was already published. The worker applies separate
     * messages in no guaranteed order. An item that breaks a validation rule is
     * skipped and listed in invalid_identifies; the rest are still queued.
     *
     * @generated from rpc sdk.profiles.v1.ProfilesSDKService.BatchIdentify
     */
    batchIdentify: {
        methodKind: "unary";
        input: typeof BatchIdentifyRequestSchema;
        output: typeof BatchIdentifyResponseSchema;
    };
}>;
