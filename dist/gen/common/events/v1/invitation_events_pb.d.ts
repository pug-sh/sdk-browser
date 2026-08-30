import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/invitation_events.proto.
 */
export declare const file_common_events_v1_invitation_events: GenFile;
/**
 * @generated from message common.events.v1.InviteSentProperties
 */
export type InviteSentProperties = Message<"common.events.v1.InviteSentProperties"> & {
    /**
     * @generated from field: string invite_id = 1;
     */
    inviteId: string;
    /**
     * @generated from field: string workspace_id = 2;
     */
    workspaceId: string;
    /**
     * @generated from field: string inviter_id = 3;
     */
    inviterId: string;
    /**
     * @generated from field: string invitee_id = 4;
     */
    inviteeId: string;
    /**
     * @generated from field: string invitee_email = 5;
     */
    inviteeEmail: string;
    /**
     * @generated from field: string role = 6;
     */
    role: string;
};
/**
 * Describes the message common.events.v1.InviteSentProperties.
 * Use `create(InviteSentPropertiesSchema)` to create a new message.
 */
export declare const InviteSentPropertiesSchema: GenMessage<InviteSentProperties>;
/**
 * @generated from message common.events.v1.InviteAcceptedProperties
 */
export type InviteAcceptedProperties = Message<"common.events.v1.InviteAcceptedProperties"> & {
    /**
     * @generated from field: string invite_id = 1;
     */
    inviteId: string;
    /**
     * @generated from field: string workspace_id = 2;
     */
    workspaceId: string;
    /**
     * @generated from field: string inviter_id = 3;
     */
    inviterId: string;
    /**
     * @generated from field: string invitee_id = 4;
     */
    inviteeId: string;
    /**
     * @generated from field: string invitee_email = 5;
     */
    inviteeEmail: string;
    /**
     * @generated from field: string role = 6;
     */
    role: string;
};
/**
 * Describes the message common.events.v1.InviteAcceptedProperties.
 * Use `create(InviteAcceptedPropertiesSchema)` to create a new message.
 */
export declare const InviteAcceptedPropertiesSchema: GenMessage<InviteAcceptedProperties>;
