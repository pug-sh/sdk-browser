import { log } from './logger.js'
import { isStorageAvailable, makeStorageKey } from './utils.js'

export type TrackingConsent = 'granted' | 'denied'

export interface TrackingConsentOptions {
  readonly projectId: string
  /** Initial consent used when nothing is persisted (or persistence is off). Defaults to `'granted'`. */
  readonly defaultConsent?: TrackingConsent
  /**
   * When `true`, the consent decision is persisted to `localStorage` (project-namespaced
   * `__pug_<projectId>_consent__`) and a previously stored decision takes precedence over
   * `defaultConsent` when the controller is constructed. This makes an opt-out sticky across reloads
   * without the integrator wiring up their own storage. If the stored decision cannot be read, the
   * controller fails safe to `'denied'`. Defaults to `false` (in-memory only).
   */
  readonly persist?: boolean
}

const isTrackingConsent = (value: string | null): value is TrackingConsent => value === 'granted' || value === 'denied'

export const createTrackingConsent = ({
  projectId,
  defaultConsent = 'granted',
  persist = false,
}: TrackingConsentOptions) => {
  const storage = persist && isStorageAvailable() ? localStorage : null
  const storageKey = makeStorageKey(projectId, 'consent')

  // The caller asked us to persist, but storage is unreachable (private mode, quota, blocked).
  // A prior opt-out may exist that we can't read, so we'll silently fall back to `defaultConsent`
  // — if that default is `granted`, an opted-out user is re-enabled. Warn so integrators relying
  // on sticky opt-out aren't blind to it. (A read that throws after a passing probe is handled
  // separately below and fails safe to `denied`.)
  if (persist && !storage) {
    log.warn('persistTrackingConsent is enabled but storage is unavailable; consent will not persist across reloads.')
  }

  let status: TrackingConsent = defaultConsent

  // A persisted decision is the user's last explicit choice — it wins over the caller-supplied
  // default so an opt-out survives reloads (the persist-opt-state-by-default behavior of
  // posthog-js / mixpanel-js).
  if (storage) {
    try {
      const stored = storage.getItem(storageKey)
      if (isTrackingConsent(stored)) {
        status = stored
      } else if (stored !== null) {
        // Present but unrecognized (corruption, a colliding key, a future format): a present
        // consent value we can't parse is unexpected, so warn rather than drop it silently. An
        // absent value (`null`) is the normal first-run case and stays quiet.
        log.warn(`Ignoring malformed persisted tracking consent: ${JSON.stringify(stored)}`)
      }
    } catch (err) {
      // We cannot read the prior decision. For a consent gate, "unknown" must mean "denied" —
      // never silently inherit a `granted` default and re-enable tracking for a user who may have
      // opted out. Fail safe and log loudly (a read fault here is privacy-affecting, not benign).
      log.error('Failed to read tracking consent from storage; failing safe to denied:', err)
      status = 'denied'
    }
  }

  const write = (value: TrackingConsent): void => {
    if (!storage) {
      return
    }
    try {
      storage.setItem(storageKey, value)
    } catch (err) {
      // A failed *denial* persist means an opt-out won't survive the next reload — surface it
      // louder than a failed grant, which only costs some analytics.
      const logFailure = value === 'denied' ? log.error : log.warn
      logFailure(`Failed to persist tracking consent (${value}) to storage:`, err)
    }
  }

  return {
    getConsent: (): TrackingConsent => status,
    isGranted: (): boolean => status === 'granted',
    optIn: (): void => {
      status = 'granted'
      write('granted')
    },
    optOut: (): void => {
      status = 'denied'
      write('denied')
    },
  }
}

export type TrackingConsentController = ReturnType<typeof createTrackingConsent>
