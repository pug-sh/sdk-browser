import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/integration_events.proto.
 */
export declare const file_common_events_v1_integration_events: GenFile;
/**
 * @generated from message common.events.v1.IntegrationConnectedProperties
 */
export type IntegrationConnectedProperties = Message<"common.events.v1.IntegrationConnectedProperties"> & {
    /**
     * @generated from field: string integration_id = 1;
     */
    integrationId: string;
    /**
     * @generated from field: string integration_type = 2;
     */
    integrationType: string;
};
/**
 * Describes the message common.events.v1.IntegrationConnectedProperties.
 * Use `create(IntegrationConnectedPropertiesSchema)` to create a new message.
 */
export declare const IntegrationConnectedPropertiesSchema: GenMessage<IntegrationConnectedProperties>;
/**
 * @generated from message common.events.v1.IntegrationDisconnectedProperties
 */
export type IntegrationDisconnectedProperties = Message<"common.events.v1.IntegrationDisconnectedProperties"> & {
    /**
     * @generated from field: string integration_id = 1;
     */
    integrationId: string;
    /**
     * @generated from field: string integration_type = 2;
     */
    integrationType: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.IntegrationDisconnectedProperties.
 * Use `create(IntegrationDisconnectedPropertiesSchema)` to create a new message.
 */
export declare const IntegrationDisconnectedPropertiesSchema: GenMessage<IntegrationDisconnectedProperties>;
