import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/workspace_events.proto.
 */
export declare const file_common_events_v1_workspace_events: GenFile;
/**
 * @generated from message common.events.v1.WorkspaceCreatedProperties
 */
export type WorkspaceCreatedProperties = Message<"common.events.v1.WorkspaceCreatedProperties"> & {
    /**
     * @generated from field: string workspace_id = 1;
     */
    workspaceId: string;
    /**
     * @generated from field: string workspace_name = 2;
     */
    workspaceName: string;
};
/**
 * Describes the message common.events.v1.WorkspaceCreatedProperties.
 * Use `create(WorkspaceCreatedPropertiesSchema)` to create a new message.
 */
export declare const WorkspaceCreatedPropertiesSchema: GenMessage<WorkspaceCreatedProperties>;
/**
 * @generated from message common.events.v1.WorkspaceJoinedProperties
 */
export type WorkspaceJoinedProperties = Message<"common.events.v1.WorkspaceJoinedProperties"> & {
    /**
     * @generated from field: string workspace_id = 1;
     */
    workspaceId: string;
    /**
     * @generated from field: string role = 2;
     */
    role: string;
};
/**
 * Describes the message common.events.v1.WorkspaceJoinedProperties.
 * Use `create(WorkspaceJoinedPropertiesSchema)` to create a new message.
 */
export declare const WorkspaceJoinedPropertiesSchema: GenMessage<WorkspaceJoinedProperties>;
/**
 * @generated from message common.events.v1.WorkspaceDeletedProperties
 */
export type WorkspaceDeletedProperties = Message<"common.events.v1.WorkspaceDeletedProperties"> & {
    /**
     * @generated from field: string workspace_id = 1;
     */
    workspaceId: string;
    /**
     * @generated from field: string reason = 2;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.WorkspaceDeletedProperties.
 * Use `create(WorkspaceDeletedPropertiesSchema)` to create a new message.
 */
export declare const WorkspaceDeletedPropertiesSchema: GenMessage<WorkspaceDeletedProperties>;
/**
 * @generated from message common.events.v1.WorkspaceRoleChangedProperties
 */
export type WorkspaceRoleChangedProperties = Message<"common.events.v1.WorkspaceRoleChangedProperties"> & {
    /**
     * @generated from field: string workspace_id = 1;
     */
    workspaceId: string;
    /**
     * @generated from field: string member_id = 2;
     */
    memberId: string;
    /**
     * @generated from field: string previous_role = 3;
     */
    previousRole: string;
    /**
     * @generated from field: string new_role = 4;
     */
    newRole: string;
};
/**
 * Describes the message common.events.v1.WorkspaceRoleChangedProperties.
 * Use `create(WorkspaceRoleChangedPropertiesSchema)` to create a new message.
 */
export declare const WorkspaceRoleChangedPropertiesSchema: GenMessage<WorkspaceRoleChangedProperties>;
/**
 * @generated from message common.events.v1.WorkspaceSettingsUpdatedProperties
 */
export type WorkspaceSettingsUpdatedProperties = Message<"common.events.v1.WorkspaceSettingsUpdatedProperties"> & {
    /**
     * @generated from field: string workspace_id = 1;
     */
    workspaceId: string;
    /**
     * @generated from field: string setting = 2;
     */
    setting: string;
};
/**
 * Describes the message common.events.v1.WorkspaceSettingsUpdatedProperties.
 * Use `create(WorkspaceSettingsUpdatedPropertiesSchema)` to create a new message.
 */
export declare const WorkspaceSettingsUpdatedPropertiesSchema: GenMessage<WorkspaceSettingsUpdatedProperties>;
