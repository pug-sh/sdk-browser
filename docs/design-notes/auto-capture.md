# `auto-capture.ts` — listener selection

`autoCapture` supports `true` / `false` or an `AutoCaptureSelection` object. **Object mode is an
allowlist**: only keys set to `true` are enabled, omitted keys stay off.

---

## Why the values are typed `true | undefined`, not `boolean`

`{ scroll: false }` reads as "everything except scroll" but under an allowlist enables **nothing**.
Typed `true`, that misreading is a compile error rather than a silent loss of all capture.

The `| undefined` keeps the runtime-flag idiom (`scroll: flag || undefined`) compiling under
`exactOptionalPropertyTypes`, which ships in `@tsconfig/strictest`. It weakens nothing: `false` and a
`boolean`-typed value are still rejected.

`track-types.test-d.ts` pins the compile-time half — `pug.test.ts` reaches those shapes through
`as never` casts, so reverting the values to `boolean` would otherwise leave the whole suite green.

## Resolution and diagnostics are split

`resolveAutoCapture` is pure and runs on every reconcile. `validateAutoCapture` owns every warning and
is called from `setDesired` — **deliberately not from `reconcile`**, which only consults the selection
while tracking is active (granted or cookieless).

Validating there said nothing at all for the consent-first flows the README recommends — the diagnosis
arrived at `optInTracking()` time, in a user's browser — and then re-warned on every consent cycle.

Both treat the value as untrusted: the CDN one-tag install feeds it from `data-options` JSON.

## The allowlist warning fires on either spelling

Each loses capture the integrator believes they kept:

- **an explicit `false` anywhere** — reported even when the selection still enables something, since
  `{ pageView: true, scroll: false }` keeps page views while a check keyed only on a zero enabled count
  stays silent as click, form, rageClick and deadClick are lost
- **a selection that names trackers but enables none** — what a non-`true` value (`{ scroll: 'true' }`
  from a template, `{ scroll: 1 }` from a config store) or a misspelled key produces. There the
  `invalidKeys` / `unknownKeys` warning names the offending key but reads as "we ignored that one",
  understating a total loss.

Either way the message names **what the selection actually enables**, since that is what reveals the
loss.

Both are keyed on a *written-out* value, not on key count, so `{}` and the documented
`scroll: flag || undefined` idiom (with the flag false) stay silent: they embed no misconception.

## Consent gating

The controller owns the desired selection and gates listener attachment on an injected `isTracking`
getter, so listeners run in **cookieless mode too** and `setAutoCapture()` can be called before opt-in,
with the selection re-applied on `optInTracking()`.

`setAutoCapture()`'s "listeners activate after opt-in" debug message is keyed on `isTracking()` for the
same reason — on `isGranted()` it printed in cookieless mode, where they had already activated.

Runtime tracker cleanup is owned per tracker in a controller-local `Map`, so `setAutoCapture()` can
add/remove SDK-owned listeners after init without bloating `pug.ts`. Reconcile is idempotent:
already-enabled trackers that stay enabled are left untouched.
