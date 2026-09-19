import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/discovery_events.proto.
 */
export declare const file_common_events_v1_discovery_events: GenFile;
/**
 * @generated from message common.events.v1.SearchProperties
 */
export type SearchProperties = Message<"common.events.v1.SearchProperties"> & {
    /**
     * @generated from field: string query = 1;
     */
    query: string;
};
/**
 * Describes the message common.events.v1.SearchProperties.
 * Use `create(SearchPropertiesSchema)` to create a new message.
 */
export declare const SearchPropertiesSchema: GenMessage<SearchProperties>;
/**
 * @generated from message common.events.v1.SearchResultClickedProperties
 */
export type SearchResultClickedProperties = Message<"common.events.v1.SearchResultClickedProperties"> & {
    /**
     * @generated from field: string query = 1;
     */
    query: string;
    /**
     * @generated from field: string result_id = 2;
     */
    resultId: string;
    /**
     * @generated from field: int32 index = 3;
     */
    index: number;
};
/**
 * Describes the message common.events.v1.SearchResultClickedProperties.
 * Use `create(SearchResultClickedPropertiesSchema)` to create a new message.
 */
export declare const SearchResultClickedPropertiesSchema: GenMessage<SearchResultClickedProperties>;
/**
 * @generated from message common.events.v1.RecommendationViewedProperties
 */
export type RecommendationViewedProperties = Message<"common.events.v1.RecommendationViewedProperties"> & {
    /**
     * @generated from field: string recommendation_id = 1;
     */
    recommendationId: string;
    /**
     * @generated from field: string item_id = 2;
     */
    itemId: string;
    /**
     * @generated from field: string source = 3;
     */
    source: string;
    /**
     * @generated from field: int32 index = 4;
     */
    index: number;
};
/**
 * Describes the message common.events.v1.RecommendationViewedProperties.
 * Use `create(RecommendationViewedPropertiesSchema)` to create a new message.
 */
export declare const RecommendationViewedPropertiesSchema: GenMessage<RecommendationViewedProperties>;
/**
 * @generated from message common.events.v1.RecommendationClickedProperties
 */
export type RecommendationClickedProperties = Message<"common.events.v1.RecommendationClickedProperties"> & {
    /**
     * @generated from field: string recommendation_id = 1;
     */
    recommendationId: string;
    /**
     * @generated from field: string item_id = 2;
     */
    itemId: string;
    /**
     * @generated from field: string source = 3;
     */
    source: string;
    /**
     * @generated from field: int32 index = 4;
     */
    index: number;
};
/**
 * Describes the message common.events.v1.RecommendationClickedProperties.
 * Use `create(RecommendationClickedPropertiesSchema)` to create a new message.
 */
export declare const RecommendationClickedPropertiesSchema: GenMessage<RecommendationClickedProperties>;
/**
 * @generated from message common.events.v1.FilterAppliedProperties
 */
export type FilterAppliedProperties = Message<"common.events.v1.FilterAppliedProperties"> & {
    /**
     * @generated from field: string key = 1;
     */
    key: string;
    /**
     * @generated from field: string value = 2;
     */
    value: string;
};
/**
 * Describes the message common.events.v1.FilterAppliedProperties.
 * Use `create(FilterAppliedPropertiesSchema)` to create a new message.
 */
export declare const FilterAppliedPropertiesSchema: GenMessage<FilterAppliedProperties>;
/**
 * @generated from message common.events.v1.SortChangedProperties
 */
export type SortChangedProperties = Message<"common.events.v1.SortChangedProperties"> & {
    /**
     * @generated from field: string key = 1;
     */
    key: string;
    /**
     * @generated from field: string direction = 2;
     */
    direction: string;
};
/**
 * Describes the message common.events.v1.SortChangedProperties.
 * Use `create(SortChangedPropertiesSchema)` to create a new message.
 */
export declare const SortChangedPropertiesSchema: GenMessage<SortChangedProperties>;
