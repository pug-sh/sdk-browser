import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file sdk/devices/v1/devices.proto.
 */
export declare const file_sdk_devices_v1_devices: GenFile;
/**
 * @generated from message sdk.devices.v1.SubscribeRequest
 */
export type SubscribeRequest = Message<"sdk.devices.v1.SubscribeRequest"> & {
    /**
     * @generated from field: string device_id = 1;
     */
    deviceId: string;
    /**
     * @generated from field: string platform = 2;
     */
    platform: string;
    /**
     * Optional — when provided, links the device to a profile.
     *
     * @generated from field: string profile_external_id = 3;
     */
    profileExternalId: string;
    /**
     * Optional — alternative to profile_external_id for linking.
     *
     * @generated from field: string profile_id = 4;
     */
    profileId: string;
    /**
     * @generated from field: string token = 5;
     */
    token: string;
    /**
     * @generated from field: google.protobuf.Struct properties = 6;
     */
    properties?: JsonObject | undefined;
};
/**
 * Describes the message sdk.devices.v1.SubscribeRequest.
 * Use `create(SubscribeRequestSchema)` to create a new message.
 */
export declare const SubscribeRequestSchema: GenMessage<SubscribeRequest>;
/**
 * @generated from message sdk.devices.v1.SubscribeResponse
 */
export type SubscribeResponse = Message<"sdk.devices.v1.SubscribeResponse"> & {};
/**
 * Describes the message sdk.devices.v1.SubscribeResponse.
 * Use `create(SubscribeResponseSchema)` to create a new message.
 */
export declare const SubscribeResponseSchema: GenMessage<SubscribeResponse>;
/**
 * @generated from message sdk.devices.v1.UpdateStatusRequest
 */
export type UpdateStatusRequest = Message<"sdk.devices.v1.UpdateStatusRequest"> & {
    /**
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * @generated from field: string status = 2;
     */
    status: string;
};
/**
 * Describes the message sdk.devices.v1.UpdateStatusRequest.
 * Use `create(UpdateStatusRequestSchema)` to create a new message.
 */
export declare const UpdateStatusRequestSchema: GenMessage<UpdateStatusRequest>;
/**
 * @generated from message sdk.devices.v1.UpdateStatusResponse
 */
export type UpdateStatusResponse = Message<"sdk.devices.v1.UpdateStatusResponse"> & {};
/**
 * Describes the message sdk.devices.v1.UpdateStatusResponse.
 * Use `create(UpdateStatusResponseSchema)` to create a new message.
 */
export declare const UpdateStatusResponseSchema: GenMessage<UpdateStatusResponse>;
/**
 * @generated from message sdk.devices.v1.UpdateTokenRequest
 */
export type UpdateTokenRequest = Message<"sdk.devices.v1.UpdateTokenRequest"> & {
    /**
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * @generated from field: string token = 2;
     */
    token: string;
};
/**
 * Describes the message sdk.devices.v1.UpdateTokenRequest.
 * Use `create(UpdateTokenRequestSchema)` to create a new message.
 */
export declare const UpdateTokenRequestSchema: GenMessage<UpdateTokenRequest>;
/**
 * @generated from message sdk.devices.v1.UpdateTokenResponse
 */
export type UpdateTokenResponse = Message<"sdk.devices.v1.UpdateTokenResponse"> & {};
/**
 * Describes the message sdk.devices.v1.UpdateTokenResponse.
 * Use `create(UpdateTokenResponseSchema)` to create a new message.
 */
export declare const UpdateTokenResponseSchema: GenMessage<UpdateTokenResponse>;
/**
 * @generated from message sdk.devices.v1.DeviceOperationMessage
 */
export type DeviceOperationMessage = Message<"sdk.devices.v1.DeviceOperationMessage"> & {
    /**
     * @generated from field: string device_id = 1;
     */
    deviceId: string;
    /**
     * @generated from field: string project_id = 2;
     */
    projectId: string;
    /**
     * @generated from oneof sdk.devices.v1.DeviceOperationMessage.operation_payload
     */
    operationPayload: {
        /**
         * @generated from field: sdk.devices.v1.SubscribePayload subscribe = 10;
         */
        value: SubscribePayload;
        case: "subscribe";
    } | {
        /**
         * @generated from field: sdk.devices.v1.UpdateStatusPayload update_status = 11;
         */
        value: UpdateStatusPayload;
        case: "updateStatus";
    } | {
        /**
         * @generated from field: sdk.devices.v1.UpdateTokenPayload update_token = 12;
         */
        value: UpdateTokenPayload;
        case: "updateToken";
    } | {
        case: undefined;
        value?: undefined;
    };
};
/**
 * Describes the message sdk.devices.v1.DeviceOperationMessage.
 * Use `create(DeviceOperationMessageSchema)` to create a new message.
 */
export declare const DeviceOperationMessageSchema: GenMessage<DeviceOperationMessage>;
/**
 * @generated from message sdk.devices.v1.SubscribePayload
 */
export type SubscribePayload = Message<"sdk.devices.v1.SubscribePayload"> & {
    /**
     * @generated from field: string platform = 1;
     */
    platform: string;
    /**
     * @generated from field: string profile_external_id = 2;
     */
    profileExternalId: string;
    /**
     * @generated from field: string profile_id = 3;
     */
    profileId: string;
    /**
     * @generated from field: string token = 4;
     */
    token: string;
    /**
     * @generated from field: google.protobuf.Struct properties = 5;
     */
    properties?: JsonObject | undefined;
};
/**
 * Describes the message sdk.devices.v1.SubscribePayload.
 * Use `create(SubscribePayloadSchema)` to create a new message.
 */
export declare const SubscribePayloadSchema: GenMessage<SubscribePayload>;
/**
 * @generated from message sdk.devices.v1.UpdateStatusPayload
 */
export type UpdateStatusPayload = Message<"sdk.devices.v1.UpdateStatusPayload"> & {
    /**
     * @generated from field: string status = 1;
     */
    status: string;
};
/**
 * Describes the message sdk.devices.v1.UpdateStatusPayload.
 * Use `create(UpdateStatusPayloadSchema)` to create a new message.
 */
export declare const UpdateStatusPayloadSchema: GenMessage<UpdateStatusPayload>;
/**
 * @generated from message sdk.devices.v1.UpdateTokenPayload
 */
export type UpdateTokenPayload = Message<"sdk.devices.v1.UpdateTokenPayload"> & {
    /**
     * @generated from field: string token = 1;
     */
    token: string;
};
/**
 * Describes the message sdk.devices.v1.UpdateTokenPayload.
 * Use `create(UpdateTokenPayloadSchema)` to create a new message.
 */
export declare const UpdateTokenPayloadSchema: GenMessage<UpdateTokenPayload>;
/**
 * @generated from service sdk.devices.v1.DevicesService
 */
export declare const DevicesService: GenService<{
    /**
     * @generated from rpc sdk.devices.v1.DevicesService.Subscribe
     */
    subscribe: {
        methodKind: "unary";
        input: typeof SubscribeRequestSchema;
        output: typeof SubscribeResponseSchema;
    };
    /**
     * @generated from rpc sdk.devices.v1.DevicesService.UpdateStatus
     */
    updateStatus: {
        methodKind: "unary";
        input: typeof UpdateStatusRequestSchema;
        output: typeof UpdateStatusResponseSchema;
    };
    /**
     * @generated from rpc sdk.devices.v1.DevicesService.UpdateToken
     */
    updateToken: {
        methodKind: "unary";
        input: typeof UpdateTokenRequestSchema;
        output: typeof UpdateTokenResponseSchema;
    };
}>;
