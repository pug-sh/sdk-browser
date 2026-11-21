import { create } from '@bufbuild/protobuf'
import { timestampFromMs, timestampNow } from '@bufbuild/protobuf/wkt'
import { uuidv7 } from 'uuidv7'
import { type PropertyValue, PropertyValueSchema } from './gen/common/v1/property_value_pb.js'
import { type Event, EventSchema } from './gen/sdk/events/v1/events_pb.js'
import { log } from './logger.js'
import { parseUserAgentData, parseUtmParams } from './parsers.js'
import { safeStringify, scrubUrl } from './utils.js'
import { SDK_VERSION } from './version.js'
import type { PropValue, TrackOptions, WellKnownEventName } from './well-known-events.js'

export type {
  JsonValue,
  PropValue,
  TrackEventProps,
  TrackFn,
  TrackOptions,
  WellKnownEventName,
  WellKnownEventPropsMap,
} from './well-known-events.js'

/** Plain-JS view of an event, before protobuf conversion. Mutate the bags in place — they are
 * readonly because replacing one and returning nothing would send the un-redacted original. */
export type BeforeSendEvent = {
  readonly kind: WellKnownEventName | (string & {})
  readonly autoProperties: Record<string, string>
  readonly customProperties: Record<string, PropValue>
}

/** Return the event to send it, `null` to drop it, or nothing to keep in-place mutations. */
export type BeforeSendFn = (event: BeforeSendEvent) => BeforeSendEvent | null | void

let beforeSend: BeforeSendFn | null = null
// One flag per failure class — a throw must not silence a later malformed return.
let beforeSendThrewWarned = false
let beforeSendMalformedWarned = false

// Re-asserted after the hook: the backend keys on $projectId and cannot re-derive the other two.
const PROTECTED_AUTO_PROPERTIES = ['$projectId', '$platform', '$sdkVersion'] as const

/** Wired from `init({ beforeSend })`; `undefined` clears it. Fails closed like the URL sanitizer:
 * a non-function drops every event rather than sending data the caller thought was scrubbed. */
export const configureBeforeSend = (fn?: BeforeSendFn): void => {
  if (fn !== undefined && typeof fn !== 'function') {
    log.warn('beforeSend must be a function; dropping all events to avoid sending unredacted data.')
    beforeSend = () => null
  } else {
    beforeSend = fn ?? null
  }
  beforeSendThrewWarned = false
  beforeSendMalformedWarned = false
}

// A Map/Set/array/class instance yields nothing from Object.entries, so accepting one would ship
// an event stripped to its re-asserted properties, silently.
const isPlainBag = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) {
    return false
  }
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

// Never throws. A hook that throws or returns garbage drops the event — there is no narrower thing
// to fail closed on, and the hook exists to keep something out of the payload.
const applyBeforeSend = (
  kind: string,
  autoProperties: Record<string, string>,
  customProperties: Record<string, PropValue>,
): { autoProperties: Record<string, unknown>; customProperties: Record<string, unknown> } | null => {
  if (!beforeSend) {
    return { autoProperties, customProperties }
  }

  // Snapshot first: the hook gets the live bag, so a `delete e.autoProperties.$projectId` would
  // otherwise empty the very thing we re-assert from.
  const protectedValues = PROTECTED_AUTO_PROPERTIES.map(k => autoProperties[k])

  // Held, not rebuilt: a hook that replaces a bag and returns nothing must not send the originals.
  const draft: BeforeSendEvent = { kind, autoProperties, customProperties }

  let returned: BeforeSendEvent | null | void
  try {
    returned = beforeSend(draft)
  } catch (err) {
    // Error type only — a hook that interpolates the value it was redacting would re-surface it.
    if (!beforeSendThrewWarned) {
      beforeSendThrewWarned = true
      log.warn(
        'beforeSend threw; dropping event to avoid sending unredacted data. Error type:',
        err instanceof Error ? err.name : typeof err,
      )
    }
    return null
  }

  if (returned === null) {
    log.debug(`Event "${kind}" dropped by beforeSend`)
    return null
  }
  // Undefined = mutated in place and fell off the end, which in-place editing invites.
  const shaped: BeforeSendEvent = returned === undefined ? draft : returned
  if (!isPlainBag(shaped) || !isPlainBag(shaped.autoProperties) || !isPlainBag(shaped.customProperties)) {
    if (!beforeSendMalformedWarned) {
      beforeSendMalformedWarned = true
      log.warn(
        'beforeSend returned a malformed event (expected the event, null, or nothing); dropping event to avoid sending unredacted data.',
      )
    }
    return null
  }

  const finalAuto: Record<string, unknown> = { ...shaped.autoProperties }
  PROTECTED_AUTO_PROPERTIES.forEach((key, i) => {
    finalAuto[key] = protectedValues[i]
  })
  return { autoProperties: finalAuto, customProperties: shaped.customProperties }
}

// The proto's `string.max_len = 1024` is enforced server-side as a *code-point* count, so
// truncating by UTF-8 bytes is strictly more conservative.
const MAX_STRING_BYTES = 1024

const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).byteLength

const truncateToBytes = (s: string, max: number): string => {
  const bytes = new TextEncoder().encode(s)
  if (bytes.byteLength <= max) {
    return s
  }
  // Step back from the cut to a UTF-8 leading byte (high two bits != 10).
  let cut = max
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
    cut--
  }
  return new TextDecoder().decode(bytes.subarray(0, cut))
}

const makeStringValue = (raw: string): PropertyValue => {
  let value = raw
  // length * 3 is a strict upper bound on UTF-8 bytes, so most strings skip the TextEncoder.
  if (raw.length * 3 > MAX_STRING_BYTES && utf8ByteLength(raw) > MAX_STRING_BYTES) {
    log.warn(`Property string exceeds ${MAX_STRING_BYTES} bytes, truncating`)
    value = truncateToBytes(raw, MAX_STRING_BYTES)
  }
  return create(PropertyValueSchema, { value: { case: 'stringValue', value } })
}

const NANOS_PER_SECOND = 1_000_000_000n

// Rounded to the nanosecond: plain JavaScript passes `{ seconds: video.currentTime }`, and
// durationFromMs() leaves float error in nanos, such as 345600000.00000036 for 12345.6 ms.
const toNanos = (v: unknown, nanosPerUnit: bigint): bigint | null => {
  if (typeof v === 'bigint') {
    return v * nanosPerUnit
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return null
  }
  const whole = Math.trunc(v)
  return BigInt(whole) * nanosPerUnit + BigInt(Math.round((v - whole) * Number(nanosPerUnit)))
}

// JSON.stringify throws on a bigint. A string keeps every digit, as protobuf's JSON mapping writes int64.
const bigintAsString = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? String(value) : value)

// options.proto's wire form for a Duration is "90.5s". Summing first copes with nanos out of range or
// signed against seconds.
const durationText = (v: object): string | null => {
  if (!isPlainBag(v)) {
    return null
  }
  const { seconds, nanos, $typeName, ...rest } = v as Record<string, unknown>
  if (Object.keys(rest).length > 0 || ($typeName !== undefined && $typeName !== 'google.protobuf.Duration')) {
    return null
  }
  if (seconds === undefined && nanos === undefined) {
    return null
  }
  const whole = seconds === undefined ? 0n : toNanos(seconds, NANOS_PER_SECOND)
  const fractional = nanos === undefined ? 0n : toNanos(nanos, 1n)
  if (whole === null || fractional === null) {
    return null
  }
  const total = whole + fractional
  const sign = total < 0n ? '-' : ''
  const abs = total < 0n ? -total : total
  const fraction = String(abs % NANOS_PER_SECOND)
    .padStart(9, '0')
    .replace(/0+$/, '')
  return `${sign}${abs / NANOS_PER_SECOND}${fraction ? `.${fraction}` : ''}s`
}

/**
 * Maps an untyped JS value to a PropertyValue oneof. Every property on every event flows through
 * here — there is no runtime schema, so well-known names get no special serialization. Returns null
 * when the value cannot be represented; the caller omits the property.
 *
 * Mapping:
 *   - string         → stringValue (truncated to 1024 UTF-8 bytes if needed)
 *   - boolean        → boolValue
 *   - number         → intValue when Number.isSafeInteger, else doubleValue;
 *                      NaN/±Infinity dropped (non-finite doubles aren't representable)
 *   - bigint         → intValue
 *   - Date           → timestampValue (Date(NaN) dropped)
 *   - Duration       → stringValue "90.5s", to the nanosecond: a plain object of a numeric `seconds`
 *                      and/or `nanos`, no other key but `$typeName`, as `durationFromMs()` builds
 *   - object/array   → JSON.stringify → stringValue (subject to truncation), a nested bigint as a
 *                      string; circular structures and toJSON returning undefined dropped
 *   - null/undefined → dropped (no oneof case fits)
 */
const jsValueToPropertyValue = (v: unknown): PropertyValue | null => {
  if (v === null || v === undefined) {
    return null
  }
  if (typeof v === 'string') {
    return makeStringValue(v)
  }
  if (typeof v === 'boolean') {
    return create(PropertyValueSchema, { value: { case: 'boolValue', value: v } })
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      return null
    }
    if (Number.isSafeInteger(v)) {
      return create(PropertyValueSchema, { value: { case: 'intValue', value: BigInt(v) } })
    }
    return create(PropertyValueSchema, { value: { case: 'doubleValue', value: v } })
  }
  if (typeof v === 'bigint') {
    return create(PropertyValueSchema, { value: { case: 'intValue', value: v } })
  }
  if (v instanceof Date) {
    const ms = v.getTime()
    if (!Number.isFinite(ms)) {
      return null
    }
    return create(PropertyValueSchema, { value: { case: 'timestampValue', value: timestampFromMs(ms) } })
  }
  if (typeof v === 'object') {
    let text: string
    try {
      text = durationText(v) ?? JSON.stringify(v, bigintAsString)
    } catch {
      return null
    }
    if (text === undefined) {
      return null
    }
    return makeStringValue(text)
  }
  return null
}

// After beforeSend, which can add keys to either bag: the server fails the whole batch on a custom
// key starting with `$` or an auto-property key that doesn't.
const mapPropsViaHeuristic = (
  source: Record<string, unknown>,
  kind: string,
  auto: boolean,
): Record<string, PropertyValue> => {
  const mapped: Record<string, PropertyValue> = {}
  for (const [k, v] of Object.entries(source)) {
    if (v === null || v === undefined) {
      continue
    }
    if (k.startsWith('$') !== auto) {
      log.warn(
        auto
          ? `Auto-property "${k}" on event "${kind}" skipped: auto-property keys must start with '$'`
          : `Property "${k}" on event "${kind}" skipped: keys starting with '$' are reserved for auto-properties`,
      )
      continue
    }
    const pv = jsValueToPropertyValue(v)
    if (pv) {
      mapped[k] = pv
    } else {
      log.warn(`Property "${k}" on event "${kind}" not representable (${typeof v}), skipping`)
    }
  }
  return mapped
}

// The server's Event.kind pattern. A kind outside it fails the whole batch, not just its own event.
const KIND_PATTERN = /^[a-zA-Z0-9_.-]+$/

// Lives here, not in events/page_view.ts: `toEvent` gates $pageTitle on it, and core importing a
// tracker module breaks every test that vi.mocks it.
export const eventPageView = 'page_view' satisfies WellKnownEventName

/**
 * A closed choice: either the server derives identity (cookieless — the flag and NO ids, which the
 * backend enforces at validation) or the caller supplies both ids.
 *
 * The `?: never` members are what close it. Without them the arms share no property, so there is no
 * discriminant, and excess-property checking against a union accepts anything present in *any*
 * constituent — so every spelling of "cookieless with ids" compiled, including the spread and
 * variable forms an explicit literal tag would still admit. Pinned by event-identity.test-d.ts.
 */
export type EventIdentity =
  | { readonly cookieless: true; readonly sessionId?: never; readonly distinctId?: never }
  | { readonly cookieless?: never; readonly sessionId: string; readonly distinctId: string }

export const toEvent = (
  projectId: string,
  kind: string,
  identity: EventIdentity,
  props?: Record<string, unknown>,
  opts?: TrackOptions,
): Event | null => {
  if (typeof kind !== 'string') {
    log.warn(`Event ${safeStringify(kind)} dropped: a kind must be a string, got ${typeof kind}`)
    return null
  }
  if (!KIND_PATTERN.test(kind)) {
    log.warn(`Event ${safeStringify(kind)} dropped: a kind must be one or more ASCII letters, digits, '_', '.' or '-'`)
    return null
  }

  // Built plain, hooked, then converted — so beforeSend sees values, not PropertyValue oneofs.
  const rawAutoProperties: Record<string, string> = {
    $projectId: projectId,
    // Not derivable server-side from the UA header (unlike $browser/$os/$device), so every SDK
    // sends it. Value set is web | ios | android, matching devices.proto's `platform` constraint.
    $platform: 'web',
    // Scrubbed before beforeSend sees them, so the hook adds masking rather than being the only
    // thing standing between a reset token in the URL and the backend.
    $url: scrubUrl(window.location.href),
    $referrer: scrubUrl(document.referrer),
    $locale: navigator.language,
    $screenWidth: String(window.screen.width),
    $screenHeight: String(window.screen.height),
    // Page-view only: titles carry names and order numbers, and every later event on the page
    // shares its sessionId anyway.
    ...(kind === eventPageView ? { $pageTitle: document.title } : {}),
    $sdkVersion: SDK_VERSION,
    ...parseUserAgentData(),
    ...parseUtmParams(window.location.search),
  }

  const shaped = applyBeforeSend(kind, rawAutoProperties, { ...props } as Record<string, PropValue>)

  if (!shaped) {
    return null
  }

  const autoProperties = mapPropsViaHeuristic(shaped.autoProperties, kind, true)
  const customProperties = mapPropsViaHeuristic(shaped.customProperties, kind, false)

  let event: Event
  try {
    event = create(EventSchema, {
      eventId: uuidv7(),
      autoProperties,
      customProperties,
      kind,
      // Value, not key presence: `'cookieless' in identity` was true for `{ cookieless: false }` and
      // would have emitted `cookieless: true` for it. The type now forbids that shape, so this only
      // keeps the runtime branch agreeing with the type rather than contradicting it silently.
      ...(identity.cookieless === true
        ? { cookieless: true }
        : { sessionId: identity.sessionId, distinctId: identity.distinctId }),
      occurTime: opts?.timestamp && Number.isFinite(opts.timestamp) ? timestampFromMs(opts.timestamp) : timestampNow(),
    })
  } catch (err) {
    log.error(`Event "${kind}" dropped: failed to create Event proto:`, err)
    return null
  }

  return event
}
