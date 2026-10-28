import { create } from '@bufbuild/protobuf';
import { timestampFromMs, timestampNow } from '@bufbuild/protobuf/wkt';
import { uuidv7 } from 'uuidv7';
import { PropertyValueSchema } from './gen/common/v1/property_value_pb.js';
import { EventSchema } from './gen/sdk/events/v1/events_pb.js';
import { log } from './logger.js';
import { parseUserAgentData, parseUtmParams } from './parsers.js';
import { scrubUrl } from './utils.js';
import { SDK_VERSION } from './version.js';
let beforeSend = null;
// One flag per failure class — a throw must not silence a later malformed return.
let beforeSendThrewWarned = false;
let beforeSendMalformedWarned = false;
// Re-asserted after the hook: the backend keys on $projectId and cannot re-derive the other two.
const PROTECTED_AUTO_PROPERTIES = ['$projectId', '$platform', '$sdkVersion'];
/** Wired from `init({ beforeSend })`; `undefined` clears it. Fails closed like the URL sanitizer:
 * a non-function drops every event rather than sending data the caller thought was scrubbed. */
export const configureBeforeSend = (fn) => {
    if (fn !== undefined && typeof fn !== 'function') {
        log.warn('beforeSend must be a function; dropping all events to avoid sending unredacted data.');
        beforeSend = () => null;
    }
    else {
        beforeSend = fn ?? null;
    }
    beforeSendThrewWarned = false;
    beforeSendMalformedWarned = false;
};
// A Map/Set/array/class instance yields nothing from Object.entries, so accepting one would ship
// an event stripped to its re-asserted properties, silently.
const isPlainBag = (v) => {
    if (typeof v !== 'object' || v === null) {
        return false;
    }
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};
// Never throws. A hook that throws or returns garbage drops the event — there is no narrower thing
// to fail closed on, and the hook exists to keep something out of the payload.
const applyBeforeSend = (kind, autoProperties, customProperties) => {
    if (!beforeSend) {
        return { autoProperties, customProperties };
    }
    // Snapshot first: the hook gets the live bag, so a `delete e.autoProperties.$projectId` would
    // otherwise empty the very thing we re-assert from.
    const protectedValues = PROTECTED_AUTO_PROPERTIES.map(k => autoProperties[k]);
    // Held, not rebuilt: a hook that replaces a bag and returns nothing must not send the originals.
    const draft = { kind, autoProperties, customProperties };
    let returned;
    try {
        returned = beforeSend(draft);
    }
    catch (err) {
        // Error type only — a hook that interpolates the value it was redacting would re-surface it.
        if (!beforeSendThrewWarned) {
            beforeSendThrewWarned = true;
            log.warn('beforeSend threw; dropping event to avoid sending unredacted data. Error type:', err instanceof Error ? err.name : typeof err);
        }
        return null;
    }
    if (returned === null) {
        log.debug(`Event "${kind}" dropped by beforeSend`);
        return null;
    }
    // Undefined = mutated in place and fell off the end, which in-place editing invites.
    const shaped = returned === undefined ? draft : returned;
    if (!isPlainBag(shaped) || !isPlainBag(shaped.autoProperties) || !isPlainBag(shaped.customProperties)) {
        if (!beforeSendMalformedWarned) {
            beforeSendMalformedWarned = true;
            log.warn('beforeSend returned a malformed event (expected the event, null, or nothing); dropping event to avoid sending unredacted data.');
        }
        return null;
    }
    const finalAuto = { ...shaped.autoProperties };
    PROTECTED_AUTO_PROPERTIES.forEach((key, i) => {
        finalAuto[key] = protectedValues[i];
    });
    return { autoProperties: finalAuto, customProperties: shaped.customProperties };
};
// The proto's `string.max_len = 1024` is enforced server-side as a *code-point* count, so
// truncating by UTF-8 bytes is strictly more conservative.
const MAX_STRING_BYTES = 1024;
const utf8ByteLength = (s) => new TextEncoder().encode(s).byteLength;
const truncateToBytes = (s, max) => {
    const bytes = new TextEncoder().encode(s);
    if (bytes.byteLength <= max) {
        return s;
    }
    // Step back from the cut to a UTF-8 leading byte (high two bits != 10).
    let cut = max;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
        cut--;
    }
    return new TextDecoder().decode(bytes.subarray(0, cut));
};
const makeStringValue = (raw) => {
    let value = raw;
    // length * 3 is a strict upper bound on UTF-8 bytes, so most strings skip the TextEncoder.
    if (raw.length * 3 > MAX_STRING_BYTES && utf8ByteLength(raw) > MAX_STRING_BYTES) {
        log.warn(`Property string exceeds ${MAX_STRING_BYTES} bytes, truncating`);
        value = truncateToBytes(raw, MAX_STRING_BYTES);
    }
    return create(PropertyValueSchema, { value: { case: 'stringValue', value } });
};
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
 *   - object/array   → JSON.stringify → stringValue (subject to truncation);
 *                      circular structures and toJSON returning undefined dropped
 *   - null/undefined → dropped (no oneof case fits)
 */
const jsValueToPropertyValue = (v) => {
    if (v === null || v === undefined) {
        return null;
    }
    if (typeof v === 'string') {
        return makeStringValue(v);
    }
    if (typeof v === 'boolean') {
        return create(PropertyValueSchema, { value: { case: 'boolValue', value: v } });
    }
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) {
            return null;
        }
        if (Number.isSafeInteger(v)) {
            return create(PropertyValueSchema, { value: { case: 'intValue', value: BigInt(v) } });
        }
        return create(PropertyValueSchema, { value: { case: 'doubleValue', value: v } });
    }
    if (typeof v === 'bigint') {
        return create(PropertyValueSchema, { value: { case: 'intValue', value: v } });
    }
    if (v instanceof Date) {
        const ms = v.getTime();
        if (!Number.isFinite(ms)) {
            return null;
        }
        return create(PropertyValueSchema, { value: { case: 'timestampValue', value: timestampFromMs(ms) } });
    }
    if (typeof v === 'object') {
        let json;
        try {
            json = JSON.stringify(v);
        }
        catch {
            return null;
        }
        if (json === undefined) {
            return null;
        }
        return makeStringValue(json);
    }
    return null;
};
const mapPropsViaHeuristic = (source, customProperties, kind) => {
    for (const [k, v] of Object.entries(source)) {
        const pv = jsValueToPropertyValue(v);
        if (pv) {
            customProperties[k] = pv;
        }
        else if (v !== null && v !== undefined) {
            log.warn(`Property "${k}" on event "${kind}" not representable (${typeof v}), skipping`);
        }
    }
};
// Lives here, not in events/page_view.ts: `toEvent` gates $pageTitle on it, and core importing a
// tracker module breaks every test that vi.mocks it.
export const eventPageView = 'page_view';
export const toEvent = (projectId, kind, identity, props, opts) => {
    // Built plain, hooked, then converted — so beforeSend sees values, not PropertyValue oneofs.
    const rawAutoProperties = {
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
    };
    const shaped = applyBeforeSend(kind, rawAutoProperties, { ...props });
    if (!shaped) {
        return null;
    }
    const autoProperties = {};
    mapPropsViaHeuristic(shaped.autoProperties, autoProperties, kind);
    const customProperties = {};
    mapPropsViaHeuristic(shaped.customProperties, customProperties, kind);
    let event;
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
        });
    }
    catch (err) {
        log.error(`Event "${kind}" dropped: failed to create Event proto:`, err);
        return null;
    }
    return event;
};
