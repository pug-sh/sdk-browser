import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/form_events.proto.
 */
export declare const file_common_events_v1_form_events: GenFile;
/**
 * @generated from message common.events.v1.FormStartProperties
 */
export type FormStartProperties = Message<"common.events.v1.FormStartProperties"> & {
    /**
     * @generated from field: string form_id = 1;
     */
    formId: string;
    /**
     * @generated from field: string form_name = 2;
     */
    formName: string;
};
/**
 * Describes the message common.events.v1.FormStartProperties.
 * Use `create(FormStartPropertiesSchema)` to create a new message.
 */
export declare const FormStartPropertiesSchema: GenMessage<FormStartProperties>;
/**
 * @generated from message common.events.v1.FormSubmitProperties
 */
export type FormSubmitProperties = Message<"common.events.v1.FormSubmitProperties"> & {
    /**
     * @generated from field: string form_id = 1;
     */
    formId: string;
    /**
     * @generated from field: string form_name = 2;
     */
    formName: string;
    /**
     * @generated from field: string action = 3;
     */
    action: string;
};
/**
 * Describes the message common.events.v1.FormSubmitProperties.
 * Use `create(FormSubmitPropertiesSchema)` to create a new message.
 */
export declare const FormSubmitPropertiesSchema: GenMessage<FormSubmitProperties>;
