// Test-only wrappers around the retention envelope (encodeStored/decodeStored in utils.ts).
//
// The suites that assert against raw storage each have to spell the `<expiry>|<value>` format. The
// codec was centralized to stop those hand-rolled copies drifting; these wrappers are the same
// argument one level up — the default TTL and the `?? null` convention were restated per suite.
//
// Excluded from tsconfig (so it never reaches dist/) but checked by tsconfig.typecheck, and outside
// vitest's `*.test.ts` pattern (so it is not collected as a suite).
import { decodeStored, encodeStored } from './utils.js'

/**
 * A value as it appears in storage, with a deadline far enough out to be live for the test. The
 * default is a day rather than a minute so a suite that seeds and then mocks the clock forward
 * (session.test.ts advances past the 30-minute idle timeout) does not silently see it expire.
 */
export const persisted = (value: string, expiresInMs = 86_400_000): string =>
  encodeStored(value, Date.now() + expiresInMs)

/** The value inside a raw stored string; null when absent or undecodable. */
export const storedValue = (raw: string | null): string | null => decodeStored(raw)?.value ?? null

/** The absolute deadline stamped on a raw stored string; null when absent or undecodable. */
export const expiryOf = (raw: string | null): number | null => decodeStored(raw)?.expiresAt ?? null
