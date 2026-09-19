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
     * Stable user identifier (e.g. email, database ID).
     * The 'cookieless-' prefix is server-owned: ingest mints those ids and the
     * reserved-prefix rule on BatchCreateRequest.distinct_id already refuses them
     * from clients. external_id needs the same guard because post-identify events
     * are keyed by external_id, so an id accepted here comes back as a distinct_id
     * that the batch rule then rejects — and because that rule is `all()`, one such
     * user fails the WHOLE batch, taking unrelated users' events with it.
     *
     * @generated from field: string external_id = 1;
     */
    externalId: string;
    /**
     * Profile properties — shallow-merged into existing properties. On key conflict,
     * these values take precedence over previously stored values.
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
     * identify and on account switch (external_id changed) — not on every call,
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
 * ProfileIdentifyMessage is the internal NATS envelope for the identify worker.
 * project_id is injected server-side from the authenticated principal.
 *
 * @generated from message sdk.profiles.v1.ProfileIdentifyMessage
 */
export type ProfileIdentifyMessage = Message<"sdk.profiles.v1.ProfileIdentifyMessage"> & {
    /**
     * Mirrors IdentifyRequest.external_id: the worker re-validates this envelope,
     * so the reserved prefix is enforced at both stages rather than trusting that
     * the value only ever arrives from an already-validated request.
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
}>;
