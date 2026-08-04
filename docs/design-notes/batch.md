# `batch.ts` / `queue-storage.ts` — batching and delivery

`createBatchedTransport` wraps the RPC transport with two queues, a flush state machine, and
purge semantics.

---

## Two queues, one state machine

`storageFor` picks by `event.cookieless`. **Cookieless events route to a second, memory-only queue** —
persisting their payloads would itself be device storage, which cookieless mode promises not to do.

Both queues share the flush state machine (one in-flight batch), and **every** send path — `flush()`,
`beaconFlush()`, `destroy()` — builds a single batch drawn from both, committing or rolling back only
the queues that contributed.

Only `flush()` caps at `maxSize`; `beaconFlush()` and `destroy()` fully drain, since there may be no
second chance.

### Why not select one queue per flush

Selecting one starved the cookieless queue for the entire duration of any continuous consented stream
(`storage.size > 0` always chose `storage`), while `totalSize() >= maxSize` counted the stalled backlog
and tripped the threshold on every arriving event — degrading consented traffic from batched sends to
one request per event.

And because `storage` is localStorage-backed, a single transiently-failing consented event survived
page loads and could block cookieless collection on that device **indefinitely**.

### The reserve, and why it alternates at `maxSize: 1`

`flush()` reserves part of the budget for the cookieless queue whenever it has events waiting, so a
consented backlog of ≥`maxSize` cannot starve it. The reserve is floored on the **cookieless** side.

When the two floors cannot both fit — i.e. `maxSize: 1` — the queues **alternate** across flushes.
Flooring only the consented side made that floor the entire budget at `maxSize: 1`, a legal config and
the natural one for per-event delivery, so cookieless got `lock(0)` forever.

### What `maxWaitMs` does not bound

A hard-killed tab can lose whatever the cookieless queue holds, bounded by `maxQueueSize` and **not**
by `maxWaitMs`, which bounds only the happy path: a transient failure rolls the batch back and retries
indefinitely (measured at 60s with `maxWaitMs: 50`). The transient-retry test in `batch.test.ts` pins
the *storage silence*, not the bound.

---

## <a id="config-validation"></a>Config validation

`BatchOptions` is `{ readonly [K in keyof BatchConfig]?: BatchConfig[K] | undefined }` — a mapped type
rather than `Partial<BatchConfig>`, whose members reject the `T | undefined` config-builder spelling
under `exactOptionalPropertyTypes` (pinned in `init-options.test-d.ts`). Mapped rather than
hand-written so a fourth knob cannot be settable on `BatchConfig` while unsettable through
`init({ batch })`.

Members are read individually by `validated(name)` rather than spread, since spreading an explicit
`undefined` would replace the default with it.

### Why `BATCH_RULES` exists

Passing `kind` and `min` per call let them be mismatched. Both of these compiled:

- `validated('maxWaitMs', 'whole', 0)` — rounding a `setTimeout` duration that is fine fractional
- `validated('maxSize', 'finite', 0)` — admitting the `lock(0)`-forever config the floor exists to reject

`BATCH_RULES` is a `satisfies Record<keyof BatchConfig, …>` table (the `KNOWN_CONSENT_KEYS` pattern),
and it closes the asymmetry the mapped type leaves: `BatchOptions` makes a fourth knob *settable*, but
nothing made it *validated*.

### Why the results are destructured off a `satisfies` literal

`BATCH_RULES` guarantees a rule **exists**, not that it is **applied**. With a fourth member added and
a rule written for it, typecheck still passed while nothing ever called `validated('maxRetries')` —
settable through `init({ batch })`, documented, and inert.

So the three results come off a `satisfies Record<keyof BatchConfig, Validated>` literal. The two
halves of that annotation do different jobs:

- `keyof BatchConfig` requires every member to be **present**
- `Validated` — a nominal brand on `validated()`'s return, minted at one cast — requires each to have
  **come from the validator**

Against a plain `satisfies BatchConfig` the presence half alone was not enough: writing the new member
as `partialConfig?.maxRetries ?? DEFAULT_BATCH_CONFIG.maxRetries` typechecks clean as a bare `number`
and ships unchecked to the untrusted-JSON caller the apparatus exists for.

The brand also forces one honest distinction at the use site: `flush()`'s `consentedBudget` is
annotated `number` rather than inferring `Validated` off `maxSize`, because a budget derived by
arithmetic is not a value the validator checked.

### Untrusted values, not merely absent ones

The one-tag install supplies `batch` as `data-options` JSON, where a bare `value >= min` accepted:

- `Infinity` — what `JSON.parse` gives for `1e999`, disabling the `maxQueueSize` bound and
  size-triggered flushing outright
- `null` — `null >= 0` is true, and `setTimeout(fn, null)` fires immediately, collapsing batching to
  one request per event

The two event counts are additionally rounded **down** to whole numbers (`kind: 'whole'`; `maxWaitMs`
is `'finite'`). A fractional `maxSize` had `lock()` reserve half an event — `slice` returns `[]` while
`locked` keeps the `0.5`, and a flush releases only the queues that returned events, so that queue
stayed locked for the life of the page. Measured at `maxSize: 1.5`: **18 send attempts, not one
carrying a cookieless event.**

Rounded down rather than replaced by the default, which for `maxQueueSize` would answer a too-tight
bound (1.5 → 1) by widening it 1000×.

`lock()` truncates its own limit as well, so the invariant does not rest on the config path alone —
though that truncation is now **unreachable insurance rather than a covered invariant**: with
`validated` rounding the counts and every `lock()` argument derived by integer arithmetic, no exported
surface can hand it a fraction, and the queue storages are module-private. Pinning it would mean a
test-only production export, which `test-utils-imports.test.ts` exists to prevent. (The same is true of
`session.ts`'s fail-closed `?? false`.)

### Unknown keys warn rather than fail closed

`batch: 'oops'`, `batch: null` and `{ maxsize: 1, bogus: 9 }` all reached `partialConfig?.[name]`,
yielded `undefined`, read as "not supplied" and took every default in silence.

It warns and carries on rather than failing closed the way `trackingConsent` does — a mis-sized buffer
has no privacy dimension, so answering one typo by disabling batching would cost more than the typo.
Same posture as `resolveIntent`.

---

## <a id="purge"></a>`purgeQueue({ send })`

Returns `{ ok, destroyed }` — the exported `PurgeResult`, reused by `purgeQueuedEvents` in `pug.ts` so
the aggregate cannot be re-spelled narrower there.

- `ok` answers "did the queues leave the device"
- `destroyed` is how many events that cost

`destroyed` counts **per queue** what actually left the device (a queue whose key survived destroyed
nothing; the memory-only cookieless queue always did). A single `ok && total` could not express this:
`ok` is structurally the localStorage queue's answer alone, so gating on it made a real cookieless loss
unreportable.

It **includes** each queue's in-flight locked batch, which `purge()` discards too — counting `size`
instead made the warning silent in exactly the highest-loss case — but which may still be delivered.
And a failed consented purge destroys the un-persisted debounced tail while counting 0 for the
surviving key. **So the number is approximate in both directions, never an audit.**

### `send: true` only for `reset()`

A logout, where consent is unchanged and those events were agreed to. Every consent teardown passes
false: transmitting after the user chose Reject is a fresh act of processing on data they just withdrew,
and Art. 7(3) protects the *prior* collection, not a later send.

### Why a dropped beacon does not flip `ok`

Beacons fail routinely under content blockers, so folding delivery in made `reset()` read as a failed
teardown on verifiably clean devices — and the README recipe shows that boolean to end users as
"identity may remain". The farewell loss reports through `reportBeaconLoss` instead.

### The farewell report is held until after both purges

`terminal` asserts the events are **gone**, which only the purge knows. Announced beforehand it printed
"dropped unsent — the queue is removed" one line above `purge()`'s own "may be sent on a later visit" —
the second being the true one, since a surviving key really does hydrate and send on the next `init()`.
Claiming destruction is the wrong direction for a privacy-relevant message.

When the purge lands, the message still says the events were dropped unsent rather than the other
phases' "will retry on next `init()`", which is false exactly there.

### The `sync()` before `purge()` under `send`

Events younger than the 1s persist debounce live only in the buffer, which `purge()` clears while
cancelling the pending write — so a purge that failed to remove the key destroyed exactly that tail
(the click that triggered the navigation) while the surviving key made every report claim it back.

The sync is **gated on `send`, i.e. `reset()` only**: a logout leaves consent untouched, so writing the
tail down before removing it is a write the user already agreed to. Every consent teardown passes false
and must not write at all — a rewrite-then-remove is still a device write, and under the `'cookieless'`
default the SDK promises none. Pinned by "writes nothing to the device when a leftover queue meets a
cookieless init", which is what caught an unconditional version of this.

So `destroyed`'s undercount is closed on the `reset()` path and stands, deliberately, on the consent
teardown.

---

## Failure reporting levels

`destroy()`'s beacon-failure path logs the two outcomes at different levels:

- consented events remain in the persisted queue → `log.warn`, recoverable on the next `init()`
- cookieless events are gone with the memory-only queue → `log.error`, permanent

`beacon()` returns false whenever `sendBeacon` is absent or blocked, not only on payload rejection.

**Recoverability is judged by the queue implementation chosen at creation, never a storage probe at
report time** — a probe that healed after creation promised recovery from a memory queue dying with the
page.

The page-hide failure paths `sync()` the debounce to disk before reporting, so "remain in the persisted
queue" is true for the freshest events.

## Error classification

Permanent: non-`RpcError`, or `RpcError` with gRPC codes 3/5/6/7/9/12/16. Transient: retry via
rollback, only for `RpcError` with retryable codes.

`rpc.ts` deliberately does not wrap *every* failure: a 2xx body that is not protobuf and a `toBinary`
bug surface raw, which this layer treats as permanent and drops rather than retrying forever.
