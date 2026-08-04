# Design notes

Why the code is the way it is.

These files hold the reasoning that used to live in block comments inside `src/`. The split rule:

> **If deleting a line of code would be stopped by a comment, that comment stays inline.**
> If it explains *how we got here* — the bug that motivated it, what was measured, which options were
> rejected — it lives here.

So the code states its invariants and links out; these notes carry the history. Inline `@see` links
target the `##`/`###` anchors below, e.g. `@see docs/design-notes/cookie.md#preserved-twins`.

## Why this exists

Between 2026-07-11 and 2026-08-01 the SDK grew 74% in production code, 148% in tests, and 226% in
CLAUDE.md — entirely from review-driven hardening, with no feature commits in the window. Every
mechanism closes a real bug. But the ratio reached roughly three lines of explanation per line of
behavior, and the explanations invented a private vocabulary (twins, gates, latches, residue,
envelopes, probes) that had to be learned before any file could be read.

Nothing was deleted in that consolidation. The prose moved here.

## Reading order

If you are new to the codebase, read in this order — each assumes the one before it:

1. [`pug.md`](pug.md) — the entry point, init ordering, and the consent transition matrix
2. [`tracking-consent.md`](tracking-consent.md) — the three-state model and the two gates
3. [`persistence.md`](persistence.md) — the storage layering and the retention envelope
4. [`cookie.md`](cookie.md) — cross-subdomain identity and the twin protocol
5. [`batch.md`](batch.md) — the dual queues and the send state machine

The rest are reference: [`session.md`](session.md), [`profile.md`](profile.md),
[`track.md`](track.md), [`utils.md`](utils.md), [`auto-capture.md`](auto-capture.md),
[`cdn.md`](cdn.md).

## The one thing to know first

Most of the defensive machinery in `cookie.ts` and `persistence.ts` exists because
**cross-subdomain tracking is opt-in but off by default**. When it is off, persistence is plain
origin-scoped `localStorage` and none of the twin protocol can occur. If that feature is ever
dropped, the machinery goes with it — not because anyone judged it unnecessary, but because its
failure modes stop existing.
