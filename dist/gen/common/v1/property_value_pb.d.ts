import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/v1/property_value.proto.
 */
export declare const file_common_v1_property_value: GenFile;
/**
 * PropertyValue is the typed value of an event property.
 * Exactly one variant must be set; this is enforced by the protovalidate
 * oneof.required option below.
 *
 * Lists, objects, and other compound types are intentionally not included
 * in this iteration — only the five primitive types supported by the
 * ClickHouse Variant storage target. New variants can be added later as
 * additive oneof entries (wire-compatible).
 *
 * @generated from message common.v1.PropertyValue
 */
export type PropertyValue = Message<"common.v1.PropertyValue"> & {
    /**
     * @generated from oneof common.v1.PropertyValue.value
     */
    value: {
        /**
         * Cap property string values at 1024 Unicode codepoints. Large blobs
         * (logs, raw payloads, serialized JSON) should be hashed or referenced
         * upstream rather than embedded as a property value. Note: max_len
         * counts codepoints, not bytes — multi-byte UTF-8 (emoji, CJK) can
         * exceed 1 KiB on the wire at this limit. Switch to max_bytes if a
         * hard byte cap is required. Values exceeding the limit are rejected
         * at the validate interceptor with CodeInvalidArgument (not truncated).
         *
         * Empty-string note: the filter expression cannot distinguish a
         * custom_properties value of "" from an absent key — both project to ''
         * in propertyExpr (filters.go), so EQUALS '' and IS_NOT_SET match
         * identically. If the empty case is meaningful, encode it differently
         * (e.g. a sentinel value) on the producer side.
         *
         * @generated from field: string string_value = 1;
         */
        value: string;
        case: "stringValue";
    } | {
        /**
         * @generated from field: int64 int_value = 2;
         */
        value: bigint;
        case: "intValue";
    } | {
        /**
         * @generated from field: double double_value = 3;
         */
        value: number;
        case: "doubleValue";
    } | {
        /**
         * @generated from field: bool bool_value = 4;
         */
        value: boolean;
        case: "boolValue";
    } | {
        /**
         * Stored as a DateTime64(3) Variant slot. Sub-millisecond precision is
         * truncated by ClickHouse on insert to match the slot's precision; no
         * Go-side truncation is performed in the worker.
         *
         * @generated from field: google.protobuf.Timestamp timestamp_value = 5;
         */
        value: Timestamp;
        case: "timestampValue";
    } | {
        case: undefined;
        value?: undefined;
    };
};
/**
 * Describes the message common.v1.PropertyValue.
 * Use `create(PropertyValueSchema)` to create a new message.
 */
export declare const PropertyValueSchema: GenMessage<PropertyValue>;
