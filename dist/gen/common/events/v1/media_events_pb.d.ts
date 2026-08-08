import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Duration } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/media_events.proto.
 */
export declare const file_common_events_v1_media_events: GenFile;
/**
 * @generated from message common.events.v1.VideoStartedProperties
 */
export type VideoStartedProperties = Message<"common.events.v1.VideoStartedProperties"> & {
    /**
     * @generated from field: string video_id = 1;
     */
    videoId: string;
};
/**
 * Describes the message common.events.v1.VideoStartedProperties.
 * Use `create(VideoStartedPropertiesSchema)` to create a new message.
 */
export declare const VideoStartedPropertiesSchema: GenMessage<VideoStartedProperties>;
/**
 * @generated from message common.events.v1.VideoPlayProperties
 */
export type VideoPlayProperties = Message<"common.events.v1.VideoPlayProperties"> & {
    /**
     * @generated from field: string video_id = 1;
     */
    videoId: string;
    /**
     * @generated from field: google.protobuf.Duration position = 2;
     */
    position?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.VideoPlayProperties.
 * Use `create(VideoPlayPropertiesSchema)` to create a new message.
 */
export declare const VideoPlayPropertiesSchema: GenMessage<VideoPlayProperties>;
/**
 * @generated from message common.events.v1.VideoPauseProperties
 */
export type VideoPauseProperties = Message<"common.events.v1.VideoPauseProperties"> & {
    /**
     * @generated from field: string video_id = 1;
     */
    videoId: string;
    /**
     * @generated from field: google.protobuf.Duration position = 2;
     */
    position?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.VideoPauseProperties.
 * Use `create(VideoPausePropertiesSchema)` to create a new message.
 */
export declare const VideoPausePropertiesSchema: GenMessage<VideoPauseProperties>;
/**
 * @generated from message common.events.v1.VideoSeekedProperties
 */
export type VideoSeekedProperties = Message<"common.events.v1.VideoSeekedProperties"> & {
    /**
     * @generated from field: string video_id = 1;
     */
    videoId: string;
    /**
     * @generated from field: google.protobuf.Duration from_position = 2;
     */
    fromPosition?: Duration | undefined;
    /**
     * @generated from field: google.protobuf.Duration to_position = 3;
     */
    toPosition?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.VideoSeekedProperties.
 * Use `create(VideoSeekedPropertiesSchema)` to create a new message.
 */
export declare const VideoSeekedPropertiesSchema: GenMessage<VideoSeekedProperties>;
/**
 * @generated from message common.events.v1.VideoCompletedProperties
 */
export type VideoCompletedProperties = Message<"common.events.v1.VideoCompletedProperties"> & {
    /**
     * @generated from field: string video_id = 1;
     */
    videoId: string;
};
/**
 * Describes the message common.events.v1.VideoCompletedProperties.
 * Use `create(VideoCompletedPropertiesSchema)` to create a new message.
 */
export declare const VideoCompletedPropertiesSchema: GenMessage<VideoCompletedProperties>;
/**
 * @generated from message common.events.v1.AudioStartedProperties
 */
export type AudioStartedProperties = Message<"common.events.v1.AudioStartedProperties"> & {
    /**
     * @generated from field: string audio_id = 1;
     */
    audioId: string;
};
/**
 * Describes the message common.events.v1.AudioStartedProperties.
 * Use `create(AudioStartedPropertiesSchema)` to create a new message.
 */
export declare const AudioStartedPropertiesSchema: GenMessage<AudioStartedProperties>;
/**
 * @generated from message common.events.v1.AudioPlayProperties
 */
export type AudioPlayProperties = Message<"common.events.v1.AudioPlayProperties"> & {
    /**
     * @generated from field: string audio_id = 1;
     */
    audioId: string;
    /**
     * @generated from field: google.protobuf.Duration position = 2;
     */
    position?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.AudioPlayProperties.
 * Use `create(AudioPlayPropertiesSchema)` to create a new message.
 */
export declare const AudioPlayPropertiesSchema: GenMessage<AudioPlayProperties>;
/**
 * @generated from message common.events.v1.AudioPauseProperties
 */
export type AudioPauseProperties = Message<"common.events.v1.AudioPauseProperties"> & {
    /**
     * @generated from field: string audio_id = 1;
     */
    audioId: string;
    /**
     * @generated from field: google.protobuf.Duration position = 2;
     */
    position?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.AudioPauseProperties.
 * Use `create(AudioPausePropertiesSchema)` to create a new message.
 */
export declare const AudioPausePropertiesSchema: GenMessage<AudioPauseProperties>;
/**
 * @generated from message common.events.v1.AudioSeekedProperties
 */
export type AudioSeekedProperties = Message<"common.events.v1.AudioSeekedProperties"> & {
    /**
     * @generated from field: string audio_id = 1;
     */
    audioId: string;
    /**
     * @generated from field: google.protobuf.Duration from_position = 2;
     */
    fromPosition?: Duration | undefined;
    /**
     * @generated from field: google.protobuf.Duration to_position = 3;
     */
    toPosition?: Duration | undefined;
};
/**
 * Describes the message common.events.v1.AudioSeekedProperties.
 * Use `create(AudioSeekedPropertiesSchema)` to create a new message.
 */
export declare const AudioSeekedPropertiesSchema: GenMessage<AudioSeekedProperties>;
/**
 * @generated from message common.events.v1.AudioCompletedProperties
 */
export type AudioCompletedProperties = Message<"common.events.v1.AudioCompletedProperties"> & {
    /**
     * @generated from field: string audio_id = 1;
     */
    audioId: string;
};
/**
 * Describes the message common.events.v1.AudioCompletedProperties.
 * Use `create(AudioCompletedPropertiesSchema)` to create a new message.
 */
export declare const AudioCompletedPropertiesSchema: GenMessage<AudioCompletedProperties>;
