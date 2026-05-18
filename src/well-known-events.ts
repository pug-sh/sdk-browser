import {
  AppClosePropertiesSchema,
  AppOpenPropertiesSchema,
} from '@buf/fivebits_pug.bufbuild_es/common/events/v1/app_events_pb.js'
import { SignupPropertiesSchema } from '@buf/fivebits_pug.bufbuild_es/common/events/v1/auth_events_pb.js'
import {
  AddToCartPropertiesSchema,
  CheckoutStartedPropertiesSchema,
  PurchasePropertiesSchema,
} from '@buf/fivebits_pug.bufbuild_es/common/events/v1/commerce_events_pb.js'
import { SearchPropertiesSchema } from '@buf/fivebits_pug.bufbuild_es/common/events/v1/discovery_events_pb.js'
import { ErrorOccurredPropertiesSchema } from '@buf/fivebits_pug.bufbuild_es/common/events/v1/error_events_pb.js'
import {
  FormStartPropertiesSchema,
  FormSubmitPropertiesSchema,
} from '@buf/fivebits_pug.bufbuild_es/common/events/v1/form_events_pb.js'
import {
  VideoPausePropertiesSchema,
  VideoPlayPropertiesSchema,
} from '@buf/fivebits_pug.bufbuild_es/common/events/v1/media_events_pb.js'
import {
  ClickPropertiesSchema,
  DeadClickPropertiesSchema,
  PageViewPropertiesSchema,
  RageClickPropertiesSchema,
  ScrollPropertiesSchema,
} from '@buf/fivebits_pug.bufbuild_es/common/events/v1/navigation_events_pb.js'
import {
  NotificationClickedPropertiesSchema,
  NotificationDismissedPropertiesSchema,
  NotificationReceivedPropertiesSchema,
} from '@buf/fivebits_pug.bufbuild_es/common/events/v1/notification_events_pb.js'
import { SharePropertiesSchema } from '@buf/fivebits_pug.bufbuild_es/common/events/v1/social_events_pb.js'
import type { JsonValue, MessageInitShape } from '@bufbuild/protobuf'

/** Options passed to `track()`. `immediate` bypasses batching for priority events; `timestamp` overrides the default current-time (epoch milliseconds, e.g. `Date.now()`). */
export interface TrackOptions {
  readonly immediate?: boolean
  readonly timestamp?: number
}

export type { JsonValue }

export const wellKnownSchemas = Object.freeze({
  add_to_cart: AddToCartPropertiesSchema,
  app_close: AppClosePropertiesSchema,
  app_open: AppOpenPropertiesSchema,
  checkout_started: CheckoutStartedPropertiesSchema,
  click: ClickPropertiesSchema,
  dead_click: DeadClickPropertiesSchema,
  error_occurred: ErrorOccurredPropertiesSchema,
  form_start: FormStartPropertiesSchema,
  form_submit: FormSubmitPropertiesSchema,
  notification_clicked: NotificationClickedPropertiesSchema,
  notification_dismissed: NotificationDismissedPropertiesSchema,
  notification_received: NotificationReceivedPropertiesSchema,
  page_view: PageViewPropertiesSchema,
  purchase: PurchasePropertiesSchema,
  rage_click: RageClickPropertiesSchema,
  scroll: ScrollPropertiesSchema,
  search: SearchPropertiesSchema,
  share: SharePropertiesSchema,
  signup: SignupPropertiesSchema,
  video_pause: VideoPausePropertiesSchema,
  video_play: VideoPlayPropertiesSchema,
} as const)

type WellKnownSchemas = typeof wellKnownSchemas
export type WellKnownEventName = keyof WellKnownSchemas
export type WellKnownEventPropsMap = { [K in WellKnownEventName]: MessageInitShape<WellKnownSchemas[K]> }

/**
 * Overloaded track function type. First overload narrows properties for well-known
 * events; second accepts any string with loose Record<string, JsonValue> props.
 *
 * Note: if the first overload's type check fails (e.g., wrong type for a known field),
 * TypeScript silently falls through to the second overload. Runtime validation in
 * validateWellKnownProps is the actual safety net.
 */
export type TrackFn = {
  <K extends WellKnownEventName>(
    event: K,
    props?: WellKnownEventPropsMap[K] & Record<string, JsonValue>,
    options?: TrackOptions,
  ): void
  (event: string, props?: Record<string, JsonValue>, options?: TrackOptions): void
}
