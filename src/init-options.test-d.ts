/**
 * Type-level tests for the public option surfaces under `exactOptionalPropertyTypes` (on in
 * tsconfig.typecheck.json, and shipped by `@tsconfig/strictest`, which consumers use).
 *
 * A config builder holds optionals as `T | undefined` — `{ maxAgeDays: someNumberOrUndefined }` —
 * and without `| undefined` on the option members that spelling is a TS2375 for exactly the
 * population these options exist for: a privacy config assembled from a CMP. The runtime already
 * treats an explicit `undefined` as "use the default" everywhere, so admitting it costs nothing.
 * `AutoCaptureSelection`'s values are `true | undefined` for the same reason (see auto-capture.ts);
 * this file extends that standard across `InitOptions`, `TrackingConsentConfig` and
 * `SessionConfig`. Reverting any member to a bare optional fails the assignment below.
 */
import type { InitOptions, SessionConfig, TrackingConsentConfig } from './index.js'

declare const flag: boolean | undefined
declare const days: number | undefined
declare const list: readonly string[] | false | undefined
declare const state: 'granted' | 'denied' | 'cookieless' | undefined
declare const reject: 'denied' | 'cookieless' | undefined
declare const minutes: number | undefined

// The config-builder spelling must compile for every optional member.
const options: InitOptions = {
  apiKey: 'k',
  endpoint: undefined,
  batch: undefined,
  dryRun: flag,
  debug: flag,
  autoCapture: undefined,
  crossSubdomainTracking: undefined,
  maxAgeDays: days,
  redactUrlParams: list,
  beforeSend: undefined,
  trackingConsent: { initial: state, onReject: reject, persist: flag, respectGpc: flag },
  session: { idleTimeoutMinutes: minutes, maxSessionMinutes: minutes },
}

const sessionOnly: SessionConfig = { idleTimeoutMinutes: minutes }
const consentOnly: TrackingConsentConfig = { initial: state }

void options
void sessionOnly
void consentOnly
