# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

> **Where the reasoning lives.** This file is a map: what each module is, what its invariants are,
> and where to read further. The *why* — the bug that motivated a mechanism, what was measured, which
> options were rejected — lives in [`docs/design-notes/`](docs/design-notes/README.md).
>
> Before changing anything non-obvious in `cookie.ts`, `persistence.ts`, `tracking-consent.ts`,
> `batch.ts` or `pug.ts`, read that module's design note. Much of what looks redundant in those files
> is load-bearing, and the note says why.

## Project Overview

Pug Web SDK (`pug-web`) is a browser-side analytics/event-tracking library in TypeScript. It
auto-captures page views, clicks, scrolls, form interactions and frustration signals (rage clicks,
dead clicks), then sends them through a hand-rolled `fetch` transport speaking the Connect protocol
(binary protobuf) to a backend via `BatchCreate` RPCs.

The Connect runtime (`@connectrpc/*`) and client-side protobuf validation (`@bufbuild/protovalidate`)
were deliberately removed to shrink the published bundle. Only `@bufbuild/protobuf` (proto
codec/reflection) and `uuidv7` remain as runtime deps.

## Build & Development Commands

```bash
bun install            # Install dependencies
bun run build          # Stamp src/version.ts, compile to dist/ with tsc, bundle the CDN IIFE
bun run watch          # Watch-mode TypeScript compilation
bun run dev            # Watch TypeScript + serve on port 3000
bun run serve          # Serve static files on port 3000
bun run lint           # Lint & auto-fix with Biome (biome check --write .)
bun run format         # Format source files with Biome
bun run knip           # Find unused files, exports & dependencies (knip.jsonc)
bun run typecheck      # Typecheck src + type-level tests (tsc -p tsconfig.typecheck.json)
bun run test           # Run tests once (vitest run)
bun run test:watch     # Run tests in watch mode
```

**Manual testing:** after building, `bun run serve` and open `http://localhost:3000`.

**Dead-code gate:** `bun run knip` runs in CI and is expected to stay at zero findings. Biome's
linter is disabled, so knip is the only thing catching an export nothing imports or a file nothing
reaches. Its config (`knip.jsonc`) carries the entry points tooling cannot infer — `src/cdn.ts` and the
three hand-run `scripts/*.mjs` — and three `ignoreDependencies` that are real but invisible to it
(knip does not resolve binaries invoked through `bun`, and does not read `buf.gen.yaml`). The
scripts are listed one by one on purpose: a glob would mark the library modules under `scripts/`
as entries and exempt their exports. `--treat-config-hints-as-errors` fails CI on a stale ignore.
Prefer deleting dead code over widening the ignores.

**Use `bun run test`, not `bun test`** — the latter invokes Bun's built-in runner instead of Vitest.
Verify by **exit code**, not by the printed summary: vitest can print "747 passed" and still exit 1 on
an unhandled rejection.

## Test Layout

Specs live alongside source as `src/*.test.ts` (Vitest, jsdom).

**Shared helpers** — `src/*.test-utils.ts`:

- `storage-envelope.test-utils.ts` — wrappers over the retention envelope, so storage-asserting suites
  stop hand-rolling `<expiry>|<value>`.
- `consent-gate.test-utils.ts` — the `GRANTED`/`DENIED` gate values, keeping the one `as GrantedGate`
  cast in a single place. Its only import is `import type`, so it adds no runtime edge to suites using
  `vi.resetModules()`.

These are excluded from `tsconfig.json` so the build does not compile them. `exclude` only prunes
*roots* — a production module importing one pulls it back in and emits it to `dist/`, so **nothing
under `src/` outside tests may import them**, enforced by `test-utils-imports.test.ts`. They *are*
included in `tsconfig.typecheck.json`, since vitest transpiles without checking and that is the only
thing typechecking them.

**Type-level tests** — `src/*.test-d.ts`, checked by `bun run typecheck` and CI (with
`exactOptionalPropertyTypes` on), never run and never emitted. They exist for assertions no runtime
test can make: that some code **fails** to compile. Each `@ts-expect-error` is the guard, and it fails
in the right direction — if the expected error stops happening, tsc reports the unused directive
(TS2578).

| file | pins |
|---|---|
| `track-types.test-d.ts` | `TrackFn` as one generic signature, not overloads |
| `event-identity.test-d.ts` | `EventIdentity`'s `?: never` members — four spellings of "cookieless event carrying identity" |
| `before-send-types.test-d.ts` | `BeforeSendFn`/`BeforeSendEvent`: README idioms compile, bag reassignment doesn't, return stays `\| void` |
| `init-options.test-d.ts` | the `\| undefined` spelling of every optional `InitOptions` member |
| `consent-gate.test-d.ts` | the `ConsentGate` brands and the arity of all three gated factories |
| `cross-subdomain-types.test-d.ts` | `CrossSubdomainConfig`'s required `domain` and `maxAgeDays?: never` |

See the design notes for why each exists — every one closes a silent-revert.

---

## Architecture

### `src/pug.ts` — entry point → [design note](docs/design-notes/pug.md)

Exports `init`, `track`, `identify`, `reset`, `destroy`, `setAutoCapture`, `setTrackingConsent`,
`optInTracking`, `optOutTracking`, `isTrackingEnabled`, `getTrackingConsent`, `isConsentPending`.

A single nullable module-scoped `state` object enforces single initialization.

**Invariants:**

- `init()` returns early on an automated browser (`isAutomatedBrowser()`), after the log-only
  validators but before any listener, storage write or network call — and **only** under
  `excludeAutomatedBrowsers: true`. The default tracks automation like any other traffic, matching
  the platform's tag-never-drop rule. The validators run first on purpose: the automated browser is
  CI, where a config mistake is likeliest to be read. The bail warns once (a larger drop than
  `dryRun`, which warns) and latches `setAutomationSuppressed`.
- **Every** no-state branch reports through `reportNoState`, so none of them claims "called before
  init()" after a suppressed init — including `rotate()` in `session.ts`, which reads the same latch.
  The latch lives in `utils.ts` because `session.ts` cannot import `pug.ts` without a cycle, and
  `destroy()` clears it (plus `setDebugLogging(false)`) on its no-state path — a suppressed `init()`
  is the one way to reach `destroy()` with debug logging on and no state.
- `track()` dispatches on consent as an **allow-list**, never a deny-check. Widening
  `TrackingConsent` must be a `TS2345` at that dispatch.
- `init()` creates the consent controller **before** `configureProfile`, so the latter's expiry
  refresh can be gated.
- Consent effects run **before** auto-capture reconciles, matching `init()`'s order.
- `track()` and `identify()` **must never throw** — see Design Invariants below.
- The public booleans (`reset`, `setTrackingConsent`, `optInTracking`, `optOutTracking`) mean "did it
  fully land", and after `init()` false never means "nothing happened" — with one exception, the
  automation bail above, where `init()` returns having deliberately built nothing.

### `src/tracking-consent.ts` — consent state → [design note](docs/design-notes/tracking-consent.md)

`TrackingConsent` is `'granted' | 'denied' | 'cookieless'`, **derived** from a `CONSENT_STATES` const
array so `isConsent` cannot drift. Default seed is **`'cookieless'`**: collect, but write nothing to
the device until the user has answered.

**Invariants:**

- Two gates, deliberately different: `isGranted()` (identity writes) and `isTracking()` (listener
  attachment). Conflating them is the bug the split prevents.
- Both are **nominally branded** and all three `isGranted` parameters are positionally required. Each
  gated factory throws a `TypeError` at its head on a non-function gate.
- Unrecognized config keys and out-of-domain values **fail closed to `'denied'`** and log `log.error`.
- `isPending()` (has the user answered?) is not `isAuthoritative()` (may we destroy identity?).
- The consent record under `persist: true` is the one deliberate device write in cookieless mode.

### `src/persistence.ts` — layered storage → [design note](docs/design-notes/persistence.md)

`createPersistentStore(cookieLayer, maxAgeDays?)` layers an optional cookie over `localStorage`.
Returns null only when both layers are unusable. Methods never throw.

**Invariants:**

- Reads prefer the cookie; a stale per-origin `localStorage` value must not shadow it.
- Every value carries an absolute expiry, so nothing outlives `maxAgeDays` (default 365) in any mode.
- The deadline is stamped at the **first** write and carried forward, **clamped** to `now + maxAgeMs` —
  refreshes cannot extend retention, and lowering `maxAgeDays` reaches existing visitors.
- `getItem` **deletes** (not ignores) anything expired or undecodable. `getItemOrLegacy` is the one
  opt-out, for the consent record only.
- **Every once-per-key latch is released once its key's residue is verifiably gone.** A latch may
  report once per episode; it must never outlive the fact it describes.

### `src/cookie.ts` — cross-subdomain identity → [design note](docs/design-notes/cookie.md)

`createCookieLayer(config, isGranted, doc?)`. **Off by default** — cross-subdomain identity relaxes
same-origin isolation to same-site, so it is an explicit per-integrator opt-in, never inferred.

**Invariants:**

- Only a literal `true` reaches the domain probe; an object must carry a non-empty string `domain`.
  Enforced at runtime too, because the one-tag install supplies untyped JSON.
- Every cookie write states a lifetime the store computed; `set`'s `maxAgeSeconds` is **required** and
  never defaulted.
- `set`'s `value` is the branded `StoredEnvelope` — the layer stores only enveloped strings.
- Only the twin **promotion** is consent-gated; the deletions before it are not.
- **Not covered:** a custom multi-tenant registrable domain absent from the Public Suffix List. Such
  deployments must pass an explicit `{ domain }`. The public JSDoc warns integrators.

### `src/session.ts` — sessions → [design note](docs/design-notes/session.md)

Module-level state, lazily initialized, expiry evaluated per call (no timers), cross-tab sync by
re-reading storage.

- `resolveSessionId()` — called on every allowed non-cookieless event.
- `rotate()` / `resetIdentity()` — **consent-gated**; while not granted they rotate in memory and clear
  rather than write.
- `onConsentGranted()` — re-arms the tab registry without re-running the "all tabs closed → rotate"
  heuristic.
- `destroySession()` (runtime teardown, leaves the persisted session) vs `clearSession()` (privacy
  teardown, removes it **and the whole tab registry**).

The tab registry stays on raw `localStorage` and is skipped in cross-subdomain mode and while consent
is not granted.

### `src/profile.ts` — identity → [design note](docs/design-notes/profile.md)

`configureProfile`, `getAnonymousId` (`"anon-<uuidv7>"`), `resolveDistinctId`, `isIdentified` /
`markIdentified`, `clearProfile` (boolean), `destroyProfile`.

`identify()` requires `isGranted()` and rejects an `externalId` starting with the reserved
`cookieless-` prefix — accepting one rejects every batch containing that user.

### `src/batch.ts` + `src/queue-storage.ts` → [design note](docs/design-notes/batch.md)

`createBatchedTransport(endpoint, apiKey, projectId, partialConfig?)`.

**Invariants:**

- **Two queues:** cookieless events route to a memory-only queue; persisting them would itself be
  device storage.
- Every send path builds **one** batch from both queues, committing or rolling back only the queues
  that contributed.
- `flush()` reserves budget for the cookieless queue, floored on the cookieless side; at `maxSize: 1`
  the queues alternate.
- Config members are treated as **untrusted** and validated through `BATCH_RULES`; the three results
  are destructured off a `satisfies Record<keyof BatchConfig, Validated>` literal so a new knob cannot
  ship unvalidated.
- 3-state lifecycle: `idle` → `flushing` → `idle`, or any → `destroyed`.
- `purgeQueue`'s `destroyed` count is **approximate in both directions, never an audit.**

Queue storages share a two-phase lock/commit/rollback protocol. `lock(n)` reserves, `commit()` removes,
`rollback()` unreserves; one lock at a time.

### `src/track.ts` — event creation → [design note](docs/design-notes/track.md)

`toEvent(projectId, kind, identity, props?, opts?)` builds a protobuf `Event`.

**There is one runtime path for all events** — well-known names are a compile-time affordance only.

- `identity` is the `EventIdentity` union; "cookieless with ids" is unrepresentable.
- `beforeSend` is the single privacy hook; it replaced `sanitizeUrl`, which was removed not deprecated.
- `$url`/`$referrer` (here) and `form.action` (in `form.ts`) pass through `scrubUrl` **before** the
  hook.
- `$pageTitle` is sent on `page_view` only.
- `sessionId`/`distinctId` are top-level `Event` fields, not properties, and are not exposed to the
  hook.

### `src/auto-capture.ts` → [design note](docs/design-notes/auto-capture.md)

Owns listener selection and lifecycle. Object mode is an **allowlist** — only keys set to `true` are
enabled. Values are typed `true | undefined`, not `boolean`. Resolution (`resolveAutoCapture`, pure)
and diagnostics (`validateAutoCapture`, called from `setDesired` only) are split.

### `src/utils.ts` → [design note](docs/design-notes/utils.md)

**This module deliberately imports nothing** — adding `import { log }` breaks every suite that
`vi.mock`s `./logger.js`, since the hoisted factory then runs before its own spies exist. That
constraint drives several placement decisions.

`makeStorageKey`, `isCaptureSuppressed`, `getSafeElementText`, `scrubUrl` / `configureUrlRedaction`,
`encodeStored` / `decodeStored` (the retention envelope + `StoredEnvelope` brand),
`DEFAULT_MAX_AGE_DAYS`, `SECONDS_PER_DAY`, `safeStringify`, `isStorageAvailable`,
`isAutomatedBrowser`.

`isAutomatedBrowser()` probes its three signals **independently** — a shared `try` let one throwing
getter skip the other two, which is the whole point of reading three — and `brand` is type-guarded
because the object is page-controlled whatever the `.d.ts` says. `setAutomationSuppressed` /
`isAutomationSuppressed` park `pug.ts`'s bail latch here so `session.ts` can read it without a cycle.

`isAutomatedBrowser()` is the browser half of the backend's three bot signals, and the only one
that can drop rather than tag — which is why it is opt-in (`excludeAutomatedBrowsers`) and buys
cost, not accuracy: a tagged event is still stored and still metered. It reads `navigator.webdriver`
— which is what catches **headed** automation (a `--headed` Playwright run, Selenium driving a
visible Chrome): an ordinary Chrome UA on a residential IP, so neither server signal sees it, and
under the default it reaches ClickHouse untagged where no `include_bots: false` query excludes it.
Headless is *already* covered server-side — Chrome's new headless still ships the `HeadlessChrome`
token — so the UA and brand branches here are belt-and-braces. **Fails open**: a throwing
`navigator` getter reads as a real visitor.

### `src/events/` — trackers

Each module exports `setup*Tracking(track: TrackFn)` returning a cleanup function, called during
`init()` wrapped in try/catch so failures isolate. `autoCapture` keys map to these by name.

| Module | Events | Notes |
| --- | --- | --- |
| `page_view.ts` | `page_view` | Patches `history.pushState`/`replaceState`, listens to `popstate`. If another library patches on top, cleanup silences the orphaned wrapper instead of breaking the chain. |
| `click.ts` | `click` | Capture-phase; tag, id, class, coordinates, own text via `getSafeElementText` (50 chars) |
| `scroll.ts` | `scroll` | Throttled 2s; samples depth at timer expiry; cleanup clears pending timer |
| `form.ts` | `form_start`, `form_submit` | `WeakSet` dedupe. `action`/`id`/`name` reads are `typeof`-guarded: `[LegacyOverrideBuiltIns]` means a control named after any of them shadows the IDL attribute with the element itself |
| `frustration.ts` | `rage_click`, `dead_click` | Rage: 3+ clicks in 1s within 40px, 1s cooldown. Dead: no DOM mutation or URL change within 500ms, text via `getSafeElementText` (20 chars) |

### `src/rpc.ts` / `src/transport.ts`

`unaryCall(endpoint, apiKey, method, message, timeoutMs?)` is a hand-rolled Connect-protocol (binary)
unary client on `fetch`, replacing `@connectrpc/connect-web` to shrink the bundle. POSTs
`toBinary(method.input, message)` to `{endpoint}/{service.typeName}/{method.name}` with
`content-type: application/proto`, `connect-protocol-version: 1`, `x-api-key`. 5s default timeout via
`AbortController`.

`RpcError` (exported) carries a **numeric** gRPC status code — rejections use the Connect JSON error
body; drops and timeouts surface as `unavailable` / `deadline_exceeded` so the batch layer retries.
Deliberately **not** every failure: a 2xx non-protobuf body and a `toBinary` bug surface raw, which
`batch.ts` treats as permanent.

`createTransport(endpoint, apiKey)` adds `beacon`, which uses `navigator.sendBeacon` with binary
protobuf; since it cannot carry headers, the API key rides a `?api_key=` query param.

### `src/parsers.ts`

- `initUserAgentData()` — warms a high-entropy UA cache. Gated on `isTracking()`. Returns void; early
  events may lack `$osVersion`/`$device`.
- `parseUserAgentData()` — low-entropy props read directly; high-entropy from the cache. `{}` on
  Firefox/Safari.
- `$browser` picks from `brands` by name, never by position — Chromium shuffles that list and keys
  its GREASE entry to the major version. Engine loses to a specific brand; ties go to the longest.
- `parseUtmParams(search)` — only UTM params present with non-empty values.

### `src/logger.ts`

`log.warn`/`log.error` always write; `log.debug` is gated by a module-level flag, off by default, set
by `init({ debug })` via `setDebugLogging` and reset by `destroy()`.

The gate matters because the SDK runs inside a host application's console. **`warn`/`error` stay
ungated** — they report things an integrator must see without first knowing a flag exists — so the flag
can only widen what is visible, never narrow it. The `debug` option governs the *consent-denied*,
*dryRun* and *automation-suppressed* drops, **not** every drop; the pre-init drop is `log.warn` and
therefore unreachable by a flag `init()` sets.

Every write goes through `safeConsole`, which swallows a throwing/absent console.

> The gate lives in the real module, so any test that `vi.mock`s `./logger.js` bypasses it entirely.
> `logger.test.ts` covers the gate directly, and mock factories **must include `setDebugLogging`** for
> modules that import it (`pug.ts`), or `init()` throws on the missing export.

### `src/cdn.ts` / `src/cdn-install.ts` → [design note](docs/design-notes/cdn.md)

The self-contained IIFE for script-tag installs. Deliberately absent from `index.ts` and the exports
map — they exist only inside the CDN bundle. The canonical loader snippet lives in `README.md` and is
fixture-tested against `examples/cdn/index.html`.

---

## Protobuf Codegen (`Makefile`, `proto/`, `src/gen/`, `buf.gen.yaml`)

Protobuf types are **vendored**, not consumed from a Buf Schema Registry npm package — so consumers
`npm install` with no `.npmrc`/registry config. Mirrors sdk-android / sdk-flutter. Both `proto/` and
`src/gen/` are committed; `@buf/pugsh_pug.bufbuild_es` is **not** a dependency.

- `make sync-protos` — `buf export buf.build/pugsh/pug:$(PROTO_COMMIT)` (read-only, **pinned**) into
  `proto/`, allowlisted so backend-only trees are never synced. Needs BSR network access; nothing else
  in the build does. Bump deliberately: `make proto-latest`, update `PROTO_COMMIT`, re-run, review.
- `make protos` — `buf generate` into `src/gen/`, then `scripts/strip-validate-deps.mjs`, then
  `make typed-events`. Offline.
- `make typed-events` — regenerates `src/well-known-events.generated.ts` (type-only). Introspects a
  throwaway compile of `src/gen` because node cannot import the `.ts` source directly.

**The validate strip:** `buf/validate` is emitted (the pug protos import its field-option extensions)
then deleted, along with `file_buf_validate_validate` from every `import` + `fileDesc(...)` deps array.
Safe because the SDK no longer validates client-side and `fileDesc()` rebuilds the dependency list from
the deps arg — buf.validate is referenced only via field *options*, stored as unknown fields, never as
a field type. `create`/`toBinary`/`fromBinary` stay byte-identical while the ~73 KB `validate_pb`
descriptor leaves the bundle (see `src/wire-roundtrip.test.ts`). Deterministic, so `make check-codegen`
still passes.

## Well-Known Events

`src/well-known-events.generated.ts` is the **type-only** `WellKnownSchemaMap`. Every import is
`import type`, so it compiles to **zero runtime code** — ~119 schema descriptors used only for
compile-time typing, never reaching the browser bundle.

Generated by `scripts/gen-well-known-events.mjs`, which reads the wire-name from the
`(common.events.v1.kind)` message option and filters by `(common.events.v1.platforms)` — events
explicitly targeting only non-WEB platforms are excluded; unannotated events are treated as
platform-neutral and included. **Proto is the single source of truth**; no hand-edits.

The same pass emits **`WELL_KNOWN_EVENTS.md`** (repo root, linked from README, in the npm `files`
allowlist). Property names/types come from the compiled descriptors; the **constraints** are parsed
from the proto *source text*, because `buf.validate` is stripped from `src/gen` and survives only in
`proto/`.

Both artifacts are drift-guarded by `make check-codegen`, CI, and `well-known-events-doc.test.ts`.

`src/well-known-events.ts` is the hand-written wrapper deriving `WellKnownEventName`,
`WellKnownEventPropsMap`, `TrackEventProps`, `TrackFn`, `TrackOptions`.

---

## Key Patterns

- Trackers receive a `track` function and call it directly — they never touch the transport. All
  browser listeners are attached globally (document/window) during `init()` and removed during
  `destroy()`.
- Use `const = () =>` arrow functions everywhere. The only exceptions are `function` expressions
  needing `this` binding (history method wrappers in `page_view.ts`).
- Events are protobuf `Event` objects via `toEvent()`, not plain JS objects.

## Design Invariants

- **`track()` must never throw.** Centralized try/catch, transport errors caught via `.catch()`.
  Trackers call it from monkey-patched `history.pushState`/`replaceState`, so an exception would break
  the host application. Callers may rely on this.
- **`identify()` must never throw.** Same guarantee — invalid input, pre-`init()` calls, denied
  consent, `dryRun` and RPC failures are logged and the promise resolves without sending.

## TypeScript & Module Setup

- Target/module ES2020, strict, declarations emitted to `dist/`. Module resolution `bundler`.
- Imports within `src/` use `.js` extensions (required for ES module resolution at runtime).
- **Barrel** (`src/index.ts`) re-exports `init`, `destroy`, `track`, `reset`, `identify`,
  `setAutoCapture`, `setTrackingConsent`, `optInTracking`, `optOutTracking`, `isTrackingEnabled`,
  `getTrackingConsent`, `isConsentPending`, `rotate`, and types `PugConfig`, `InitOptions`,
  `AutoCaptureSelection`, `AutoCaptureConfig`, `CrossSubdomainConfig`, `TrackingConsent`,
  `TrackingConsentConfig`, `RejectConsent`, `BatchConfig`, `BatchOptions`, `TrackOptions`,
  `SessionConfig`, `JsonValue`, `JsonObject`, `PropValue`, `TrackFn`, `TrackEventProps`,
  `BeforeSendEvent`, `BeforeSendFn`, `WellKnownEventName`, `WellKnownEventPropsMap`. Deprecated alias
  `PugEventName` → `WellKnownEventName` is kept for compatibility.
- `package.json`'s `files` allowlist ships `dist` + README/WELL_KNOWN_EVENTS/LICENSE, so `proto/`,
  `src/` and the codegen tooling never reach consumers.

## Removed features

**Push notifications** (`src/push.ts`, `pug_sw.js`) were deleted in `be06856`. The module was
unreachable — absent from `index.ts` and `cdn.ts`, undocumented in README — and `pug_sw.js` did nothing
without `subscribePush` to register it. `urlBase64ToUint8Array` went with it.

Recover with `git show 46dc5b9:src/push.ts` and `git show 46dc5b9:pug_sw.js`. If revived, re-check
three things: add the push methods to `INIT_INDEPENDENT_METHODS` in `cdn-install.ts` (they work without
`init()` and must not be counted as "will be dropped" by the before-init warning); keep the dispatch
closure's guard for queued promise rejections; and route `pug_device_id` through the `PersistentStore`
plus every teardown, or it is a durable device identifier surviving an opt-out.

**`sanitizeUrl`** was replaced by `beforeSend` — removed, not deprecated. `init()` warns on the stale
key, since JS and one-tag installs get no compile error.
