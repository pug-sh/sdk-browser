import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/notification_events.proto.
 */
export declare const file_common_events_v1_notification_events: GenFile;
/**
 * @generated from message common.events.v1.NotificationReceivedProperties
 */
export type NotificationReceivedProperties = Message<"common.events.v1.NotificationReceivedProperties"> & {
    /**
     * @generated from field: string campaign_id = 1;
     */
    campaignId: string;
    /**
     * @generated from field: string notification_type = 2;
     */
    notificationType: string;
};
/**
 * Describes the message common.events.v1.NotificationReceivedProperties.
 * Use `create(NotificationReceivedPropertiesSchema)` to create a new message.
 */
export declare const NotificationReceivedPropertiesSchema: GenMessage<NotificationReceivedProperties>;
/**
 * @generated from message common.events.v1.NotificationClickedProperties
 */
export type NotificationClickedProperties = Message<"common.events.v1.NotificationClickedProperties"> & {
    /**
     * @generated from field: string campaign_id = 1;
     */
    campaignId: string;
    /**
     * @generated from field: string notification_type = 2;
     */
    notificationType: string;
};
/**
 * Describes the message common.events.v1.NotificationClickedProperties.
 * Use `create(NotificationClickedPropertiesSchema)` to create a new message.
 */
export declare const NotificationClickedPropertiesSchema: GenMessage<NotificationClickedProperties>;
/**
 * @generated from message common.events.v1.NotificationDismissedProperties
 */
export type NotificationDismissedProperties = Message<"common.events.v1.NotificationDismissedProperties"> & {
    /**
     * @generated from field: string campaign_id = 1;
     */
    campaignId: string;
    /**
     * @generated from field: string notification_type = 2;
     */
    notificationType: string;
};
/**
 * Describes the message common.events.v1.NotificationDismissedProperties.
 * Use `create(NotificationDismissedPropertiesSchema)` to create a new message.
 */
export declare const NotificationDismissedPropertiesSchema: GenMessage<NotificationDismissedProperties>;
