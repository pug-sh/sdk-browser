import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/auth_events.proto.
 */
export declare const file_common_events_v1_auth_events: GenFile;
/**
 * @generated from message common.events.v1.SignupProperties
 */
export type SignupProperties = Message<"common.events.v1.SignupProperties"> & {};
/**
 * Describes the message common.events.v1.SignupProperties.
 * Use `create(SignupPropertiesSchema)` to create a new message.
 */
export declare const SignupPropertiesSchema: GenMessage<SignupProperties>;
/**
 * @generated from message common.events.v1.SigninProperties
 */
export type SigninProperties = Message<"common.events.v1.SigninProperties"> & {};
/**
 * Describes the message common.events.v1.SigninProperties.
 * Use `create(SigninPropertiesSchema)` to create a new message.
 */
export declare const SigninPropertiesSchema: GenMessage<SigninProperties>;
/**
 * @generated from message common.events.v1.SignoutProperties
 */
export type SignoutProperties = Message<"common.events.v1.SignoutProperties"> & {};
/**
 * Describes the message common.events.v1.SignoutProperties.
 * Use `create(SignoutPropertiesSchema)` to create a new message.
 */
export declare const SignoutPropertiesSchema: GenMessage<SignoutProperties>;
/**
 * @generated from message common.events.v1.EmailVerifiedProperties
 */
export type EmailVerifiedProperties = Message<"common.events.v1.EmailVerifiedProperties"> & {};
/**
 * Describes the message common.events.v1.EmailVerifiedProperties.
 * Use `create(EmailVerifiedPropertiesSchema)` to create a new message.
 */
export declare const EmailVerifiedPropertiesSchema: GenMessage<EmailVerifiedProperties>;
/**
 * @generated from message common.events.v1.PasswordResetRequestedProperties
 */
export type PasswordResetRequestedProperties = Message<"common.events.v1.PasswordResetRequestedProperties"> & {};
/**
 * Describes the message common.events.v1.PasswordResetRequestedProperties.
 * Use `create(PasswordResetRequestedPropertiesSchema)` to create a new message.
 */
export declare const PasswordResetRequestedPropertiesSchema: GenMessage<PasswordResetRequestedProperties>;
/**
 * @generated from message common.events.v1.PasswordResetCompletedProperties
 */
export type PasswordResetCompletedProperties = Message<"common.events.v1.PasswordResetCompletedProperties"> & {};
/**
 * Describes the message common.events.v1.PasswordResetCompletedProperties.
 * Use `create(PasswordResetCompletedPropertiesSchema)` to create a new message.
 */
export declare const PasswordResetCompletedPropertiesSchema: GenMessage<PasswordResetCompletedProperties>;
/**
 * Common method values: "totp", "sms", "email", "webauthn", "backup_codes".
 *
 * @generated from message common.events.v1.MfaEnabledProperties
 */
export type MfaEnabledProperties = Message<"common.events.v1.MfaEnabledProperties"> & {
    /**
     * @generated from field: string method = 1;
     */
    method: string;
};
/**
 * Describes the message common.events.v1.MfaEnabledProperties.
 * Use `create(MfaEnabledPropertiesSchema)` to create a new message.
 */
export declare const MfaEnabledPropertiesSchema: GenMessage<MfaEnabledProperties>;
/**
 * Common method values: "totp", "sms", "email", "webauthn", "backup_codes".
 *
 * @generated from message common.events.v1.MfaDisabledProperties
 */
export type MfaDisabledProperties = Message<"common.events.v1.MfaDisabledProperties"> & {
    /**
     * @generated from field: string method = 1;
     */
    method: string;
};
/**
 * Describes the message common.events.v1.MfaDisabledProperties.
 * Use `create(MfaDisabledPropertiesSchema)` to create a new message.
 */
export declare const MfaDisabledPropertiesSchema: GenMessage<MfaDisabledProperties>;
