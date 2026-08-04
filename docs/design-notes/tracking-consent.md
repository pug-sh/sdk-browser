# `tracking-consent.ts` — the consent model

Owns `TrackingConsent`: `'granted' | 'denied' | 'cookieless'`.

---

## Why there is a third state

`'cookieless'` is the middle state for GDPR/DPDP reject-analytics-cookies flows: events keep flowing
(with `cookieless: true` and no identity — the backend derives a daily-rotating id) while the SDK
writes **no identifiers** to the device.

The one deliberate exception is the consent record itself under `persist: true` — a strictly-necessary
record of the user's refusal. Pinned by a case in `cookieless-storage.test.ts` so it stays deliberate
and the docs cannot drift from it.

## Why the default seed is `'cookieless'`, not `'granted'`

An install that never configures consent collects events but writes no identifier before the user has
answered. The worst an unconfigured install can do is collect *too little*.

Pinned by the first case in `cookieless-storage.test.ts`, which asserts a bare `init()` writes nothing
to the device at all.

---

## <a id="the-two-gates"></a>The two gates, and why they are branded

The controller exposes two deliberately different predicates:

| gate | means | guards |
|---|---|---|
| `isGranted()` | full consent only | identity-storage writes: `configureProfile`'s expiry refresh, `rotate()`, `resetIdentity()`, the tab registry |
| `isTracking()` | granted **or** cookieless | automatic listener attachment; answers `isTrackingEnabled()` |

`isTracking()` gates **neither** `track()` nor `identify()`. `identify()` requires `isGranted()`, and
`track()` branches on `getConsent()` directly because it needs all three states.

Conflating them is exactly the bug the split prevents.

### The brand

Both are `() => boolean` and **were** injected positionally into optional parameters, so passing the
wrong one compiled silently. One such swap — `configureProfile` receiving `isTracking`, which
re-writes a durable `externalId` to the device in cookieless mode — was invisible to types *and* to
all tests, because the guarded branch only runs for a returning visitor who previously called
`identify()`.

`GrantedGate` / `TrackingGate` are `(() => boolean) & { readonly __gate: K }`. The phantom member is
**required**, and all three `isGranted` parameters are positionally required too.

It was optional "so tests and non-`init()` callers could pass a bare `() => boolean`" — but
`src/*.test.ts` is excluded from `tsconfig.typecheck` and vitest transpiles without checking, so
tests were never typechecked either way, and there are no non-`init()` production callers.
Optionality only let the brand be laundered (`const f: () => boolean = isTracking`, or a
`() => isTracking()` wrapper).

Making the *parameters* required matters separately: omission was invisible to types, and
`mayWriteToDevice()` **defaulted to permitted** when the gate was absent, so an omitted argument
silently wrote identity with full permission. It now fails closed (`?? false`).

### The head guards

Each gated factory throws a `TypeError` at the head on a non-function gate. At the head because:

- an unguarded `createCookieLayer` reached `reconcileTwin`'s try with the live twin **already
  expired**, destroying its value;
- `configureSession` assigns `fallbackSessionId` *before* its guard for the same class of reason —
  thrown first, `resolveSessionId()` returned `''` and every event carried an empty `sessionId`,
  which the proto's `string.uuid` rule rejects as `InvalidArgument`, classified permanent, so whole
  batches are committed and dropped.

`init()` catches all three and routes them through `reportInitFailure`, which reports a `TypeError`
at `log.error` naming it a **wiring error** rather than at `log.warn` alongside genuine environment
failures — otherwise the guards whose whole purpose is to fail loud arrived as a warn that reads like
a blocked cookie store while the SDK ran on with no session or profile persistence.

A runtime guard still reaches no typed caller, which is why `consent-gate.test-d.ts` also pins the
*arity*: reverting any one parameter to optional changes no runtime behavior, so nothing else in the
build objects — and that is the silent-revert shape the pin closes.

### <a id="containment"></a>The containment scan is a speed bump, not a proof

`deferredGrantedGate` in `tracking-consent.ts` is the one place that mints a gate, so the
`as GrantedGate` cast stays out of shipped code. Three specs enforce it:

- `consent-gate.test-utils.ts` holds the one test-side mint
- `test-utils-imports.test.ts` fails the suite on any shipped import of a test-utils file
- `consent-gate-containment.test.ts` fails it on any mint in a shipped module other than the owner

A source-text rule is only as good as its evasions are closed, so it matches **four spellings**, each
a way around the one before:

1. the `as` cast
2. the angle-bracket cast `<GrantedGate>fn`
3. the phantom `__gate` supplied directly
4. **aliasing the brand at the import** (`GrantedGate as GG`), which renames it out of all three

A fifth evasion needs no cast at all — `deferredGrantedGate` is exported, so any module could call it
with its own `() => controller`. A second rule restricts that call to `pug.ts` plus the owning module,
and carries **two** patterns for the same reason: the bare call and the call aliased at the import
(`deferredGrantedGate as mint`).

The generic `ConsentGate<K>` is deliberately **not exported**: exported, a module could write
`type Gate = ConsentGate<'granted'>` and then `fn as Gate`, which no rule matches. Un-exporting makes
that route a compile error rather than a scan miss.

Each pattern carries its own canary asserting it still matches the evasion it names, since a rule that
quietly stops matching leaves the scan green with its hole reopened.

**Two evasions stay open by construction** — borrowing a controller's own gate
(`createTrackingConsent(...).isGranted`) and deriving the type without naming the brand
(`ReturnType<typeof createTrackingConsent>['isGranted']`) — because both produce a *genuinely*
branded gate with nothing to grep for. What contains those is that both entry points are internal
(absent from `index.ts`), so a new call site is a reviewable addition rather than something a consumer
can reach.

The phantom member is a plain property a deliberate `Object.assign` can mint. No brand prevents that;
this one exists to catch **accidental** swaps.

---

## `set()` fails closed

An out-of-domain value falls back to `'denied'` and logs `log.error`, matching the init-time posture
rather than keeping the previous state. Keeping it meant a CMP passing `'reject'` / `'opt-out'` /
`null` left a `'granted'` user fully tracked while `isTrackingEnabled()` confirmed the wrong state.

`optIn()` is sugar for `set('granted')`. `optOut()` applies `getRejectState()` — the `onReject` config
(`'denied' | 'cookieless'`, default `'denied'`), which lets a banner's reject branch keep identity-free
counts without naming `'cookieless'` itself.

`onReject` is validated separately from `initial` and cannot be `'granted'` — that would invert the
control. `setTrackingConsent('denied')` is unaffected; it always means literally denied, so only
`optOutTracking()` is redirected.

## Derived unions, so predicates cannot drift

`TrackingConsent` is derived from a `CONSENT_STATES` const array. Written separately, `isConsent`
still compiled against a widened union while advertising `value is TrackingConsent`, so a new state
was un-settable and reported as invalid input.

`KNOWN_CONSENT_KEYS` is derived from a `satisfies Record<keyof TrackingConsentConfig, true>` map for
the same reason: written separately, adding a legal member made valid typed configs fail closed to
`'denied'`.

**Unrecognized config keys warn and fail closed to `'denied'`** — an unknown key leaves the seed
undefined, so it would otherwise fall through to the default silently. TypeScript catches that for npm
consumers, but the one-tag install supplies this as untyped `data-options` JSON, which is also what
made the `default` → `initial` rename safe (`default` is a reserved word and could not be
destructured).

---

## `isPending()` vs `isAuthoritative()`

`isPending()` reports whether the user has actually **answered** (a restored choice or any `set()`,
including the fail-closed path) rather than the state being a seed. It backs the public
`isConsentPending()`, the consent-banner gate.

It is deliberately **not** `isAuthoritative()`, which additionally requires durability because it
gates *destroying* identity, whereas `isPending()` only reports.

### The `isAuthoritative()` formula

```
gpcApplied || (persist && restoredFromStorage)
```

Neither half of the storage conjunct is optional:

- **Without persistence** the initial value is the integrator's pre-banner placeholder (typically a
  static `'denied'` corrected by a later `optInTracking()`), so purging on it would mint a new
  identity on every page load.
- **`persist` alone is not enough**, because nothing is written until an explicit `set()`. On a site
  adding `{ initial: 'denied', persist: true }` to an existing deployment, every returning visitor's
  first load finds an empty consent key, falls back to the seed, and would purge identity those users
  never asked to have deleted — once, for the whole user base, on deploy day.

The `persist` conjunct is **redundant** given the storage half (`store` is null unless `persist`, and
`restoredFromStorage` is only set inside `if (store)`). It is kept to state the invariant locally
rather than rely on that derivation. No test can distinguish it; dropping it leaves the suite green.

GPC counts as authoritative because it is equally durable — the browser re-asserts it on every load.

---

## GPC precedence

`respectGpc` (default false) honors `navigator.globalPrivacyControl`, read once per `init()`. A
throwing getter (a privacy extension) logs at `log.warn` — which every install sees — and reads as
absent: the signal is an opt-out, so failing to read it must not be silent.

Precedence is **seed → GPC → a choice made on this site**. GPC outranks the config seed (it is the
user's own standing preference, not the integrator's placeholder) but yields to a restored or
explicitly `set()` value, without which an accept click would be re-overridden on the next load and
the banner would loop.

### `respectGpc` without `persist` warns

The "a choice on this site outranks GPC" half needs somewhere to record that choice. Without one, GPC
re-resolves on every load, so `isPending()` stays false (the banner never shows) and a later
`optInTracking()` cannot outlive the page — **the user is left with no way to accept.**

The warning fires only when the signal actually resolved consent, so the common `respectGpc: true` +
no-GPC-visitor case stays quiet.

---

## `write()` writes first, then restarts the retention window

The carried-forward deadline is right for every other key, but would leave a user who opted out on day
1 and back in on day 360 with a record lapsing in five days. So on a value change with a previous
record present, `write()` does remove + rewrite.

**Write-first because this is the one record that must not fail open:** removing first meant a remove
that landed plus a set that failed left *no* record, and the next `init()` fell back to the config seed
— a recorded `'denied'` becoming a more permissive placeholder.

- A remove that fails logs and keeps the old deadline (early lapse, the safe direction).
- The narrow remove-landed-then-rewrite-failed sequence logs at error.

The previous-record half of the guard (`persistedValue !== null`) exempts the first-ever persist, whose
initial write just stamped a fresh window: the restart there was two wasted storage cycles, a spurious
"could not clear the previous consent record" on a device with no previous record, and a pointless walk
through the one sequence write-first cannot save.

Guarded on the value differing, or a CMP re-asserting its state would slide the clock on every callback.

## Legacy consent records are adopted, not deleted

The restore reads with `getItemOrLegacy(key)`: a bare pre-envelope record from an older build is handed
back (still removed from the device) rather than deleted unread. `isConsent()` decides whether it was a
recorded choice or corruption.

An adopted value flows through the ordinary restore arm — `restoredFromStorage`/`decided` set, so
`isAuthoritative()` honors it and `init()`'s identity purge runs for a recorded opt-out — with the
refresh write re-enveloping it under a fresh deadline (its original stamp date is unknowable).
Corruption falls to the existing "invalid, ignoring" warn with the device already clean.

---

## The three public getters answer different questions

Before `init()`:

| getter | returns | why |
|---|---|---|
| `isTrackingEnabled()` | `false` | accurate — nothing is being tracked yet |
| `isConsentPending()` | `true` | accurate — no storage has been read |
| `getTrackingConsent()` | `undefined` | **not** `'denied'` |

`getTrackingConsent()` returns `undefined` because a persisted choice is only read from storage inside
`createTrackingConsent` during `init()`. Reporting `'denied'` was indistinguishable from a real
opt-out, and a consent banner gated on it would re-prompt a user who had already opted in.

**After `init()` the same trap survives in a second form**, which is why `isConsentPending()` exists:
`getTrackingConsent()` then reports the state being *acted on*, and before any answer that is the
`initial` seed. So a seeded state and a chosen one are the same value — with the `'cookieless'`
default, a visitor who has answered nothing and one who chose "reject analytics cookies" read
identically.

On the CDN path there is a third layer: calls queued before the bundle loads return `undefined`
regardless, which is what `ready(cb)` exists to solve.
