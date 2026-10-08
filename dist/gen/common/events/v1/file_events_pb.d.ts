import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/file_events.proto.
 */
export declare const file_common_events_v1_file_events: GenFile;
/**
 * @generated from message common.events.v1.FileUploadedProperties
 */
export type FileUploadedProperties = Message<"common.events.v1.FileUploadedProperties"> & {
    /**
     * @generated from field: string file_id = 1;
     */
    fileId: string;
    /**
     * @generated from field: string file_name = 2;
     */
    fileName: string;
    /**
     * @generated from field: string file_type = 3;
     */
    fileType: string;
    /**
     * @generated from field: int64 size_bytes = 4;
     */
    sizeBytes: bigint;
};
/**
 * Describes the message common.events.v1.FileUploadedProperties.
 * Use `create(FileUploadedPropertiesSchema)` to create a new message.
 */
export declare const FileUploadedPropertiesSchema: GenMessage<FileUploadedProperties>;
/**
 * @generated from message common.events.v1.FileDownloadedProperties
 */
export type FileDownloadedProperties = Message<"common.events.v1.FileDownloadedProperties"> & {
    /**
     * @generated from field: string file_id = 1;
     */
    fileId: string;
    /**
     * @generated from field: string file_name = 2;
     */
    fileName: string;
    /**
     * @generated from field: string file_type = 3;
     */
    fileType: string;
    /**
     * @generated from field: int64 size_bytes = 4;
     */
    sizeBytes: bigint;
};
/**
 * Describes the message common.events.v1.FileDownloadedProperties.
 * Use `create(FileDownloadedPropertiesSchema)` to create a new message.
 */
export declare const FileDownloadedPropertiesSchema: GenMessage<FileDownloadedProperties>;
/**
 * @generated from message common.events.v1.ExportStartedProperties
 */
export type ExportStartedProperties = Message<"common.events.v1.ExportStartedProperties"> & {
    /**
     * @generated from field: string export_id = 1;
     */
    exportId: string;
    /**
     * @generated from field: string export_type = 2;
     */
    exportType: string;
};
/**
 * Describes the message common.events.v1.ExportStartedProperties.
 * Use `create(ExportStartedPropertiesSchema)` to create a new message.
 */
export declare const ExportStartedPropertiesSchema: GenMessage<ExportStartedProperties>;
/**
 * @generated from message common.events.v1.ExportCompletedProperties
 */
export type ExportCompletedProperties = Message<"common.events.v1.ExportCompletedProperties"> & {
    /**
     * @generated from field: string export_id = 1;
     */
    exportId: string;
    /**
     * @generated from field: string export_type = 2;
     */
    exportType: string;
    /**
     * @generated from field: int64 size_bytes = 3;
     */
    sizeBytes: bigint;
};
/**
 * Describes the message common.events.v1.ExportCompletedProperties.
 * Use `create(ExportCompletedPropertiesSchema)` to create a new message.
 */
export declare const ExportCompletedPropertiesSchema: GenMessage<ExportCompletedProperties>;
