import type { JsonValue, MessageInitShape } from '@bufbuild/protobuf'
import type { WellKnownSchemaMap } from './well-known-events.generated.js'

/** Options passed to `track()`. `immediate` bypasses batching; `timestamp` overrides the current time (epoch ms). */
export interface TrackOptions {
  readonly immediate?: boolean
  readonly timestamp?: number
}

export type { JsonValue }

export type WellKnownEventName = keyof WellKnownSchemaMap
export type WellKnownEventPropsMap = { [K in WellKnownEventName]: MessageInitShape<WellKnownSchemaMap[K]> }

/**
 * A property value the SDK can send: `JsonValue` plus `bigint` (→ `intValue`) and `Date` (→
 * `timestampValue`), mirroring what `jsValueToPropertyValue` accepts at runtime. The extras are
 * load-bearing — protobuf-es maps proto `int64` to `bigint`, so under a bare `JsonValue` bag the
 * int64 fields on five well-known events are unwritable in every spelling.
 */
export type PropValue = JsonValue | bigint | Date

/**
 * Properties accepted for an event: a well-known event's typed shape plus arbitrary extras, or a
 * loose bag for any other string.
 *
 * The `[E] extends [...]` tuple and the `E & WellKnownEventName` intersection both look like no-ops
 * and both defer expansion over the 119-name union. Without them a wrapper forwarding its own type
 * parameter hits TS2590 ("union type too complex to represent") — a compiler resource bailout that
 * names no cause. Pinned by `track-types.test-d.ts`, which catches only the fully-reverted form.
 */
export type TrackEventProps<E extends string> = [E] extends [WellKnownEventName]
  ? WellKnownEventPropsMap[E & WellKnownEventName] & Record<string, PropValue>
  : Record<string, PropValue>

/**
 * The `track()` signature: well-known names get typed, autocompleted properties; any other string is
 * a custom event with loose props. Compile-time only — both route through the same runtime path, and
 * every schema import is `import type`, so none of this reaches the bundle.
 *
 * One conditional signature rather than two overloads: with a permissive fallback overload, a wrong
 * type on a known field abandoned the first overload, matched the fallback and compiled. `(string &
 * {})` keeps autocomplete for the literals while still admitting any custom string.
 */
export type TrackFn = <E extends WellKnownEventName | (string & {})>(
  event: E,
  props?: TrackEventProps<E>,
  options?: TrackOptions,
) => void
