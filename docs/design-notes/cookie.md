# `cookie.ts` — cross-subdomain identity

Mirrors identity into a first-party cookie on the registrable domain so it is shared across
subdomains. **Off by default.** When off, `createCookieLayer` returns `null`, persistence is plain
origin-scoped `localStorage`, and none of the machinery below can occur.

---

## Why the opt-in must be stated, never inferred

Cross-subdomain identity relaxes browser same-origin isolation to the weaker same-site model, so per
`docs/cross-domain-tracking-threat-model.md` §7 (in the backend `pug` repo) it is an explicit
per-integrator decision.

`resolveIntent` enforces this at runtime as well as in the type, because the one-tag CDN install
supplies the config as untyped `data-options` JSON that no compiler ever sees. Only a literal `true`
reaches the domain probe; an object must carry a non-empty string `domain`.

### The three shapes that used to auto-discover

Every one of these was reachable in practice, and all three silently enabled the opt-in:

| shape | where it came from |
|---|---|
| `{}` | a config builder spreading unset optionals |
| `{ maxAgeDays: 30 }` | an upgrade from the removed lifetime arm — the *documented* old behavior |
| `"true"` / `"false"` | a stringly-typed value out of an HTML template |

The last is the worst: a truthy non-object fell through to the probe, so `"false"` **enabled**
cross-subdomain identity.

`false`, `null` and `undefined` resolve to off *silently* — they state the default outright. Every
other rejected shape warns, because the warning exists to catch a config that believes it opted in.

### Why `domain` is required in the object arm

An all-optional object made `{}` legal, and `{}` would infer the opt-in. `maxAgeDays?: never` closes
the removed lifetime arm for variables and spreads too — excess-property checks guard only fresh
literals (the same reasoning as `EventIdentity` in `track.ts`). Held in a config builder, the old
documented shape otherwise compiled while `resolveIntent` silently swapped its deliberately shortened
lifetime for the 365-day default.

Pinned in `cross-subdomain-types.test-d.ts`, where the `maxAgeDays` case must carry a `domain`: as a
bare `{ maxAgeDays: 180 }` it errored only for the *missing `domain`*, exactly like the `{}` case
above it, so re-adding `maxAgeDays` to the object arm typechecked clean.

## Domain discovery

`seekRegistrableDomain` probes widest-first and takes the first candidate the browser accepts.
Everything wider than eTLD+1 is a public suffix the browser refuses, so no bundled suffix list is
needed — the browser's own is authoritative.

Multi-tenant PaaS hosts (herokuapp.com, vercel.app, …) need no special-casing: their shared suffix
*is* a public suffix, so the probe lands on the tenant's own host.

**Not covered:** a custom multi-tenant registrable domain not on the Public Suffix List — e.g.
`a.myplatform.com` and `b.myplatform.com` as separate tenants. The probe accepts `.myplatform.com`
and sibling tenants can read each other's identity (threat model T2/T3). There is no bundled denylist
backstop; such deployments must pass an explicit `{ domain }`. The public API JSDoc warns integrators
of this.

---

## The twin protocol

A **twin** is a same-named *host-only* cookie sitting alongside the shared one.

It is indistinguishable by name in `document.cookie` and can sort ahead of the shared cookie, so it
**shadows** the shared value on reads. Worse, a read-then-refresh (`getAnonymousId`, session
activity) would copy the stale twin *onto* the shared cookie and corrupt identity site-wide.

`reconcileTwin` runs once per key on first access: expire the twin, then see what remains.

### <a id="preserved-twins"></a>`preservedTwins` holds the value, not the lifetime

A twin left in place must be *restorable*, not merely *remembered*: a later `set()` whose replacement
write fails has to put the twin back, so the value rides the registration.

The lifetime is deliberately **not** captured. It is recomputed from the twin's own envelope at
restore time (`restoreConsumedTwin`), because a figure captured when the twin was first preserved
goes stale on a long-lived page — preserved with `R` seconds left and restored at `R−10`, it was
written back with a fresh `max-age=R` and outlived the deadline stamped in the value it carries.

Not a leak, since the envelope still governs what the store reads, but the physical cookie outlived
its own deadline, contradicting `CookieLayer.set`'s "the cookie expires with the value it holds".

### Why registration and restore travel together

A restored twin predates any later shared write for its key, so RFC 6265 sorts it ahead in
`document.cookie`. `writeCookie` must know to expire it first — a restore *without* the registration
makes that later write fail read-back against the twin and report a landed write as lost.

### `twinLifetime` returns three outcomes, not two

`'expired'` and `'undecodable'` were one `null` before. That conflated *"retention says drop this"*
with *"this layer cannot read it"*, and let the second be destroyed on the first's reasoning.

- **expired** — retention ended it; the expiry write already did what its deadline asked. Not restored.
- **undecodable** — pre-envelope or corrupt. **Never promoted** (that would widen an identifier
  nothing can ever expire) but **restored rather than discarded**, because what an undecodable value
  means is the *store's* call, not this layer's: the store removes one on sight, and
  `getItemOrLegacy` hands the consent record's bare value up first.

That last point was a real regression. Destroyed here, the store's read saw nothing and — in
cross-subdomain mode — the resulting cookie miss also swept the localStorage mirror. So a refusal
recorded by a pre-envelope build reverted to the config seed with nothing logged, defeating the
adoption hook on the one mode it was never tested in.

`LEGACY_TWIN_RESTORE_SECONDS` (300) is short deliberately: an undecodable twin only needs to survive
until the store's read on this same call, which removes it. Long enough to absorb a slow page, short
enough that a value with no deadline of its own cannot linger.

### Restores use host-only attributes, not a bare write

A bare write dropped `SameSite` and `secure`, handing a previously-Secure identity cookie to plain
http on the same host.

Restores are read-back verified and report at `log.error` on failure: the twin is already expired by
the time a restore runs, so a restore that also fails destroys what was the sole copy — and
cross-subdomain reads have no localStorage fallback to drop to. That is the same outcome
`clearProfile()` reports at error.

### Why the promotion is gated on consent but the reconciliation is not

The promotion is an identity **write that happens on the read path**, so it escaped every other
consent check. `configureProfile` reads `external_id` unconditionally (only its *refresh* write was
gated), so a `denied` or default-`cookieless` init widened an `identify()`ed email onto the
registrable domain — which a non-authoritative seed then never purged back off.

Everything *before* the promotion is a **deletion** — expiring a stale twin so it cannot shadow the
shared cookie. No consent state forbids that, and `configureProfile` depends on it: it reads
`external_id` once and latches the result for the page, so gating the whole reconciliation let a
stale twin win that read and become the `distinctId` after a mid-page grant.

The not-granted arm is **latched, not retried**. Un-latched, every later `get()`/`set()` repeated the
delete-and-restore — measured at **10 cookie writes across 5 reads**, i.e. an identity `Set-Cookie`
on the read path in the state that promises no device writes. `cookie.test.ts` pins the latched
behavior at 2 (one expire plus one restore). A grant later in the same page migrates on the next page
load, which costs nothing real: `external_id`, the key that motivated the gate, is read once by
`configureProfile` and latched into module state.

### Acknowledged blind spot

A jar that silently no-ops writes leaves the un-expired twin itself passing the post-expiry
read-back, masquerading as a surviving shared cookie — latched, with the twin still shadowing.
Undetectable without a probe write, which the denied-consent read path must not issue. The fault
surfaces at the next write's read-back.

### A throwing reconciliation un-latches

Latched as done, a stale twin kept shadowing the shared cookie for the whole page load — the exact
condition the function exists to prevent. So the catch deletes the key from `reconciledKeys` and the
next access retries, warning once per key rather than once per access.

Two outcomes share that catch, and the message covers both rather than diagnosing shadowing for a
loss: a throw *before* the expiry leaves the stale twin shadowing (the retry heals it); a throw
*after* means the twin was already expired and its value may be gone.

---

## `writeCookie` and the consumed-twin repair

A preserved twin is superseded by the value about to be written, and it was created first, so RFC
6265 sorts it ahead in `document.cookie` — the read-back would return the twin and report a landed
write as failed. So `writeCookie` expires it first.

**Ordering matters:** the twin is expired only once the replacement is known writable. Expired before
the size and encoding checks, an oversized or unencodable value destroyed the sole copy and returned
false with nothing in its place.

Both failure arms restore it:

- **read-back mismatch** — a cookie store blocked mid-session. The reachable case is the consent
  record's restore write, whose loss reverted a recorded refusal to the config seed on the next
  `init()`.
- **throw** — may have destroyed the twin (expiry landed, encoded write threw) or left it physically
  present but untracked (the expiry write itself threw). Restore, not just re-register.

The catch's restore runs in **its own try**: a jar broken enough to throw here usually throws in
`preserveTwin` too, and a throw escaping would break `set()`'s never-throws contract. `preserveTwin`
registers before it writes, so even a failed attempt leaves the bookkeeping consistent, and a stale
entry costs one harmless extra expiry write later.

The catch reports at **warn, not debug**, when the twin could not be put back: `log.debug` is off
unless the integrator already set `debug: true`, making the loss invisible to exactly the person
diagnosing it. Same argument that put `remove()`'s catch at error.

`encodeURIComponent` stays *inside* the try — it throws on malformed UTF-16 (lone surrogates), and
callers must never throw.

---

## `remove()` and the `intent` parameter

`intent` picks **who reports** a failure, not what is attempted.

- `'teardown'` (default — opt-out, reset, a retention drop) is the privacy case. This layer reports
  at `log.error` and latches once per key, because callers surface `remove()` only as an aggregate
  boolean (`clearProfile`, `clearSession`, the store's `removeItem`) that can name neither the key
  nor the layer.
- `'write'` is `persistence.setItem()` clearing a stale cookie its own failed write left shadowing
  the localStorage value. That caller already warns with the consequence in hand ("shadows the stored
  value").

Reported as a teardown, a *write* spent the key's one diagnostic **permanently** — the latch releases
only on a confirmed removal, which the still-blocked jar cannot give. The genuine opt-out that
followed then named neither the key nor the layer, which is exactly the gap the report was added to
close.

### Both failure arms report at the same level

The silent no-op and the throw leave the identity cookie in exactly the same place, so the mechanism
of failure does not pick the severity. The no-op arm was silent while the throw logged, which made it
the one teardown failure with no diagnostic anywhere.

### Why the registration is consumed only on a *confirmed* removal

Consumed up front, a removal that threw or no-opped left the twin in place but untracked, so a later
successful `set()` failed read-back against it.

Left behind entirely, it outlived the teardown and the failed-write arm restored an `identify()`ed
email *after* `optOutTracking()` reported success. Pinned in `cookie.test.ts`.

---

## The `isGranted` head guard

Placed at the head rather than at the point of use because an unguarded gate is first *called* inside
`reconcileTwin`'s try, **after the live twin has already been expired** — so the misuse destroyed a
value and surfaced only as a once-per-key warn.

`init()` routes the throw through `reportInitFailure`, which reports a `TypeError` at error level
naming it a wiring error, rather than at warn alongside genuine environment failures.

The gate is **late-bound** (`deferredGrantedGate` in `tracking-consent.ts`): the controller needs the
store and the store needs the layer. It resolves to **not granted** until the controller exists, so
no fail-open default survives anywhere in the chain. That costs nothing — the only value read in that
window is the consent record, and the sole thing a withheld gate suppresses is the twin *promotion*.

See [`tracking-consent.md`](tracking-consent.md) for the brand itself and the containment scan.
