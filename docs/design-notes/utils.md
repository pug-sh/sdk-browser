# `utils.ts` — shared primitives

**`utils.ts` deliberately imports nothing.** Adding `import { log }` broke every suite that
`vi.mock`s `./logger.js`, since the hoisted factory then runs before its own spies are initialized.
That constraint explains several placement decisions below.

---

## <a id="envelope"></a>The retention envelope

`encodeStored(value, expiresAt)` / `decodeStored(raw)` produce and parse
`<absolute expiry epoch ms>|<value>`.

### Why it lives here and not in `persistence.ts`

`persistence.ts` owns the *layering*, so the codec belongs there on responsibility grounds — but the
storage-asserting suites each hand-rolled the format, and importing the codec from `persistence.ts`
drags `logger.js` into them and trips the hoisting trap above. `storage-envelope.test-utils.ts` wraps
it for those suites.

### The `StoredEnvelope` brand

`encodeStored` returns `string & { __envelope }`, which `CookieLayer.set` requires. Enveloped and bare
values are otherwise the same `string`, and a bare value written through the cookie layer reads as
undecodable and is deleted by the store's next `getItem`. The brand makes that seam a compile error
(pinned in `cross-subdomain-types.test-d.ts`).

**Reads stay unbranded**: what comes off the device is not trustworthy enough to carry it.

### The non-finite clamp

`encodeStored` clamps a non-finite `expiresAt` to 0, so the brand cannot outrun the decoder: `NaN|v`
and `Infinity|v` were branded yet rejected by `decodeStored`, which `readItem` then reads as a
*pre-envelope* value — so `getItemOrLegacy` would have adopted a corrupt write as a recorded consent
choice.

Unreachable today (`setItem`'s `Math.min` has finite operands by construction), which is why it is
pinned rather than annotated as impossible. **0 rather than a throw** because this module imports
nothing (no logger) and its callers promise not to throw; an already-expired stamp is dropped on the
next read, whereas the unsafe direction would be never expiring.

---

## <a id="scruburl"></a>`scrubUrl` / `configureUrlRedaction`

Replaces the values of known-sensitive query **and fragment** params (`token`, `access_token`, `code`,
`email`, `password`, … — case-insensitive, plus any key ending `_token` while the default list is
active) with `redacted`. Applied to `$url`/`$referrer` in `toEvent` and `form.action` in `form.ts`
**before** `beforeSend` runs, so the hook adds masking rather than being the only thing between a reset
token and the backend.

A *replacement* list is exact-match by name, still case-insensitive — being the integrator's own
statement.

### Why the fragment matters on its own

An OAuth implicit-flow `#access_token=…` is never sent to a server **except** through analytics, since
it is part of `location.href`.

A fragment is redacted when it has a `?` (a hash route's query) or contains an `=` (a bare
implicit-flow fragment). Anything else carries no params.

### Why the no-slash guard was removed

It read a slash as "this is a route, not a query" — but `#access_token=…&state=/dashboard` and
`…&redirect_uri=https://…` are the ordinary shape of an OIDC callback, so the guard **disabled
redaction in precisely the case the fragment handling exists for**.

Nothing is lost by dropping it: `redactQuery` already returns null when no key matched, so a genuine
hash route (`#/orders/42`, `#section`, `#/search/q=shoes/page=2`) comes back byte-identical through the
same path.

### The shared null protocol

`redactQuery` and `redactFragment` share one "unchanged" signal (null), so `scrubUrl` has a single
comparison rather than one null-check and one string-equality check.

### Live iteration over `params.keys()`

Not over an `Array.from` copy: `set()` on the key at the cursor replaces that pair in place and only
ever splices away *later* duplicates of the same name, so no distinct key is skipped. Fuzzed against a
copying implementation over 50k query strings — **0 divergences**.

### Fail-closed on an unparseable URL

`scrubOpaque` runs the same matchers over the sliced query/fragment at the string level. The reachable
funnel is a malformed `form.action`: when the browser cannot parse the attribute it hands back the raw
attribute text, template bugs and live reset tokens included. **This is the one privacy control that
otherwise failed toward leaking.** A no-match unparseable input still returns byte-identical through
the shared null protocol.

No base is used — the three inputs are always absolute.

### Non-string input passes through untouched

`form.action` is element-typed when a form control is named `action` (named-property shadowing on
`HTMLFormElement`), and the guard's `includes` probes sit **outside** the try, so the leading `typeof`
check is what keeps the never-throws promise.

### Byte-identity caveat

Unchanged URLs are returned byte-identical rather than re-encoded. But a URL that *is* redacted gets
its whole query re-serialized by `URLSearchParams`, normalizing untouched pairs too — documented in
README for anyone joining `$url` against server logs.

### `redactUrlParams: []` warns

An empty `Set` is truthy and matches nothing, so `[]` disabled redaction exactly like `false` but
silently — which `userList.filter(...)` coming up empty reaches without anyone meaning to. It warns and
falls back to the default list.

Validation lives in `pug.ts` because of this module's no-imports rule.

---

## <a id="storage-probe"></a>`isStorageAvailable()`

Writes a **per-call token** under a **per-call key**, **reads it back**, then removes it (best-effort,
in a `finally`).

- The **read-back** catches a Storage shim or extension proxy that no-ops `setItem` without throwing.
- The per-call **key** stops two tabs probing a shared name concurrently from clobbering each other and
  both downgrading a working store to memory-only.
- The per-call **token** stops residue reading back as this run's own write.

### Residue is bounded by `strandedProbeKey`, not by the sweep

On a store whose `removeItem` never lands, a fresh key per probe strands a new one every call (~2–3 per
`init()`), accumulating across visits, outside the retention envelope and every teardown — and **the
sweep cannot reclaim any of them**, since it removes through that same failing `removeItem`.

So the key this tab already stranded is reused until a removal lands: one key, overwritten in place.
Reuse cannot collide across tabs, since each minted its own key before stranding it.

The sweep is the complementary half: it reclaims keys an *earlier* failure stranded once the store
recovers, taking only demonstrably stale ones (judged from the timestamp each key carries) so another
tab's in-flight probe is never touched.

### Only the write is verified

A removal that no-ops is narrower (values still persist) and `PersistentStore.removeItem` checks that
one per call, so failing the whole layer on it would cost the default install its session and anonymous
ID on every load.

---

## `getSafeElementText(el, maxLength)`

The element's **direct child text nodes only**, whitespace-collapsed and truncated (trailing whitespace
the cut exposes is dropped). Returns `''` when capture is suppressed or the text is user input — a
`<textarea>`, or anything under a `contenteditable` ancestor.

### It replaced `innerText`, which returned the whole subtree

A click target is often a wrapper rather than the leaf under the pointer, so clicking a card sent every
name, email and total it wrapped — and a `data-pug-no-capture` marker on the sensitive leaf never ran,
because the read happened at the ancestor.

**The old tests could not see this**: jsdom does not implement `innerText`, so they stubbed it with
`Object.defineProperty` and asserted against a fake with no subtree semantics at all.

### The `contenteditable` check resolves inheritance

`closest('[contenteditable]')`, honoring a nested `contenteditable="false"` island. Reading the
attribute off the click target alone caught only a bare `<div contenteditable>text</div>` and missed
every real editor, which puts the attribute on a root while the pointer lands on the `<p>`/`<span>`
holding the typed text — **so a draft shipped as `click.text`.**

Deliberately not `HTMLElement.isContentEditable`, which resolves inheritance natively but is
`undefined` in jsdom, making any guard built on it untestable here.

---

## `safeStringify(value)`

`JSON.stringify` for log interpolation of untrusted values, falling back to `String()` (and to a literal
placeholder if even that throws).

The validators interpolate the very values they reject, and those (bigint, circular refs, a throwing
`toJSON`) are exactly what makes `JSON.stringify` itself throw — out of `createTrackingConsent` (the one
factory `init()` calls unguarded) and out of `set()`, which the public `setTrackingConsent` reaches.

`JSON.stringify`'s `undefined` results (undefined itself, functions, symbols) fall through to `String()`
rather than interpolating as the literal text "undefined" of a missing value.
