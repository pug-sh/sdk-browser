import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Duration } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/chat_events.proto.
 */
export declare const file_common_events_v1_chat_events: GenFile;
/**
 * @generated from message common.events.v1.ChatCreatedProperties
 */
export type ChatCreatedProperties = Message<"common.events.v1.ChatCreatedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
    /**
     * @generated from field: int32 participant_count = 3;
     */
    participantCount: number;
};
/**
 * Describes the message common.events.v1.ChatCreatedProperties.
 * Use `create(ChatCreatedPropertiesSchema)` to create a new message.
 */
export declare const ChatCreatedPropertiesSchema: GenMessage<ChatCreatedProperties>;
/**
 * @generated from message common.events.v1.ChatJoinedProperties
 */
export type ChatJoinedProperties = Message<"common.events.v1.ChatJoinedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
};
/**
 * Describes the message common.events.v1.ChatJoinedProperties.
 * Use `create(ChatJoinedPropertiesSchema)` to create a new message.
 */
export declare const ChatJoinedPropertiesSchema: GenMessage<ChatJoinedProperties>;
/**
 * @generated from message common.events.v1.ChatLeftProperties
 */
export type ChatLeftProperties = Message<"common.events.v1.ChatLeftProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.ChatLeftProperties.
 * Use `create(ChatLeftPropertiesSchema)` to create a new message.
 */
export declare const ChatLeftPropertiesSchema: GenMessage<ChatLeftProperties>;
/**
 * @generated from message common.events.v1.ChatDeletedProperties
 */
export type ChatDeletedProperties = Message<"common.events.v1.ChatDeletedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.ChatDeletedProperties.
 * Use `create(ChatDeletedPropertiesSchema)` to create a new message.
 */
export declare const ChatDeletedPropertiesSchema: GenMessage<ChatDeletedProperties>;
/**
 * @generated from message common.events.v1.ChatArchivedProperties
 */
export type ChatArchivedProperties = Message<"common.events.v1.ChatArchivedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
};
/**
 * Describes the message common.events.v1.ChatArchivedProperties.
 * Use `create(ChatArchivedPropertiesSchema)` to create a new message.
 */
export declare const ChatArchivedPropertiesSchema: GenMessage<ChatArchivedProperties>;
/**
 * @generated from message common.events.v1.ChatUnarchivedProperties
 */
export type ChatUnarchivedProperties = Message<"common.events.v1.ChatUnarchivedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
};
/**
 * Describes the message common.events.v1.ChatUnarchivedProperties.
 * Use `create(ChatUnarchivedPropertiesSchema)` to create a new message.
 */
export declare const ChatUnarchivedPropertiesSchema: GenMessage<ChatUnarchivedProperties>;
/**
 * @generated from message common.events.v1.ChatMemberAddedProperties
 */
export type ChatMemberAddedProperties = Message<"common.events.v1.ChatMemberAddedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string member_id = 2;
     */
    memberId: string;
    /**
     * @generated from field: string role = 3;
     */
    role: string;
};
/**
 * Describes the message common.events.v1.ChatMemberAddedProperties.
 * Use `create(ChatMemberAddedPropertiesSchema)` to create a new message.
 */
export declare const ChatMemberAddedPropertiesSchema: GenMessage<ChatMemberAddedProperties>;
/**
 * @generated from message common.events.v1.ChatMemberRemovedProperties
 */
export type ChatMemberRemovedProperties = Message<"common.events.v1.ChatMemberRemovedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string member_id = 2;
     */
    memberId: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.ChatMemberRemovedProperties.
 * Use `create(ChatMemberRemovedPropertiesSchema)` to create a new message.
 */
export declare const ChatMemberRemovedPropertiesSchema: GenMessage<ChatMemberRemovedProperties>;
/**
 * @generated from message common.events.v1.ChatMemberRoleChangedProperties
 */
export type ChatMemberRoleChangedProperties = Message<"common.events.v1.ChatMemberRoleChangedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
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
 * Describes the message common.events.v1.ChatMemberRoleChangedProperties.
 * Use `create(ChatMemberRoleChangedPropertiesSchema)` to create a new message.
 */
export declare const ChatMemberRoleChangedPropertiesSchema: GenMessage<ChatMemberRoleChangedProperties>;
/**
 * @generated from message common.events.v1.ChatMessageSentProperties
 */
export type ChatMessageSentProperties = Message<"common.events.v1.ChatMessageSentProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string message_type = 4;
     */
    messageType: string;
    /**
     * @generated from field: int32 character_count = 5;
     */
    characterCount: number;
    /**
     * @generated from field: int32 attachment_count = 6;
     */
    attachmentCount: number;
    /**
     * @generated from field: string thread_id = 7;
     */
    threadId: string;
    /**
     * @generated from field: string parent_message_id = 8;
     */
    parentMessageId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageSentProperties.
 * Use `create(ChatMessageSentPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageSentPropertiesSchema: GenMessage<ChatMessageSentProperties>;
/**
 * @generated from message common.events.v1.ChatMessageReceivedProperties
 */
export type ChatMessageReceivedProperties = Message<"common.events.v1.ChatMessageReceivedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string message_type = 4;
     */
    messageType: string;
    /**
     * @generated from field: int32 character_count = 5;
     */
    characterCount: number;
    /**
     * @generated from field: int32 attachment_count = 6;
     */
    attachmentCount: number;
    /**
     * @generated from field: string thread_id = 7;
     */
    threadId: string;
    /**
     * @generated from field: string parent_message_id = 8;
     */
    parentMessageId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageReceivedProperties.
 * Use `create(ChatMessageReceivedPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageReceivedPropertiesSchema: GenMessage<ChatMessageReceivedProperties>;
/**
 * @generated from message common.events.v1.ChatMessageFailedProperties
 */
export type ChatMessageFailedProperties = Message<"common.events.v1.ChatMessageFailedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string reason = 4;
     */
    reason: string;
    /**
     * @generated from field: string thread_id = 5;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageFailedProperties.
 * Use `create(ChatMessageFailedPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageFailedPropertiesSchema: GenMessage<ChatMessageFailedProperties>;
/**
 * @generated from message common.events.v1.ChatMessageReadProperties
 */
export type ChatMessageReadProperties = Message<"common.events.v1.ChatMessageReadProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string thread_id = 4;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageReadProperties.
 * Use `create(ChatMessageReadPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageReadPropertiesSchema: GenMessage<ChatMessageReadProperties>;
/**
 * @generated from message common.events.v1.ChatMessageDeletedProperties
 */
export type ChatMessageDeletedProperties = Message<"common.events.v1.ChatMessageDeletedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string reason = 4;
     */
    reason: string;
    /**
     * @generated from field: string thread_id = 5;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageDeletedProperties.
 * Use `create(ChatMessageDeletedPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageDeletedPropertiesSchema: GenMessage<ChatMessageDeletedProperties>;
/**
 * @generated from message common.events.v1.ChatMessageEditedProperties
 */
export type ChatMessageEditedProperties = Message<"common.events.v1.ChatMessageEditedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string thread_id = 4;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageEditedProperties.
 * Use `create(ChatMessageEditedPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageEditedPropertiesSchema: GenMessage<ChatMessageEditedProperties>;
/**
 * @generated from message common.events.v1.ChatMessagePinnedProperties
 */
export type ChatMessagePinnedProperties = Message<"common.events.v1.ChatMessagePinnedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string thread_id = 4;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatMessagePinnedProperties.
 * Use `create(ChatMessagePinnedPropertiesSchema)` to create a new message.
 */
export declare const ChatMessagePinnedPropertiesSchema: GenMessage<ChatMessagePinnedProperties>;
/**
 * @generated from message common.events.v1.ChatMessageUnpinnedProperties
 */
export type ChatMessageUnpinnedProperties = Message<"common.events.v1.ChatMessageUnpinnedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string conversation_type = 3;
     */
    conversationType: string;
    /**
     * @generated from field: string thread_id = 4;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatMessageUnpinnedProperties.
 * Use `create(ChatMessageUnpinnedPropertiesSchema)` to create a new message.
 */
export declare const ChatMessageUnpinnedPropertiesSchema: GenMessage<ChatMessageUnpinnedProperties>;
/**
 * @generated from message common.events.v1.ChatTypingStartedProperties
 */
export type ChatTypingStartedProperties = Message<"common.events.v1.ChatTypingStartedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
};
/**
 * Describes the message common.events.v1.ChatTypingStartedProperties.
 * Use `create(ChatTypingStartedPropertiesSchema)` to create a new message.
 */
export declare const ChatTypingStartedPropertiesSchema: GenMessage<ChatTypingStartedProperties>;
/**
 * @generated from message common.events.v1.ChatTypingStoppedProperties
 */
export type ChatTypingStoppedProperties = Message<"common.events.v1.ChatTypingStoppedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string conversation_type = 2;
     */
    conversationType: string;
};
/**
 * Describes the message common.events.v1.ChatTypingStoppedProperties.
 * Use `create(ChatTypingStoppedPropertiesSchema)` to create a new message.
 */
export declare const ChatTypingStoppedPropertiesSchema: GenMessage<ChatTypingStoppedProperties>;
/**
 * @generated from message common.events.v1.ChatAttachmentUploadedProperties
 */
export type ChatAttachmentUploadedProperties = Message<"common.events.v1.ChatAttachmentUploadedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string attachment_id = 3;
     */
    attachmentId: string;
    /**
     * @generated from field: string attachment_type = 4;
     */
    attachmentType: string;
    /**
     * @generated from field: int64 size_bytes = 5;
     */
    sizeBytes: bigint;
    /**
     * @generated from field: string thread_id = 6;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatAttachmentUploadedProperties.
 * Use `create(ChatAttachmentUploadedPropertiesSchema)` to create a new message.
 */
export declare const ChatAttachmentUploadedPropertiesSchema: GenMessage<ChatAttachmentUploadedProperties>;
/**
 * @generated from message common.events.v1.ChatAttachmentDownloadedProperties
 */
export type ChatAttachmentDownloadedProperties = Message<"common.events.v1.ChatAttachmentDownloadedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string attachment_id = 3;
     */
    attachmentId: string;
    /**
     * @generated from field: string attachment_type = 4;
     */
    attachmentType: string;
    /**
     * @generated from field: int64 size_bytes = 5;
     */
    sizeBytes: bigint;
    /**
     * @generated from field: string thread_id = 6;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatAttachmentDownloadedProperties.
 * Use `create(ChatAttachmentDownloadedPropertiesSchema)` to create a new message.
 */
export declare const ChatAttachmentDownloadedPropertiesSchema: GenMessage<ChatAttachmentDownloadedProperties>;
/**
 * @generated from message common.events.v1.ChatCallStartedProperties
 */
export type ChatCallStartedProperties = Message<"common.events.v1.ChatCallStartedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string call_id = 2;
     */
    callId: string;
    /**
     * @generated from field: string call_type = 3;
     */
    callType: string;
};
/**
 * Describes the message common.events.v1.ChatCallStartedProperties.
 * Use `create(ChatCallStartedPropertiesSchema)` to create a new message.
 */
export declare const ChatCallStartedPropertiesSchema: GenMessage<ChatCallStartedProperties>;
/**
 * @generated from message common.events.v1.ChatCallJoinedProperties
 */
export type ChatCallJoinedProperties = Message<"common.events.v1.ChatCallJoinedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string call_id = 2;
     */
    callId: string;
    /**
     * @generated from field: string call_type = 3;
     */
    callType: string;
};
/**
 * Describes the message common.events.v1.ChatCallJoinedProperties.
 * Use `create(ChatCallJoinedPropertiesSchema)` to create a new message.
 */
export declare const ChatCallJoinedPropertiesSchema: GenMessage<ChatCallJoinedProperties>;
/**
 * @generated from message common.events.v1.ChatCallLeftProperties
 */
export type ChatCallLeftProperties = Message<"common.events.v1.ChatCallLeftProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string call_id = 2;
     */
    callId: string;
    /**
     * @generated from field: string call_type = 3;
     */
    callType: string;
    /**
     * @generated from field: google.protobuf.Duration duration = 4;
     */
    duration?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.ChatCallLeftProperties.
 * Use `create(ChatCallLeftPropertiesSchema)` to create a new message.
 */
export declare const ChatCallLeftPropertiesSchema: GenMessage<ChatCallLeftProperties>;
/**
 * @generated from message common.events.v1.ChatCallScreenSharedProperties
 */
export type ChatCallScreenSharedProperties = Message<"common.events.v1.ChatCallScreenSharedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string call_id = 2;
     */
    callId: string;
};
/**
 * Describes the message common.events.v1.ChatCallScreenSharedProperties.
 * Use `create(ChatCallScreenSharedPropertiesSchema)` to create a new message.
 */
export declare const ChatCallScreenSharedPropertiesSchema: GenMessage<ChatCallScreenSharedProperties>;
/**
 * @generated from message common.events.v1.ChatCallRecordingStartedProperties
 */
export type ChatCallRecordingStartedProperties = Message<"common.events.v1.ChatCallRecordingStartedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string call_id = 2;
     */
    callId: string;
};
/**
 * Describes the message common.events.v1.ChatCallRecordingStartedProperties.
 * Use `create(ChatCallRecordingStartedPropertiesSchema)` to create a new message.
 */
export declare const ChatCallRecordingStartedPropertiesSchema: GenMessage<ChatCallRecordingStartedProperties>;
/**
 * mute_duration is optional — populate when the mute is time-bounded
 * (e.g. "mute for 1h"); leave unset for indefinite mutes.
 *
 * @generated from message common.events.v1.ChatMemberMutedProperties
 */
export type ChatMemberMutedProperties = Message<"common.events.v1.ChatMemberMutedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string member_id = 2;
     */
    memberId: string;
    /**
     * @generated from field: google.protobuf.Duration mute_duration = 3;
     */
    muteDuration?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.ChatMemberMutedProperties.
 * Use `create(ChatMemberMutedPropertiesSchema)` to create a new message.
 */
export declare const ChatMemberMutedPropertiesSchema: GenMessage<ChatMemberMutedProperties>;
/**
 * User-level block (not conversation-scoped), so no conversation_id.
 *
 * @generated from message common.events.v1.ChatUserBlockedProperties
 */
export type ChatUserBlockedProperties = Message<"common.events.v1.ChatUserBlockedProperties"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
};
/**
 * Describes the message common.events.v1.ChatUserBlockedProperties.
 * Use `create(ChatUserBlockedPropertiesSchema)` to create a new message.
 */
export declare const ChatUserBlockedPropertiesSchema: GenMessage<ChatUserBlockedProperties>;
/**
 * `reaction` is the literal reaction value (emoji, shortcode, sticker id),
 * not a category. Compare reaction_type if a future schema needs to
 * distinguish emoji from sticker from gif reactions.
 *
 * @generated from message common.events.v1.ChatReactionAddedProperties
 */
export type ChatReactionAddedProperties = Message<"common.events.v1.ChatReactionAddedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string reaction = 3;
     */
    reaction: string;
    /**
     * @generated from field: string thread_id = 4;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatReactionAddedProperties.
 * Use `create(ChatReactionAddedPropertiesSchema)` to create a new message.
 */
export declare const ChatReactionAddedPropertiesSchema: GenMessage<ChatReactionAddedProperties>;
/**
 * `reaction` is the literal reaction value (emoji, shortcode, sticker id),
 * not a category.
 *
 * @generated from message common.events.v1.ChatReactionRemovedProperties
 */
export type ChatReactionRemovedProperties = Message<"common.events.v1.ChatReactionRemovedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string message_id = 2;
     */
    messageId: string;
    /**
     * @generated from field: string reaction = 3;
     */
    reaction: string;
    /**
     * @generated from field: string thread_id = 4;
     */
    threadId: string;
};
/**
 * Describes the message common.events.v1.ChatReactionRemovedProperties.
 * Use `create(ChatReactionRemovedPropertiesSchema)` to create a new message.
 */
export declare const ChatReactionRemovedPropertiesSchema: GenMessage<ChatReactionRemovedProperties>;
