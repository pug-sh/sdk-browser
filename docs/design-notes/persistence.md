# `persistence.ts` — layered storage and retention

An optional cross-subdomain cookie layer over `localStorage`. Reads prefer the cookie; writes go to
every available layer; methods never throw.

---

## <a id="retention"></a>The retention envelope

Every value is stored as `<absolute expiry epoch ms>|<value>` (`encodeStored`/`decodeStored`, in
`utils.ts`). `getItem` **deletes** — not merely ignores — anything past its deadline and anything
that does not decode, so nothing outlives `maxAgeDays` (default 365) in *any* mode.

Before this, `localStorage` — the default layer — had no expiry at all, so the default install kept
identity forever.

### The deadline is stamped at the first write and carried forward

CNIL's 13-month rule is explicit that a tracker's lifetime must not be automatically extended on new
visits. The SDK has several sliding refreshes (session activity, `getAnonymousId`'s expiry refresh,
the consent record's re-write at init) and none of them may extend retention.

The carried-forward deadline is **clamped** to `now + maxAgeMs`, so the rule cuts both ways: a
refresh cannot extend retention, and *lowering* `maxAgeDays` still reaches existing visitors on their
next write — who are exactly the population an integrator tightening retention cares about.

### Why `knownExpiry` exists

`resolveSessionId()` does a read-then-write on every tracked event. Re-reading storage to carry the
deadline forward doubled the storage reads per event — **measured 1.02 → 2.03 `getItem`s/event** in
the default localStorage-only install.

The cache holds **deadlines only**; values are always re-read, which is what `session.ts`'s cross-tab
sync relies on. An entry is never *later* than the deadline on the device: `getItem` caches what it
decoded, `setItem` caches the (clamped) deadline it is about to write. If another tab removes and
recreates a key, this tab's cached deadline is the older one and the value gets a shorter life —
the safe direction.

### Deleting the undecodable half is what makes retention unconditional

A pre-envelope value carries no deadline, so retention can never reach it. Merely ignoring one would
strand it. The anonymous ID self-heals (the next mint overwrites the key), but an `identify()`ed
`externalId` — routinely an email — is only ever written by `identify()`, so a visitor who upgraded
and did not re-identify would have kept theirs forever.

Deleted, it leaves the device on the first read and comes back only when the app calls `identify()`
again. Acceptable for *identifiers*; **not** for the consent record, which is why that one key reads
through `getItemOrLegacy`.

### Why `getItemOrLegacy` is a separate method

Adopting a bare value is only ever correct for the consent record, which records a *refusal* that
must not silently revert to the config seed — the README's own migration advice being
`initial: 'granted'`. Identifiers must stay on `getItem`, where a bare value reads as absent;
adopting one resurrects an identifier no deadline can reach.

That is caller discipline either way, but a distinct method puts the choice in the call rather than
in an argument.

### What is outside the bound

The batch queue, the tab registry and `pug_device_id` stay on raw `localStorage` and are therefore
**outside** the retention envelope. See `pug.md` for why, and what clears each.

---

## The mirror sweep

In cross-subdomain mode reads never consult the `localStorage` mirror that `setItem` writes through
to. So on a genuine shared-cookie miss (not a read failure) the store sweeps the mirror, once per key
per miss episode.

Without the sweep the mirror sat outside every deadline — an `identify()`ed email, for a visitor the
app never re-identifies — and became readable again the moment the integrator turned cross-subdomain
off.

A throwing sweep **un-latches** so the next miss retries, as `reconcileTwin` does. Latched, one
throwing sweep left the mirror unreachable for the rest of the page load.

Only on a genuine miss: a throwing jar is not evidence the cookie is gone.

---

## <a id="latch-discipline"></a>Latch discipline

The module holds five once-per-key latches. The rule is **module-wide**:

> A latch may report once per *episode*, but must never outlive the fact it describes.

Every one is released once its key's residue is verifiably gone — the failed retention drop
(`dropStale`) on a confirmed removal, the mirror sweep on a sweep that lands, `setItem`'s persist
warning on a write that persists, `writeLocal`'s warn on a write that lands, and `removeItem`'s
residue report on a confirmed removal.

**Three of the five shipped with only the `.add` half.** Each release is pinned in the same three
phases: report, recover, report again.

### Why the retention-drop latch was the worst of them

In cross-subdomain mode `removeItem` returns `cookieRemoved` **alone**. So a *cookie* that refuses to
leave never flips that boolean, and `dropStale`'s single `log.error` is the only signal anywhere that
a value past its deadline survived on the device.

Latched for the page, retention enforcement went silent for that key — which is also what made
`session.ts`'s "the store already logs the underlying failure" true of the *first episode only*.

`reportResidue` is not a substitute and is not unreachable there: `local` is
`isStorageAvailable() ? localStorage : null`, independent of cookie mode, and `persistence.test.ts`
drives that report through a cross-subdomain layer. **The two cover different layers and neither
stands in for the other.**

### Why the sweep and residue latches are deliberately not shared

They describe the same residue but answer to different callers. Shared, one throwing sweep *would*
suppress the teardown report — the only signal anywhere that an opt-out left an identifier on the
device — until whichever release happened to fire first, which is not the same fact.

Stated as a counterfactual because it is one: no committed build shared them. `persistence.test.ts`
pins it.

### Why `writeLocal`'s warn is latched

It sits on the per-event session write. An unlatched warn there is one console line per event for the
life of the page on a quota-exhausted store — drowning the single actionable message `setItem()`
logs.

### Why both residue arms report at `log.error`

The silent no-op and the throw leave the same identifier behind, so the mechanism of failure does not
pick the severity. This matches how `clearProfile()` reports the same outcome on the cookie layer.

---

## `setItem`'s return contract

Returns true only when the value will be readable on the next page load:

- **cross-subdomain mode** — the cookie write must land (reads trust only the cookie)
- **otherwise** — any layer suffices, *provided* a stale cookie left by a failed cookie write was
  cleared

That proviso is load-bearing. Reads prefer the cookie, so a host-only cookie left behind by a
*failed* write shadows the `localStorage` value with the previous one and would report success.
Failing to remove it is not persistence.

**Cross-subdomain mode deliberately keeps its stale cookie:** reads there have no fallback to drop
to, so removing would end identity on every sibling subdomain over one page's failed write.

### Why `writeLocal` does not read back

The failure it would catch — a Storage shim or extension proxy that no-ops without throwing — is a
property of the Storage *object*, not of a key. `isStorageAvailable()` verifies it once at startup
(it wrote a sentinel and never read it back, which is what let a shimmed store report available) and
`local` is null when it fails.

A per-write check would put a second `getItem` on the per-event session write for a fact already
known, undoing `knownExpiry`'s 2.03 → 1.02 measurement. Quota exhaustion, the other no-op-shaped
failure, throws and is caught.

`removeItem` *does* read back — it is off the steady-state hot path, since only a key past its
deadline or undecodable reaches it from `readItem()`. That path *is* per-event once a key is stuck,
which is exactly why its failure reports are latched.

---

## `dropCookie`'s `intent` parameter

Passed straight through to the layer; decides only *who* reports a failure. A teardown gets the
layer's own once-per-key error naming the key. A write-path shadow clear is reported by `setItem`,
which has the consequence in hand ("shadows the stored value").

See [`cookie.md`](cookie.md#remove-and-the-intent-parameter) for why reporting a write as a teardown
permanently spent the key's one diagnostic.

---

## `maxAgeDays` validation

Untrusted — the one-tag install feeds it from `data-options` JSON.

`safeStringify` on the rejection message because the value being rejected is exactly the kind
(bigint, circular ref, a throwing `toJSON`) that makes `JSON.stringify` itself throw — which
downgraded the whole SDK to memory-only persistence via `init()`'s generic catch instead of warning
about one option.

A finite day count can still overflow as milliseconds. Stamped, a non-finite deadline is an envelope
`decodeStored` rejects, so every value would be written and then deleted on its next read.

The Chromium 400-day cap warning is gated on a cookie layer actually being present: hoisting
`maxAgeDays` out of the cookie config hoisted that check past its own precondition, so the default
localStorage-only install warned about a cookie it never writes.

---

## Why reads don't fall back in cross-subdomain mode

The shared cookie is authoritative, so a miss means *deleted*. Falling back to this origin's
`localStorage` would resurrect a value a sibling still holds and re-broadcast it on the next write —
so a logout on one subdomain would not stick. Origin-scoped stores still fall back.
