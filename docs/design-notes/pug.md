# `pug.ts` — the entry point

Owns module state, `init()`, the public consent surface, and the teardown matrix.

---

## `track()` dispatches on consent as an allow-list

```
granted     -> ids
cookieless  -> identity-free
denied      -> drop
anything else -> drop + unreachable(consent)
```

**Not as a deny-check.** Written that way an unhandled state fell through to the full-identity arm, so
a fourth state would silently get full tracking plus persisted identifiers with neither the compiler
nor the suite objecting.

Widening `TrackingConsent` is a `TS2345` at the dispatch — the one place that must decide.

### Why `unreachable` doesn't throw

`unreachable` is a non-throwing `(_: never) => void`. Not because a throw could escape — the call is
inside `track()`'s own try/catch, which would swallow it — but because the `else` branch already logs
the offending state **by name**, and throwing would replace that with a generic message.

### The cookieless arm skips both resolvers

In `getConsent() === 'cookieless'`, `track()` skips `resolveSessionId()` / `resolveDistinctId()`
entirely and builds the event via `toEvent`'s `{ cookieless: true }` identity arm. `identify()` warns
once per `init()` and drops.

---

## `init()` ordering

1. Build the shared `PersistentStore` (from `crossSubdomainTracking` and `maxAgeDays`)
2. Create the tracking-consent controller — **before** `configureProfile`, so the latter's init-time
   identity-cookie expiry refresh can be gated on `isGranted`; no identity write while consent is denied
3. `configureSession`, `configureProfile`
4. Create the batched transport (which internally creates the RPC transport)
5. Create the auto-capture controller, then `setDesired()`

The controller-before-profile ordering is load-bearing, not incidental.

### Other init-time behavior

- Warns when `endpoint` is neither https nor localhost — events would cross the network in the clear.
- Gates `initUserAgentData()` on `isTracking()`: high-entropy client hints are not requested for a
  user who is not being tracked.
- Warns on a stale `sanitizeUrl` key. That option was **removed, not deprecated** (pre-1.0, and two
  overlapping hooks is worse than one break), and the migration cost is invisible to JS and one-tag
  installs, which get no compile error.

### Why UA hints re-warm on a *transition*, not on every consent change

`initUserAgentData()` clears the hint cache synchronously and refills it asynchronously. Called on
every consent change, a CMP re-asserting its state — or `optOutTracking()` under
`onReject: 'cookieless'`, where `isTracking()` stays true — would drop `$osVersion`/`$device` from
every event until the new request resolved.

---

## <a id="non-granted-init"></a>The non-granted init branch

When the resolved initial consent is not `'granted'`, `init()`:

- **always** purges the queued events (`transport.purgeQueue({ send: false })`)
- **when `isAuthoritative()`**, runs the same identity purge `setTrackingConsent` does

These are **branches, not a purge plus a conditional second one**. `purgePersistedIdentity()` drops
the queue as its own first step, so calling both made one fault report three times.

They are split deliberately: the queue is an outbound buffer, not an identifier anything reads back,
so purging it can never mint a new identity and `isAuthoritative()`'s reasoning does not transfer to
it.

Folding them together left a prior consented visit's identified payloads on the device through every
non-authoritative non-granted init — any config omitting `persist: true`: a bare `'denied'` /
`'cookieless'` string, or the `{ initial, persist: false }` form in `examples/cdn/index.html`. Those
would be transmitted on the next pagehide while consent read `'denied'`, and re-persisted while it read
`'cookieless'`.

So entering a non-granted state **via config** and **via transition** converge. Otherwise a visitor
whose CMP now says "reject" would keep a prior consented visit's 365-day identifiers, and the
documented "granting later mints a fresh identity" would be false — a later grant would resolve the
*pre-existing* session and anonymous ID.

### Why the non-authoritative branch logs at debug *and* warns

It explains itself at `log.debug` because it runs on **every** default install as a no-op (the
`'cookieless'` seed is non-granted and non-authoritative) — which is also why that message could never
reach the case it exists for, `log.debug` being off by default.

So it **additionally warns when `isIdentified()`**: a previous `identify()`'s `externalId` really is
being kept on the device under a state the integrator spelled as non-granted —
`init({ trackingConsent: 'denied' })` as a bare string on a returning identified visitor.
`configureProfile` has already restored it by then, so the check costs nothing and separates the
reachable harm from the no-op the level was chosen for.

---

## <a id="consent-transitions"></a>Consent transitions

`setTrackingConsent(state)` wraps `set()` with side effects, **consent effects first**:

- entering `'granted'` → re-arm the tab registry (`onConsentGranted()`)
- entering any non-granted state → identity teardown (`clearProfile()` + `clearSession()`)

The identity removals are required when leaving `'granted'`, and idempotent **in end state** from any
other state — though not side-effect-free: they still issue removals, which are cookie deletions in
cross-subdomain mode, and may log on an unconfirmed one.

Auto-capture reconciles only **after** the consent effects, matching `init()`'s order. Defense in
depth now, since no consent-reducing transition arms a tracker — but if the drop predicate ever
loosens, purging after `apply()` would destroy the newly-armed tracker's synchronous `page_view`.

### <a id="dropqueue"></a>The `dropQueue` predicate

```
dropQueue = resolved === 'denied' || wasGranted
```

The queue drop is **not idempotent-in-effect** and is scoped tighter than the identity teardown. It
runs when the transition actually **reduces** consent:

- leaving `'granted'` — the consented queue holds identified payloads the user just withdrew consent for
- landing on `'denied'` — a kept cookieless queue would be beaconed by the next pagehide, i.e.
  transmission after a full reject

It does **not** run on a re-assert of an unchanged non-granted state, where a CMP restating
`'cookieless'` on every load used to destroy the identity-free cookieless queue unsent — the pre-banner
`page_view` of every mid-page session, under the cookieless default — while a granted→granted
re-assert kept its queue untouched.

Both halves are pinned against the real modules in `cookieless-storage.test.ts`. Before the granted one
existed, making granted→granted run the purge passed the entire suite.

### What survives a teardown

The queue survives only a transition that reduces nothing: a re-assert of an unchanged cookieless state
(identity-free events by construction), or a `'denied'` → `'cookieless'` thaw, where the entry to
`'denied'` already emptied it.

---

## The teardown matrix

| entry point | identity | queue | registry | consent record |
|---|---|---|---|---|
| `reset()` | cleared | `purgeQueue({ send: true })` | left | left |
| `optOutTracking()` | cleared | dropped iff `dropQueue` | cleared | **kept** (device-level) |
| non-granted transition | cleared | dropped iff `dropQueue` | cleared | kept |
| `destroy()` | left | transport destroyed | this tab's entry | kept |

`reset()` is the only `send: true` — a logout leaves consent untouched, and on a shared device the next
user must not inherit the previous one's queued events, whose `distinctId` is their `externalId` after
`identify()`.

`destroy()` releases runtime resources without clearing persisted identity (that is `reset()`'s job),
so a subsequent `init()` resumes the same session and profile.

## Booleans, so failures reach the caller

`reset()`, `setTrackingConsent`, `optInTracking`, `optOutTracking` and `resetIdentity()` all return
booleans. False means: the state was unrecognized (consent then fails closed to `'denied'`), the choice
could not be persisted, or an identifier could not be removed.

After `init()` the state is always applied in memory when valid, so **false never means "nothing
happened"**. Before `init()` it does: all three warn and return false having applied nothing, and a
banner racing initialization is the likeliest way to hit it.

The automation bail (`excludeAutomatedBrowsers`, see [utils.md](utils.md#automation)) is the second
and last case where false really is "ignored": `init()` returns having built no state on purpose, so
these behave exactly as they do before `init()`. They report it as automation rather than as a
missing `init()` — see `reportNoState` — but the return value cannot distinguish the two, which is
why the bail itself warns.

---

## <a id="purge-reporting"></a>Queue purge reporting

`purgeQueuedEvents({ send })` warns about the **destruction**, keyed on `destroyed > 0` and
`send: false`:

- a purge that discards nothing is the common case
- `reset()` beacons first
- a purge that could not remove the persisted key destroyed nothing *there* — those events hydrate and
  send on the next `init()`, so claiming destruction would contradict, at a lower level, the error
  `purge()` logged one line earlier saying they may still be sent

It adds **no message about the failure**: a surviving queue key is reported by the queue's own
`purge()` with the cause in hand, and a dropped farewell beacon by `reportBeaconLoss`. Anything here
would guess at both.

The message says the events *may* include identified payloads rather than asserting it, since on the
ordinary `'cookieless'` → `'denied'` transition every one of them is identity-free. The reason it gives
is what the events **are** — identified payloads from an earlier granted visit — not "consent forbids a
queue", which is false under the `'cookieless'` default.

---

## What is outside the retention bound

The batch queue and the tab registry intentionally stay on raw `localStorage` (origin-local, too
chatty/large for a header-bearing channel), which also puts them **outside** `maxAgeDays`, since the
deadline rides the store.

Neither is a path identity survives a withdrawal on: the registry is cleared by every consent teardown,
and the queue by every teardown that reduces consent.

A queue that cannot reach the network is bounded by `batch.maxQueueSize`, not by `maxAgeDays`, and its
events carry `sessionId` and `distinctId`.

**`pug_device_id` is outside it too, and unlike those two is cleared by no teardown at all.** Latent
today — only the (now deleted) push module wrote it — but `identify()` still reads it.

Closing that gap properly means extracting the envelope as a decorator over raw storage so the queue
and registry can take it without acquiring a cookie layer. The stated reasons for their bypass are all
arguments about the *cookie channel*, none about expiry.
