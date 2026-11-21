import type { GenEnum, GenExtension, GenFile } from "@bufbuild/protobuf/codegenv2";
import type { FieldOptions, MessageOptions } from "@bufbuild/protobuf/wkt";
/**
 * Describes the file common/events/v1/options.proto.
 */
export declare const file_common_events_v1_options: GenFile;
/**
 * Platform identifies the client/runtime an event is intended for.
 * Used by SDK codegen tooling to decide which language targets should
 * surface a given well-known event. Like `kind`, this is an SDK hint —
 * the server does not enforce it.
 *
 * Naming note: a separate `Platform` enum exists in
 * `shared/delivery/v1/delivery.proto` for push-notification transport
 * targets (ANDROID/IOS only). The two enums describe different concepts
 * (event source vs push transport) and intentionally coexist; in Go
 * they are `commoneventsv1.Platform` vs `deliveryv1.Platform`. Their
 * ordinal integers are independent — do not assume a value name shared
 * between them encodes to the same wire integer in both packages.
 *
 * @generated from enum common.events.v1.Platform
 */
export declare enum Platform {
    /**
     * @generated from enum value: PLATFORM_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Browser-based JavaScript SDKs.
     *
     * @generated from enum value: PLATFORM_WEB = 1;
     */
    WEB = 1,
    /**
     * Native iOS apps (Swift/Objective-C).
     *
     * @generated from enum value: PLATFORM_IOS = 2;
     */
    IOS = 2,
    /**
     * Native Android apps (Kotlin/Java).
     *
     * @generated from enum value: PLATFORM_ANDROID = 3;
     */
    ANDROID = 3,
    /**
     * Native desktop apps (Electron, macOS, Windows).
     *
     * @generated from enum value: PLATFORM_DESKTOP = 4;
     */
    DESKTOP = 4,
    /**
     * Server-side tracking from backend services.
     *
     * @generated from enum value: PLATFORM_SERVER = 5;
     */
    SERVER = 5
}
/**
 * Describes the enum common.events.v1.Platform.
 */
export declare const PlatformSchema: GenEnum<Platform>;
/**
 * @generated from extension: string kind = 50000;
 */
export declare const kind: GenExtension<MessageOptions, string>;
/**
 * @generated from extension: bool pii = 50001;
 */
export declare const pii: GenExtension<FieldOptions, boolean>;
/**
 * @generated from extension: repeated common.events.v1.Platform platforms = 50002;
 */
export declare const platforms: GenExtension<MessageOptions, Platform[]>;
