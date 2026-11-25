import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/api_events.proto.
 */
export declare const file_common_events_v1_api_events: GenFile;
/**
 * @generated from message common.events.v1.ApiKeyCreatedProperties
 */
export type ApiKeyCreatedProperties = Message<"common.events.v1.ApiKeyCreatedProperties"> & {
    /**
     * @generated from field: string api_key_id = 1;
     */
    apiKeyId: string;
    /**
     * @generated from field: string name = 2;
     */
    name: string;
    /**
     * @generated from field: string scope = 3;
     */
    scope: string;
};
/**
 * Describes the message common.events.v1.ApiKeyCreatedProperties.
 * Use `create(ApiKeyCreatedPropertiesSchema)` to create a new message.
 */
export declare const ApiKeyCreatedPropertiesSchema: GenMessage<ApiKeyCreatedProperties>;
/**
 * @generated from message common.events.v1.ApiKeyRevokedProperties
 */
export type ApiKeyRevokedProperties = Message<"common.events.v1.ApiKeyRevokedProperties"> & {
    /**
     * @generated from field: string api_key_id = 1;
     */
    apiKeyId: string;
    /**
     * @generated from field: string name = 2;
     */
    name: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.ApiKeyRevokedProperties.
 * Use `create(ApiKeyRevokedPropertiesSchema)` to create a new message.
 */
export declare const ApiKeyRevokedPropertiesSchema: GenMessage<ApiKeyRevokedProperties>;
