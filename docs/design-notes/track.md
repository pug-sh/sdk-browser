# `track.ts` — event construction and `beforeSend`

`toEvent(projectId, kind, identity, props?, opts?)` builds a protobuf `Event`.

---

## <a id="event-identity"></a>The `EventIdentity` union

Either `{ cookieless: true }` (the server derives identity; the ids are omitted from the wire
entirely) or `{ sessionId, distinctId }`.

Edition-2023 explicit presence makes omission distinguishable from a sent-empty string — the proto's
`string.uuid` rule rejects an empty `session_id`; `distinct_id` carries no field rule and is covered
instead by the message-level `event.identity_required_unless_cookieless`.

### Why each arm carries `?: never` members for the other's fields

That is what actually **closes** the union. With no shared property TypeScript has no discriminant,
and excess-property checking against a union admits any property present in *any* constituent — so
every spelling of a cookieless event carrying identity compiled, **including the spread and variable
forms an explicit literal tag would still admit**.

`event-identity.test-d.ts` pins four spellings (literal, spread, variable, pre-built object). All four
compiled before; none is observable by a runtime test, since the failure being guarded is a *missing*
compile error.

### Why the runtime branch tests `=== true`

`identity.cookieless === true`, not `'cookieless' in identity`, so it agrees with the type instead of
silently accepting `{ cookieless: false }` and emitting `cookieless: true` for it.

---

## Property mapping

There is **one runtime path for all events**. Well-known event names are a compile-time typing
affordance only; `toEvent` consults no schema, so well-known and custom events populate
`customProperties` identically via `jsValueToPropertyValue`.

| JS value | proto |
|---|---|
| `string` | `stringValue`, truncated to 1024 **UTF-8 bytes** with a warn |
| `boolean` | `boolValue` |
| finite `number` | `intValue` if `Number.isSafeInteger`, else `doubleValue` |
| `bigint` | `intValue` |
| `Date` | `timestampValue`; `Date(NaN)` dropped |
| array / object | `JSON.stringify` then string policy |
| `null` / `undefined` | dropped **silently** — common and unactionable |

Byte-truncation is strictly more conservative than the server's `string.max_len = 1024`, which is
enforced as a code-point count.

Every other drop is logged at the call site with the property key for grep-ability, since `track()`
never throws and undiagnosed drops would mask real user bugs.

### The int-vs-double consequence

A whole-number value on a proto `double` field (e.g. `purchase.amount = 5`) serializes as `intValue` —
the heuristic keys off the JS value, not the schema.

Safe because the backend stores custom properties in a ClickHouse
`Map(String, Variant(String, Int64, Float64, Bool, DateTime64(3)))` and every numeric read coalesces
the `Int64` and `Float64` slots to `Float64`. Safe integers are exact in both, so aggregations and
filters are unaffected.

---

## <a id="beforesend"></a>`beforeSend`

The single privacy hook. It **replaced `sanitizeUrl`**, which was removed rather than deprecated
(pre-1.0, and two overlapping hooks is worse than one break).

`toEvent` builds both property bags as plain JS, runs the hook, then converts via
`mapPropsViaHeuristic`. Return the event, `null` to drop, or `undefined` to keep in-place mutations.

**`undefined` can't mean "drop"** because mutable bags invite forgetting the return.

### The `draft` const is reused as the `undefined` fallback

The `BeforeSendEvent` handed to the hook is held in a `draft` const, **not rebuilt** from
`applyBeforeSend`'s arguments. Rebuilt, a hook that *replaced* a bag
(`e.autoProperties = mask(e.autoProperties)`) and fell off the end had its redaction discarded and the
raw original sent — the one direction a privacy hook must never fail, and one nothing warned about.

Both bags are also `readonly` on the type so that spelling is a compile error first (pinned by
`before-send-types.test-d.ts`; the runtime honors it either way).

### Typing details

`autoProperties` is typed `Record<string, string>` — every value it holds is a string, and the
`PropValue` it used to carry made the README's own `maskUrl(event.autoProperties.$url)` a `TS2345`.

The return type stays `| void` rather than `| undefined`: a block-bodied arrow with no return infers
`void`, so the documented in-place idiom stops compiling under `| undefined` while nothing at runtime
can tell the two apart.

### Failure handling

`$projectId` / `$platform` / `$sdkVersion` are re-asserted from a snapshot taken **before** the call:
the hook gets the live bag, so a `delete` would empty what a naive re-assert reads back.

A throw or malformed return drops the whole event (no narrower fallback than a URL field has). Each
warning is one-shot but on **its own flag** — shared, a throw at page load silenced every later
malformed return for the life of the page.

`isPlainBag` rejects anything whose prototype is not `Object.prototype` / `null`: a `Map`, `Set`, array
or class instance yields nothing from `Object.entries`, so accepting one shipped an event stripped to
its three re-asserted properties, silently.

Only the throw path logs, and only the error's *type*. `sessionId` / `distinctId` are not exposed.

### The one-tag install cannot supply a hook

`data-options` is JSON, which holds no functions. The key is deliberately **not filtered** —
`autoInitFromScript` spreads `data-options` wholesale — and a non-function value **fails closed to
dropping every event**.

### Scrubbing runs first

`$url` / `$referrer` (here) and `form.action` (in `form.ts`) pass through `scrubUrl` before the hook, so
it receives values with known-sensitive query/fragment params already redacted. Structural masking
(IDs in paths, whole URLs) remains its job — the migration cost of dropping `sanitizeUrl`.

---

## `$pageTitle` rides `page_view` only

`eventPageView` is defined here rather than in `events/page_view.ts` so a core module does not import a
tracker one. When it did, `pug.test.ts`'s `vi.mock` of that module broke `track()` on the missing
export.

Titles routinely carry names and order numbers, so riding every click, scroll and frustration event
multiplied the exposure for no added signal. The events that follow on a page share its `sessionId`, so
the title is still joinable.

---

## <a id="trackfn"></a>`TrackFn` is one generic signature, not overloads

It **was** overloads — a narrow well-known one, then an `(event: string, props?: Record<string,
JsonValue>)` fallback. That meant a wrong type on a known field never errored: TypeScript abandoned the
failed first overload, matched the permissive fallback (a string is a fine `JsonValue`), and the bad
payload compiled and shipped to be rejected server-side. **The fallback silently absorbed exactly the
mistakes the typing existed to catch.**

One signature leaves nothing to fall through to, so the error lands on the offending property.

`(string & {})` preserves editor autocomplete for the well-known literals while still admitting any
custom string; plain `string` would absorb the literals and lose completions.

### The non-distributive conditional

`TrackEventProps`'s conditional is `[E] extends [WellKnownEventName]`, not a bare `E extends …`. A
distributive one expands over the 119-name union whenever `E` is still generic — which is exactly what
a wrapper forwarding its own type parameter does:

```ts
const forward: TrackFn = (e, p, o) => track(e, p, o)
// TS2590: Expression produces a union type that is too complex to represent
```

A compiler resource bailout that names no cause and suggests no fix. Since `TrackFn` is a public
export, typing an analytics facade with it is the obvious move, so that path has to work.

The `E & WellKnownEventName` intersection in the true branch is load-bearing for the same reason and
reads even more like a no-op: the tuple guard alone constrains `E` enough that
`WellKnownEventPropsMap[E]` is legal, but the bare form expands the indexed access eagerly and
reintroduces TS2590 at the same call shape.

**The two are not independently pinned** — removing *only* the tuple still typechecks, because the
intersection alone defers the expansion. `track-types.test-d.ts` catches the fully-reverted form, not
either half.

### Why props resolve to `PropValue`, not `JsonValue`

`Record<string, PropValue>` (`JsonValue | bigint | Date`) mirrors what `jsValueToPropertyValue` accepts
at runtime. protobuf-es maps proto `int64` to `bigint`, so under a bare `JsonValue` bag the int64
fields on five well-known events (`file_uploaded`, `file_downloaded`, `export_completed`,
`chat_attachment_uploaded`, `chat_attachment_downloaded`) were **unwritable in every spelling** —
`number` failed the message shape and `bigint` failed the index signature.

The old permissive overload had absorbed that silently; removing it turned it into a hard error.
