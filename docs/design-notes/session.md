# `session.ts` — sessions and the tab registry

Module-level state, no classes. Sessions are lazily initialized on the first `resolveSessionId()` and
persisted through the `PersistentStore` under `__pug_<projectId>_session__`. Expiry is evaluated
lazily on each call — no timers. Cross-tab sync is re-reading storage on every call.

---

## The activity-persist throttle

`resolveSessionId()` persists on every event in origin-scoped mode (localStorage is cheap). In
cross-subdomain mode the `lastActivityTime` write is throttled (`ACTIVITY_PERSIST_THROTTLE_MS`, 10s)
so the shared cookie is not rewritten on every event. In-memory state stays exact, and session-id
changes (`rotate()`, `resetIdentity()`) still persist immediately.

**The throttle clock (`lastPersistMs`) advances only on a persist that actually lands**, so a dropped
cookie write leaves it stale and is retried on the next event rather than suppressed for the window.

## Why `rotate()` and `resetIdentity()` are consent-gated

Both are public API — `rotate` via the barrel and `STUB_METHODS`, `resetIdentity` via `pug.reset()` —
and so reachable while cookieless or denied, where writing a fresh session/device id would plant
exactly the identifier those states promise not to store.

While not granted, `rotate()` rotates **in memory only** and `resetIdentity()` **clears rather than
writes** — `reset()` means "forget this user", and in those states there is nothing that should be
stored.

`resetIdentity()` returns a boolean and logs an error on a failed persist; both its failure arms log
and return rather than throwing, so `reset()` can aggregate the return value. A catch-only guard
reported success while the previous user's session and device id were still on the device.

## Why `configureSession` retains the gate at module scope

Consent became runtime-mutable with `setTrackingConsent`, so gating only at configure time would guard
*creation* while leaving `rotate()`, `resetIdentity()` and the registry unguarded.

Contrast `configureProfile`, which only needs the gate for its init-time refresh.

`resolveSessionId()`'s activity persist is **ungated**, and is safe only because `track()` branches on
consent before reaching it.

`configureSession` assigns `fallbackSessionId` *before* its head guard — see
[`tracking-consent.md`](tracking-consent.md#the-head-guards) for why.

---

## `onConsentGranted()`

Called by `setTrackingConsent` when entering `'granted'`. Re-arms the tab registry that
`configureSession` skipped while consent withheld it, **without** re-running the "all tabs closed →
rotate" heuristic — this tab is demonstrably alive, and running it would rotate a live session.

Without this the heuristic stayed dead for the page's life, and under the README's recommended
consent-first flow — `init()` before the banner is answered — it never armed at all.

## The tab registry

Per-tab heartbeats driving "all tabs closed → rotate on next init". Stays on raw `localStorage` and is
**skipped when `store.crossSubdomain` is true**: tab liveness is origin-local, so with a shared session
an `init()` on one subdomain with no live tabs there would wrongly rotate a session still active on a
sibling. In that mode sessions end by idle/max timeout only.

Also skipped while consent is not fully granted (it is a device write), and re-armed by
`onConsentGranted()` if consent arrives mid-page.

---

## `destroySession()` vs `clearSession()`

| | `destroySession()` | `clearSession()` |
|---|---|---|
| trigger | `pug.destroy()` | `optOutTracking()`, every non-granted transition |
| persisted session | **left in place** | removed |
| registry | this tab's entry only | **the whole registry** |
| `pagehide` reaper | removed | detached |
| module config | reset to defaults | left configured |

`destroySession()` is a runtime teardown, not a logout. In cross-subdomain mode removing the shared
cookie would end sessions site-wide from one page's teardown, so a later `init()` resumes it.

`clearSession()` returns a boolean (false when a removal could not be confirmed) and logs an error in
cross-subdomain mode, where an unremoved shared cookie would resurface the identity.

**Purging the whole registry is the privacy-teardown case** (a device wipe). Leaving it behind meant
the key survived the purge still carrying the `tabId → timestamp` pair written under granted consent,
and the still-attached reaper wrote to the device again on the way out — while the SDK advertised
storing nothing.

If no persistence layer is usable, sessions continue in memory only.

### <a id="registry-purge"></a>Why the purge derives its own key

A device wipe must not depend on this page having armed the registry. `armTabRegistry()` returns early
whenever consent withholds it — which is **exactly the state a purge runs in** — so keying the removal
on those handles made it a silent no-op that reported success. The purge derives the key instead; only
the entry-level path needs `tabId`.

### Why unavailable storage counts as released

When storage is unavailable at teardown time the skip leaves `released` true — treating
unavailable-for-writes as evidence-of-absence. A registry key written while storage *was* usable could
in principle survive unreachable.

Accepted, because a store that cannot be read cannot be verified either, and reporting false forever on
storageless devices would make every teardown boolean useless there. The registry holds per-tab
timestamps, never identifiers, and stale entries are pruned by their own idle timeout on the next arm.

### <a id="fail-closed"></a>The `?? false` in `mayWriteToDevice`

An absent gate reads as **withheld**, like everywhere else in the gate chain.

With the head guard in `configureSession`, a configured module always holds a real gate, so the
`?? false` covers only the unconfigured windows (before `configureSession`, after `destroySession`) —
where the two store-backed sites (`rotate`'s write, `resetIdentity`'s clear) are inert with `store`
null, and the registry site (raw `localStorage`, not the store) is unreachable because
`onConsentGranted()` bails without a configured `storageKey`.

**Defense in depth, not a live gate.** The fail-open `?? true` it replaced was the one place an untyped
caller's omitted argument silently wrote identity with full permission.

### Why `read()` distinguishes malformed from absent

Absent is the ordinary first visit — silent. Present-but-malformed must not share that silence: falling
through quietly rotated the session with no trace of why analytics saw a new one.

The value is omitted from both messages because a stored-session fragment (and a parse error's message)
can echo identity.
