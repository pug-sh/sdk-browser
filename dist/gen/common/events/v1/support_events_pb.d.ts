import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/support_events.proto.
 */
export declare const file_common_events_v1_support_events: GenFile;
/**
 * @generated from message common.events.v1.FeedbackSubmittedProperties
 */
export type FeedbackSubmittedProperties = Message<"common.events.v1.FeedbackSubmittedProperties"> & {
    /**
     * @generated from field: string feedback_id = 1;
     */
    feedbackId: string;
    /**
     * @generated from field: string category = 2;
     */
    category: string;
    /**
     * @generated from field: string comment = 3;
     */
    comment: string;
};
/**
 * Describes the message common.events.v1.FeedbackSubmittedProperties.
 * Use `create(FeedbackSubmittedPropertiesSchema)` to create a new message.
 */
export declare const FeedbackSubmittedPropertiesSchema: GenMessage<FeedbackSubmittedProperties>;
/**
 * @generated from message common.events.v1.NpsSubmittedProperties
 */
export type NpsSubmittedProperties = Message<"common.events.v1.NpsSubmittedProperties"> & {
    /**
     * @generated from field: int32 score = 1;
     */
    score: number;
    /**
     * @generated from field: string comment = 2;
     */
    comment: string;
};
/**
 * Describes the message common.events.v1.NpsSubmittedProperties.
 * Use `create(NpsSubmittedPropertiesSchema)` to create a new message.
 */
export declare const NpsSubmittedPropertiesSchema: GenMessage<NpsSubmittedProperties>;
/**
 * @generated from message common.events.v1.SurveyStartedProperties
 */
export type SurveyStartedProperties = Message<"common.events.v1.SurveyStartedProperties"> & {
    /**
     * @generated from field: string survey_id = 1;
     */
    surveyId: string;
};
/**
 * Describes the message common.events.v1.SurveyStartedProperties.
 * Use `create(SurveyStartedPropertiesSchema)` to create a new message.
 */
export declare const SurveyStartedPropertiesSchema: GenMessage<SurveyStartedProperties>;
/**
 * @generated from message common.events.v1.SurveyCompletedProperties
 */
export type SurveyCompletedProperties = Message<"common.events.v1.SurveyCompletedProperties"> & {
    /**
     * @generated from field: string survey_id = 1;
     */
    surveyId: string;
    /**
     * @generated from field: int32 question_count = 2;
     */
    questionCount: number;
};
/**
 * Describes the message common.events.v1.SurveyCompletedProperties.
 * Use `create(SurveyCompletedPropertiesSchema)` to create a new message.
 */
export declare const SurveyCompletedPropertiesSchema: GenMessage<SurveyCompletedProperties>;
/**
 * @generated from message common.events.v1.SupportTicketCreatedProperties
 */
export type SupportTicketCreatedProperties = Message<"common.events.v1.SupportTicketCreatedProperties"> & {
    /**
     * @generated from field: string ticket_id = 1;
     */
    ticketId: string;
    /**
     * @generated from field: string category = 2;
     */
    category: string;
    /**
     * @generated from field: string priority = 3;
     */
    priority: string;
};
/**
 * Describes the message common.events.v1.SupportTicketCreatedProperties.
 * Use `create(SupportTicketCreatedPropertiesSchema)` to create a new message.
 */
export declare const SupportTicketCreatedPropertiesSchema: GenMessage<SupportTicketCreatedProperties>;
/**
 * @generated from message common.events.v1.SupportTicketResolvedProperties
 */
export type SupportTicketResolvedProperties = Message<"common.events.v1.SupportTicketResolvedProperties"> & {
    /**
     * @generated from field: string ticket_id = 1;
     */
    ticketId: string;
    /**
     * @generated from field: string resolution = 2;
     */
    resolution: string;
};
/**
 * Describes the message common.events.v1.SupportTicketResolvedProperties.
 * Use `create(SupportTicketResolvedPropertiesSchema)` to create a new message.
 */
export declare const SupportTicketResolvedPropertiesSchema: GenMessage<SupportTicketResolvedProperties>;
/**
 * @generated from message common.events.v1.SupportChatStartedProperties
 */
export type SupportChatStartedProperties = Message<"common.events.v1.SupportChatStartedProperties"> & {
    /**
     * @generated from field: string conversation_id = 1;
     */
    conversationId: string;
    /**
     * @generated from field: string topic = 2;
     */
    topic: string;
};
/**
 * Describes the message common.events.v1.SupportChatStartedProperties.
 * Use `create(SupportChatStartedPropertiesSchema)` to create a new message.
 */
export declare const SupportChatStartedPropertiesSchema: GenMessage<SupportChatStartedProperties>;
/**
 * @generated from message common.events.v1.HelpArticleViewedProperties
 */
export type HelpArticleViewedProperties = Message<"common.events.v1.HelpArticleViewedProperties"> & {
    /**
     * @generated from field: string article_id = 1;
     */
    articleId: string;
    /**
     * @generated from field: string article_title = 2;
     */
    articleTitle: string;
    /**
     * @generated from field: string category = 3;
     */
    category: string;
};
/**
 * Describes the message common.events.v1.HelpArticleViewedProperties.
 * Use `create(HelpArticleViewedPropertiesSchema)` to create a new message.
 */
export declare const HelpArticleViewedPropertiesSchema: GenMessage<HelpArticleViewedProperties>;
