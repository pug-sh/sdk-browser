# `profile.ts` — identity

Module-level state, no classes. Anonymous profile IDs persisted through the `PersistentStore` under
`__pug_<projectId>_profile__`. Anonymous IDs are prefixed `"anon-"` (required by the server for merge
operations).

---

## `configureProfile` and the reserved-prefix rejection

Restores any persisted `externalId` from a previous `identify()` — **rejecting and removing** one that
starts with a reserved prefix (`cookieless-` or `crawler-`, matched by `reservedPrefixOf`, shared with
`identify()`'s input check).

A device poisoned by an older SDK would otherwise replay it as `distinctId` forever and have **every
event dropped** by the server. Mirrors `getAnonymousId()`'s `anon-` validation.

The re-write that refreshes a cookie-backed store's expiry happens **only when `isGranted()`** — called
bare, with no fail-open coalesce, since the head guard has already rejected a non-function gate. The
restore-into-memory always happens, since it only feeds the consent-gated `track()` / `identify()`.

## Why `identify()` requires `isGranted()`, not `isTracking()`

It drops in cookieless mode — at `log.warn`, **once per `init()`**, rather than `log.debug`:
`isTrackingEnabled()` returns `true` in cookieless, so

```js
if (isTrackingEnabled()) await identify(id)
```

takes the branch and identifies nobody. A debug-gated message is invisible to exactly the integrator
debugging that.

## The reserved prefixes on input

`identify()` rejects an `externalId` starting with `cookieless-` or `crawler-`, the prefixes of the ids
the server derives for cookieless and `crawler_request` events. The server's Identify refuses them too
(`external_id.reserved_prefix`, `external_id.reserved_crawler_prefix`) before `markIdentified()` stores
anything, so this check only fails fast, with a message naming the prefix.

## `clearProfile()` vs `destroyProfile()`

`clearProfile()` clears storage (both anonymous and external ID) and resets identified state, logging an
error per key whose removal cannot be confirmed — an unremoved shared cookie would resurface the
identity — and returns a **boolean** so `setTrackingConsent` can surface a teardown that did not land
instead of leaving it console-only.

`destroyProfile()` resets module state but, like `destroySession()`, leaves persisted identity in place:
a runtime teardown must not wipe the shared cross-subdomain cookie for every sibling subdomain.

`isIdentified()` is derived from `externalId` being non-empty — no separate flag.
