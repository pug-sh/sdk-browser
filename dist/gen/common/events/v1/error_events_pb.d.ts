import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/error_events.proto.
 */
export declare const file_common_events_v1_error_events: GenFile;
/**
 * Common severity values: "info", "warning", "error", "fatal".
 * unhandled indicates whether the error was caught by application code (false)
 * or escaped to a global handler / crashed the surface (true).
 *
 * @generated from message common.events.v1.ErrorOccurredProperties
 */
export type ErrorOccurredProperties = Message<"common.events.v1.ErrorOccurredProperties"> & {
    /**
     * @generated from field: string error_code = 1;
     */
    errorCode: string;
    /**
     * @generated from field: string message = 2;
     */
    message: string;
    /**
     * @generated from field: string severity = 3;
     */
    severity: string;
    /**
     * @generated from field: bool unhandled = 4;
     */
    unhandled: boolean;
    /**
     * @generated from field: string stack = 5;
     */
    stack: string;
};
/**
 * Describes the message common.events.v1.ErrorOccurredProperties.
 * Use `create(ErrorOccurredPropertiesSchema)` to create a new message.
 */
export declare const ErrorOccurredPropertiesSchema: GenMessage<ErrorOccurredProperties>;
