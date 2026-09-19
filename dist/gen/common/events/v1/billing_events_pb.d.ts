import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/billing_events.proto.
 */
export declare const file_common_events_v1_billing_events: GenFile;
/**
 * @generated from message common.events.v1.SubscriptionStartedProperties
 */
export type SubscriptionStartedProperties = Message<"common.events.v1.SubscriptionStartedProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
    /**
     * @generated from field: double amount = 3;
     */
    amount: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.SubscriptionStartedProperties.
 * Use `create(SubscriptionStartedPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionStartedPropertiesSchema: GenMessage<SubscriptionStartedProperties>;
/**
 * @generated from message common.events.v1.SubscriptionChangedProperties
 */
export type SubscriptionChangedProperties = Message<"common.events.v1.SubscriptionChangedProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string previous_plan_id = 2;
     */
    previousPlanId: string;
    /**
     * @generated from field: string new_plan_id = 3;
     */
    newPlanId: string;
};
/**
 * Describes the message common.events.v1.SubscriptionChangedProperties.
 * Use `create(SubscriptionChangedPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionChangedPropertiesSchema: GenMessage<SubscriptionChangedProperties>;
/**
 * @generated from message common.events.v1.SubscriptionCanceledProperties
 */
export type SubscriptionCanceledProperties = Message<"common.events.v1.SubscriptionCanceledProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.SubscriptionCanceledProperties.
 * Use `create(SubscriptionCanceledPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionCanceledPropertiesSchema: GenMessage<SubscriptionCanceledProperties>;
/**
 * @generated from message common.events.v1.SubscriptionRenewedProperties
 */
export type SubscriptionRenewedProperties = Message<"common.events.v1.SubscriptionRenewedProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
    /**
     * @generated from field: double amount = 3;
     */
    amount: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.SubscriptionRenewedProperties.
 * Use `create(SubscriptionRenewedPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionRenewedPropertiesSchema: GenMessage<SubscriptionRenewedProperties>;
/**
 * @generated from message common.events.v1.SubscriptionPausedProperties
 */
export type SubscriptionPausedProperties = Message<"common.events.v1.SubscriptionPausedProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.SubscriptionPausedProperties.
 * Use `create(SubscriptionPausedPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionPausedPropertiesSchema: GenMessage<SubscriptionPausedProperties>;
/**
 * @generated from message common.events.v1.SubscriptionResumedProperties
 */
export type SubscriptionResumedProperties = Message<"common.events.v1.SubscriptionResumedProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
    /**
     * @generated from field: string reason = 3;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.SubscriptionResumedProperties.
 * Use `create(SubscriptionResumedPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionResumedPropertiesSchema: GenMessage<SubscriptionResumedProperties>;
/**
 * Fired in advance of a trial converting (e.g. 3 days before). Useful for
 * upsell / conversion campaigns.
 *
 * @generated from message common.events.v1.SubscriptionTrialWillEndProperties
 */
export type SubscriptionTrialWillEndProperties = Message<"common.events.v1.SubscriptionTrialWillEndProperties"> & {
    /**
     * @generated from field: string subscription_id = 1;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
    /**
     * @generated from field: string trial_id = 3;
     */
    trialId: string;
};
/**
 * Describes the message common.events.v1.SubscriptionTrialWillEndProperties.
 * Use `create(SubscriptionTrialWillEndPropertiesSchema)` to create a new message.
 */
export declare const SubscriptionTrialWillEndPropertiesSchema: GenMessage<SubscriptionTrialWillEndProperties>;
/**
 * @generated from message common.events.v1.InvoicePaidProperties
 */
export type InvoicePaidProperties = Message<"common.events.v1.InvoicePaidProperties"> & {
    /**
     * @generated from field: string invoice_id = 1;
     */
    invoiceId: string;
    /**
     * @generated from field: string subscription_id = 2;
     */
    subscriptionId: string;
    /**
     * @generated from field: double amount = 3;
     */
    amount: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.InvoicePaidProperties.
 * Use `create(InvoicePaidPropertiesSchema)` to create a new message.
 */
export declare const InvoicePaidPropertiesSchema: GenMessage<InvoicePaidProperties>;
/**
 * @generated from message common.events.v1.InvoiceFailedProperties
 */
export type InvoiceFailedProperties = Message<"common.events.v1.InvoiceFailedProperties"> & {
    /**
     * @generated from field: string invoice_id = 1;
     */
    invoiceId: string;
    /**
     * @generated from field: string subscription_id = 2;
     */
    subscriptionId: string;
    /**
     * @generated from field: double amount = 3;
     */
    amount: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
    /**
     * @generated from field: string reason = 5;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.InvoiceFailedProperties.
 * Use `create(InvoiceFailedPropertiesSchema)` to create a new message.
 */
export declare const InvoiceFailedPropertiesSchema: GenMessage<InvoiceFailedProperties>;
/**
 * @generated from message common.events.v1.PaymentSucceededProperties
 */
export type PaymentSucceededProperties = Message<"common.events.v1.PaymentSucceededProperties"> & {
    /**
     * @generated from field: string payment_id = 1;
     */
    paymentId: string;
    /**
     * @generated from field: string invoice_id = 2;
     */
    invoiceId: string;
    /**
     * @generated from field: string subscription_id = 3;
     */
    subscriptionId: string;
    /**
     * @generated from field: double amount = 4;
     */
    amount: number;
    /**
     * @generated from field: string currency = 5;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.PaymentSucceededProperties.
 * Use `create(PaymentSucceededPropertiesSchema)` to create a new message.
 */
export declare const PaymentSucceededPropertiesSchema: GenMessage<PaymentSucceededProperties>;
/**
 * @generated from message common.events.v1.PaymentFailedProperties
 */
export type PaymentFailedProperties = Message<"common.events.v1.PaymentFailedProperties"> & {
    /**
     * @generated from field: string payment_id = 1;
     */
    paymentId: string;
    /**
     * @generated from field: string invoice_id = 2;
     */
    invoiceId: string;
    /**
     * @generated from field: string subscription_id = 3;
     */
    subscriptionId: string;
    /**
     * @generated from field: double amount = 4;
     */
    amount: number;
    /**
     * @generated from field: string currency = 5;
     */
    currency: string;
    /**
     * @generated from field: string reason = 6;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.PaymentFailedProperties.
 * Use `create(PaymentFailedPropertiesSchema)` to create a new message.
 */
export declare const PaymentFailedPropertiesSchema: GenMessage<PaymentFailedProperties>;
/**
 * @generated from message common.events.v1.PaymentMethodAddedProperties
 */
export type PaymentMethodAddedProperties = Message<"common.events.v1.PaymentMethodAddedProperties"> & {
    /**
     * @generated from field: string payment_method_id = 1;
     */
    paymentMethodId: string;
    /**
     * @generated from field: string payment_method_type = 2;
     */
    paymentMethodType: string;
};
/**
 * Describes the message common.events.v1.PaymentMethodAddedProperties.
 * Use `create(PaymentMethodAddedPropertiesSchema)` to create a new message.
 */
export declare const PaymentMethodAddedPropertiesSchema: GenMessage<PaymentMethodAddedProperties>;
/**
 * @generated from message common.events.v1.PaymentMethodRemovedProperties
 */
export type PaymentMethodRemovedProperties = Message<"common.events.v1.PaymentMethodRemovedProperties"> & {
    /**
     * @generated from field: string payment_method_id = 1;
     */
    paymentMethodId: string;
    /**
     * @generated from field: string payment_method_type = 2;
     */
    paymentMethodType: string;
};
/**
 * Describes the message common.events.v1.PaymentMethodRemovedProperties.
 * Use `create(PaymentMethodRemovedPropertiesSchema)` to create a new message.
 */
export declare const PaymentMethodRemovedPropertiesSchema: GenMessage<PaymentMethodRemovedProperties>;
/**
 * @generated from message common.events.v1.TrialStartedProperties
 */
export type TrialStartedProperties = Message<"common.events.v1.TrialStartedProperties"> & {
    /**
     * @generated from field: string trial_id = 1;
     */
    trialId: string;
    /**
     * @generated from field: string plan_id = 2;
     */
    planId: string;
};
/**
 * Describes the message common.events.v1.TrialStartedProperties.
 * Use `create(TrialStartedPropertiesSchema)` to create a new message.
 */
export declare const TrialStartedPropertiesSchema: GenMessage<TrialStartedProperties>;
/**
 * @generated from message common.events.v1.TrialConvertedProperties
 */
export type TrialConvertedProperties = Message<"common.events.v1.TrialConvertedProperties"> & {
    /**
     * @generated from field: string trial_id = 1;
     */
    trialId: string;
    /**
     * @generated from field: string subscription_id = 2;
     */
    subscriptionId: string;
    /**
     * @generated from field: string plan_id = 3;
     */
    planId: string;
};
/**
 * Describes the message common.events.v1.TrialConvertedProperties.
 * Use `create(TrialConvertedPropertiesSchema)` to create a new message.
 */
export declare const TrialConvertedPropertiesSchema: GenMessage<TrialConvertedProperties>;
/**
 * @generated from message common.events.v1.RefundFailedProperties
 */
export type RefundFailedProperties = Message<"common.events.v1.RefundFailedProperties"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
    /**
     * @generated from field: string refund_id = 2;
     */
    refundId: string;
    /**
     * @generated from field: double amount = 3;
     */
    amount: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
    /**
     * @generated from field: string reason = 5;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.RefundFailedProperties.
 * Use `create(RefundFailedPropertiesSchema)` to create a new message.
 */
export declare const RefundFailedPropertiesSchema: GenMessage<RefundFailedProperties>;
