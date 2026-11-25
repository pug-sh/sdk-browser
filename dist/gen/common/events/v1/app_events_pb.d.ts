import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/app_events.proto.
 */
export declare const file_common_events_v1_app_events: GenFile;
/**
 * @generated from message common.events.v1.AppOpenProperties
 */
export type AppOpenProperties = Message<"common.events.v1.AppOpenProperties"> & {};
/**
 * Describes the message common.events.v1.AppOpenProperties.
 * Use `create(AppOpenPropertiesSchema)` to create a new message.
 */
export declare const AppOpenPropertiesSchema: GenMessage<AppOpenProperties>;
/**
 * @generated from message common.events.v1.AppCloseProperties
 */
export type AppCloseProperties = Message<"common.events.v1.AppCloseProperties"> & {};
/**
 * Describes the message common.events.v1.AppCloseProperties.
 * Use `create(AppClosePropertiesSchema)` to create a new message.
 */
export declare const AppClosePropertiesSchema: GenMessage<AppCloseProperties>;
/**
 * First-launch / fresh-install signal. Typically fires once per install.
 *
 * @generated from message common.events.v1.AppInstallProperties
 */
export type AppInstallProperties = Message<"common.events.v1.AppInstallProperties"> & {
    /**
     * @generated from field: string app_version = 1;
     */
    appVersion: string;
    /**
     * @generated from field: string install_source = 2;
     */
    installSource: string;
};
/**
 * Describes the message common.events.v1.AppInstallProperties.
 * Use `create(AppInstallPropertiesSchema)` to create a new message.
 */
export declare const AppInstallPropertiesSchema: GenMessage<AppInstallProperties>;
/**
 * Fires the first time the app launches after an update.
 *
 * @generated from message common.events.v1.AppUpdateProperties
 */
export type AppUpdateProperties = Message<"common.events.v1.AppUpdateProperties"> & {
    /**
     * @generated from field: string app_version = 1;
     */
    appVersion: string;
    /**
     * @generated from field: string previous_version = 2;
     */
    previousVersion: string;
};
/**
 * Describes the message common.events.v1.AppUpdateProperties.
 * Use `create(AppUpdatePropertiesSchema)` to create a new message.
 */
export declare const AppUpdatePropertiesSchema: GenMessage<AppUpdateProperties>;
/**
 * App moved to the background (lifecycle distinct from app_close).
 *
 * @generated from message common.events.v1.AppBackgroundedProperties
 */
export type AppBackgroundedProperties = Message<"common.events.v1.AppBackgroundedProperties"> & {};
/**
 * Describes the message common.events.v1.AppBackgroundedProperties.
 * Use `create(AppBackgroundedPropertiesSchema)` to create a new message.
 */
export declare const AppBackgroundedPropertiesSchema: GenMessage<AppBackgroundedProperties>;
/**
 * App returned to the foreground from the background.
 *
 * @generated from message common.events.v1.AppForegroundedProperties
 */
export type AppForegroundedProperties = Message<"common.events.v1.AppForegroundedProperties"> & {};
/**
 * Describes the message common.events.v1.AppForegroundedProperties.
 * Use `create(AppForegroundedPropertiesSchema)` to create a new message.
 */
export declare const AppForegroundedPropertiesSchema: GenMessage<AppForegroundedProperties>;
/**
 * @generated from message common.events.v1.AppCrashedProperties
 */
export type AppCrashedProperties = Message<"common.events.v1.AppCrashedProperties"> & {
    /**
     * @generated from field: string error_message = 1;
     */
    errorMessage: string;
    /**
     * @generated from field: string error_type = 2;
     */
    errorType: string;
};
/**
 * Describes the message common.events.v1.AppCrashedProperties.
 * Use `create(AppCrashedPropertiesSchema)` to create a new message.
 */
export declare const AppCrashedPropertiesSchema: GenMessage<AppCrashedProperties>;
/**
 * @generated from message common.events.v1.FeatureUsedProperties
 */
export type FeatureUsedProperties = Message<"common.events.v1.FeatureUsedProperties"> & {
    /**
     * @generated from field: string feature_id = 1;
     */
    featureId: string;
    /**
     * @generated from field: string feature_name = 2;
     */
    featureName: string;
};
/**
 * Describes the message common.events.v1.FeatureUsedProperties.
 * Use `create(FeatureUsedPropertiesSchema)` to create a new message.
 */
export declare const FeatureUsedPropertiesSchema: GenMessage<FeatureUsedProperties>;
