// The two ConsentGate values every suite that touches a gated factory needs.
//
// Minting them per suite meant four copies of the same `as GrantedGate` cast, which is the one
// thing the brand exists to keep rare — when `__gate` changes shape, this is the single place that
// has to follow. The import is type-only, so this module has zero runtime imports and is safe in
// the suites that drive `vi.resetModules()` with dynamic imports.
//
// Excluded from tsconfig.json (never emitted to dist/) but included in tsconfig.typecheck.json,
// like the other *.test-utils.ts.
import type { GrantedGate } from './tracking-consent.js'

/** Consent granted — identity writes permitted. */
export const GRANTED = ((): boolean => true) as GrantedGate

/** Consent withheld — the gated write paths must stay off. */
export const DENIED = ((): boolean => false) as GrantedGate
