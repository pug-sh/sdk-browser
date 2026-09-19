import { type Event } from './gen/sdk/events/v1/events_pb.js';
import type { PropValue, TrackOptions, WellKnownEventName } from './well-known-events.js';
export type { JsonValue, PropValue, TrackEventProps, TrackFn, TrackOptions, WellKnownEventName, WellKnownEventPropsMap, } from './well-known-events.js';
/** Plain-JS view of an event, before protobuf conversion. Mutate the bags in place — they are
 * readonly because replacing one and returning nothing would send the un-redacted original. */
export type BeforeSendEvent = {
    readonly kind: WellKnownEventName | (string & {});
    readonly autoProperties: Record<string, string>;
    readonly customProperties: Record<string, PropValue>;
};
/** Return the event to send it, `null` to drop it, or nothing to keep in-place mutations. */
export type BeforeSendFn = (event: BeforeSendEvent) => BeforeSendEvent | null | void;
/** Wired from `init({ beforeSend })`; `undefined` clears it. Fails closed like the URL sanitizer:
 * a non-function drops every event rather than sending data the caller thought was scrubbed. */
export declare const configureBeforeSend: (fn?: BeforeSendFn) => void;
export declare const eventPageView = "page_view";
/**
 * A closed choice: either the server derives identity (cookieless — the flag and NO ids, which the
 * backend enforces at validation) or the caller supplies both ids.
 *
 * The `?: never` members are what close it. Without them the arms share no property, so there is no
 * discriminant, and excess-property checking against a union accepts anything present in *any*
 * constituent — so every spelling of "cookieless with ids" compiled, including the spread and
 * variable forms an explicit literal tag would still admit. Pinned by event-identity.test-d.ts.
 */
export type EventIdentity = {
    readonly cookieless: true;
    readonly sessionId?: never;
    readonly distinctId?: never;
} | {
    readonly cookieless?: never;
    readonly sessionId: string;
    readonly distinctId: string;
};
export declare const toEvent: (projectId: string, kind: string, identity: EventIdentity, props?: Record<string, unknown>, opts?: TrackOptions) => Event | null;
