/**
 * Type-level tests for `CrossSubdomainConfig`. Never executed and never emitted: `bun run typecheck`
 * checks this file with tsc, the build's tsconfig excludes `*.test-d.ts`, and vitest does not match
 * it.
 *
 * `domain` is required in the object arm so `{}` cannot be legal: it would otherwise infer the
 * cross-subdomain opt-in that CLAUDE.md and the threat model say is never inferred, and a config
 * builder spreading unset optionals produces exactly that object. Cookie lifetime moved to the
 * top-level `maxAgeDays` init option, so the object arm has nothing else it could carry.
 *
 * This is the compile-time half only. `createCookieLayer` enforces the same rule at runtime —
 * required, because the one-tag install feeds this from `data-options` JSON that no compiler sees —
 * and `cookie.test.ts` covers that. Neither half is redundant: the type catches it in the editor for
 * npm consumers, the runtime check is the only thing standing between a `{}` in customer HTML and a
 * cookie on the registrable domain.
 *
 * Each `@ts-expect-error` is the guard and fails in the right direction: if the expected error stops
 * happening, tsc reports the unused directive itself (TS2578).
 */
import type { CookieLayer, CrossSubdomainConfig } from './cookie.js'
import { encodeStored } from './utils.js'

// ── The legal shapes must compile ────────────────────────────────────────────────────────────────
const off: CrossSubdomainConfig = false
const on: CrossSubdomainConfig = true
const pinned: CrossSubdomainConfig = { domain: 'acme.com' }

void off
void on
void pinned

// ── Opting in must be stated ─────────────────────────────────────────────────────────────────────

// @ts-expect-error an empty object must not opt into cross-subdomain identity
const inferred: CrossSubdomainConfig = {}

// Carries `domain`, so it is legal on every count except the one under test — without that, this
// errors merely for missing `domain` (exactly as `inferred` above does) and re-adding `maxAgeDays`
// to the object arm leaves typecheck green.
// @ts-expect-error cookie lifetime is the top-level `maxAgeDays` init option, not a cookie setting
const lifetimeHere: CrossSubdomainConfig = { domain: 'acme.com', maxAgeDays: 180 }

// Excess-property checking guards only fresh literals, so the literal case above closed nothing for
// a config builder holding the old documented shape in a variable or spreading it — both compiled,
// and resolveIntent then silently replaced the deliberately shortened lifetime with the 365-day
// default. Closed by `maxAgeDays?: never` on the object arm, the EventIdentity pattern.
const held = { domain: 'acme.com', maxAgeDays: 180 }

// @ts-expect-error the stale lifetime arm must not compile from a variable either
const heldConfig: CrossSubdomainConfig = held

// @ts-expect-error nor via spread into a fresh literal
const spreadConfig: CrossSubdomainConfig = { ...held }

// `maxAgeSeconds` is required: a defaulted lifetime would silently give a cookie a duration nobody
// chose, and this is the one load-bearing signature a quiet `?:`-plus-internal-default revert would
// not trip anywhere else.
declare const layer: CookieLayer

// @ts-expect-error every cookie write must state the value's remaining lifetime
layer.set('key', 'value')

// The value must be enveloped (`StoredEnvelope`, minted by encodeStored): reads prefer the cookie
// layer, and a bare value written through set() reads as undecodable and is deleted by the store's
// next getItem — silent identity loss the brand turns into a compile error at the seam.

// @ts-expect-error a bare string is not an enveloped stored value
layer.set('key', 'value', 60)

// …while the enveloped spelling compiles.
layer.set('key', encodeStored('value', Date.now() + 60_000), 60)

void inferred
void lifetimeHere
void heldConfig
void spreadConfig
