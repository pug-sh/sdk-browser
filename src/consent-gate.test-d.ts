/**
 * Type-level tests for the ConsentGate brands (tracking-consent.ts). The brands exist because both
 * gates are `() => boolean` injected positionally, and one swap — `configureProfile` receiving
 * `isTracking` — wrote a durable externalId to the device in cookieless mode, invisible to types
 * and to every runtime test. The phantom `__gate` member is *required* so the brand cannot be
 * laundered off via a variable annotation or a wrapper arrow; reverting it to optional re-opens
 * exactly that laundering with nothing else in the build failing — these directives fail instead
 * (TS2578 when the expected error stops happening).
 */
import { createCookieLayer } from './cookie.js'
import { configureProfile } from './profile.js'
import { configureSession } from './session.js'
import type { GrantedGate, TrackingGate } from './tracking-consent.js'

declare const bare: () => boolean
declare const granted: GrantedGate
declare const tracking: TrackingGate

// @ts-expect-error a bare predicate must not satisfy the granted gate (laundering via annotation)
const g1: GrantedGate = bare

// @ts-expect-error nor via a wrapper arrow
const g2: GrantedGate = () => bare()

// @ts-expect-error the tracking gate must not stand in where identity-storage writes are gated
const g3: GrantedGate = tracking

// @ts-expect-error nor the granted gate where event flow is gated — the swap has two directions,
// and the second (configureProfile's bug mirrored) silently stops cookieless capture instead
const g4: TrackingGate = granted

// The branded values themselves flow where their own gate is expected.
const ok1: GrantedGate = granted
const ok2: TrackingGate = tracking

/**
 * Arity, not just the brand. An omitted gate is invisible at runtime in every direction: session.ts
 * defaults it to permitted (`isGrantedFn?.() ?? true`), so identity gets written; cookie.ts calls it
 * bare inside reconcileTwin's try, so it throws, un-latches and silently skips the promotion. Either
 * way nothing fails loudly. Reverting any one parameter to optional leaves typecheck and the whole
 * runtime suite green (verified), which is what these directives close: they go unused, and TS2578
 * fails the build.
 *
 * Never called — `.test-d.ts` files are typechecked only.
 */
const arity = (): void => {
  // @ts-expect-error configureProfile's gate is required
  configureProfile('p', null)
  // @ts-expect-error configureSession's gate is required
  configureSession('p', undefined, null)
  // @ts-expect-error createCookieLayer's gate is required — it guards the twin promotion, the one
  // identity write that happens on a *read*
  createCookieLayer(true)
}
void arity

void g1
void g2
void g3
void g4
void ok1
void ok2
