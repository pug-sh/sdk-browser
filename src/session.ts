import { uuidv7 } from 'uuidv7'
import { log } from './logger.js'
import { type PersistentStore, resolveStore } from './persistence.js'
import type { GrantedGate } from './tracking-consent.js'
import { isStorageAvailable, makeStorageKey } from './utils.js'

interface StoredState {
  readonly sessionId: string
  readonly startTime: number
  readonly lastActivityTime: number
  readonly deviceId: string
}

export interface SessionConfig {
  readonly idleTimeoutMinutes?: number | undefined
  readonly maxSessionMinutes?: number | undefined
}

const DEFAULT_CONFIG = {
  idleTimeoutMs: 30 * 60 * 1000,
  maxSessionMs: 1440 * 60 * 1000,
  storageKey: '',
}

const HEARTBEAT_INTERVAL_MS = 10_000

// In cross-subdomain mode the session rides a cookie the browser attaches to every request, so
// persisting lastActivityTime per event would rewrite it constantly. Only the persisted timestamp
// lags; in-memory stays exact and session-id changes still persist immediately.
const ACTIVITY_PERSIST_THROTTLE_MS = 10_000

let config = { ...DEFAULT_CONFIG }

let state: StoredState | null = null
let store: PersistentStore | null = null
// Tab registry stays on raw localStorage: tab liveness is origin-local bookkeeping and must never
// ride a cookie (chatty writes on a header-bearing channel, and meaningless on other subdomains).
let tabsStorage: Storage | null = null
let tabsKey = ''
let tabId = ''
let lastHeartbeat = 0
let lastPersistMs = 0
let fallbackSessionId = ''
let onPageHide: (() => void) | null = null
// Retained at module scope so the registry can be re-armed on a mid-page grant, clearSession() can
// derive the registry key without this page having armed it, and the write paths below can consult
// consent — which became runtime-mutable with setTrackingConsent(), so gating only at configure
// time would guard creation and leave every later write open.
let sessionProjectId = ''
let isGrantedFn: GrantedGate | null = null

/**
 * Gates the *deliberate* device writes — rotate(), resetIdentity(), the tab registry. Not every
 * write: resolveSessionId()'s activity persist is ungated, safe only because track() branches on
 * consent first. An absent gate reads as *withheld*, like everywhere else in the gate chain
 * (deferredGrantedGate, the cookie layer): the fail-open `?? true` this replaces was the one place
 * an untyped caller's omitted argument silently wrote identity with full permission.
 */
const mayWriteToDevice = (): boolean => isGrantedFn?.() ?? false

export const configureSession = (
  projectId: string,
  sessionConfig: SessionConfig | undefined,
  persistentStore: PersistentStore | null | undefined,
  // Required, not optional: an omitted gate reads as withheld (mayWriteToDevice fails closed), so
  // it plants no identifier — but granted-mode sessions silently stop persisting, and only the
  // arity pin in consent-gate.test-d.ts turns that omission into a build failure.
  isGranted: GrantedGate,
): void => {
  store = resolveStore(persistentStore)
  if (!store) {
    log.warn('Storage unavailable; session state will not persist.')
  }
  fallbackSessionId = uuidv7()
  sessionProjectId = projectId
  isGrantedFn = isGranted
  config.storageKey = makeStorageKey(projectId, 'session')

  if (sessionConfig?.idleTimeoutMinutes != null) {
    if (sessionConfig.idleTimeoutMinutes > 0) {
      config.idleTimeoutMs = sessionConfig.idleTimeoutMinutes * 60 * 1000
    } else {
      log.warn('session.idleTimeoutMinutes must be > 0, using default.')
    }
  }
  if (sessionConfig?.maxSessionMinutes != null) {
    if (sessionConfig.maxSessionMinutes > 0) {
      config.maxSessionMs = sessionConfig.maxSessionMinutes * 60 * 1000
    } else {
      log.warn('session.maxSessionMinutes must be > 0, using default.')
    }
  }

  armTabRegistry({ detectClosedTabs: true })
}

/**
 * Registers this tab in the origin-local liveness registry and attaches the pagehide reaper.
 * `detectClosedTabs` runs the "no live tabs survived → rotate" heuristic, which only makes sense at
 * init() — on a mid-page re-grant this tab is demonstrably alive, so running it would rotate a live
 * session.
 */
const armTabRegistry = ({ detectClosedTabs }: { detectClosedTabs: boolean }): void => {
  // Tab liveness is origin-local, so with a shared session an init on one subdomain with no live
  // tabs there would rotate a session still active on a sibling. Idle/max timeout only in that mode.
  if (store?.crossSubdomain) {
    return
  }

  // A device write, so it needs full consent. setTrackingConsent() re-arms on a later grant.
  if (!mayWriteToDevice()) {
    return
  }

  // Already armed (a re-grant, or a redundant call) — the entry and listener stand.
  if (tabId) {
    return
  }

  tabsStorage = isStorageAvailable() ? localStorage : null
  tabsKey = makeStorageKey(sessionProjectId, 'tabs')
  tabId = Math.random().toString(36).slice(2)

  // Per-tab timestamps in localStorage, pruned on init. If none survive, all tabs were closed →
  // rotate. Self-heals from crashed tabs, since stale entries are pruned automatically.
  if (tabsStorage) {
    try {
      let tabs: Record<string, number> = {}
      try {
        tabs = JSON.parse(tabsStorage.getItem(tabsKey) ?? '{}')
      } catch {
        // corrupted — start fresh
      }

      const now = Date.now()
      const alive: Record<string, number> = {}
      for (const [id, ts] of Object.entries(tabs)) {
        if (typeof ts === 'number' && now - ts < config.idleTimeoutMs) {
          alive[id] = ts
        }
      }

      const allTabsWereClosed = Object.keys(alive).length === 0
      alive[tabId] = now
      lastHeartbeat = now
      tabsStorage.setItem(tabsKey, JSON.stringify(alive))

      if (detectClosedTabs && allTabsWereClosed) {
        const existing = read()
        if (existing) {
          rotate()
        }
      }

      onPageHide = () => {
        try {
          if (!tabsStorage) {
            return
          }
          const current: Record<string, number> = JSON.parse(tabsStorage.getItem(tabsKey) ?? '{}')
          delete current[tabId]
          tabsStorage.setItem(tabsKey, JSON.stringify(current))
        } catch {
          // storage may be unavailable during unload
        }
      }
      window.addEventListener('pagehide', onPageHide)
    } catch (err) {
      log.warn('Tab tracking initialization failed:', err)
    }
  }
}

/**
 * Detaches the pagehide reaper and forgets this tab's registry identity, so no later write path can
 * recreate an entry. `purge` removes the whole registry key (a privacy teardown wiping the device);
 * without it only this tab's own entry is dropped (an ordinary teardown — sibling tabs live on).
 */
const releaseTabRegistry = ({ purge }: { purge: boolean }): boolean => {
  if (onPageHide) {
    window.removeEventListener('pagehide', onPageHide)
    onPageHide = null
  }
  let released = true
  try {
    if (purge) {
      // A device wipe must not depend on this page having armed the registry: armTabRegistry()
      // returns early whenever consent withholds it, which is exactly the state a purge runs in, so
      // keying the removal on those handles made it a silent no-op that reported success. Derive the
      // key instead; only the entry-level path below needs tabId.
      const storage = tabsStorage ?? (isStorageAvailable() ? localStorage : null)
      const key = tabsKey || (sessionProjectId ? makeStorageKey(sessionProjectId, 'tabs') : '')
      if (storage && key) {
        storage.removeItem(key)
        released = storage.getItem(key) === null
      }
      // When storage is unavailable at teardown time, the skip above leaves `released` true —
      // unavailable-for-writes treated as evidence-of-absence. A registry key written while storage
      // *was* usable could in principle survive unreachable; accepted, because a store that cannot
      // be read cannot be verified either, and reporting false forever on storageless devices would
      // make every teardown boolean useless there. The registry holds per-tab timestamps, never
      // identifiers, and its stale entries are pruned by their own idle timeout on the next arm.
    } else if (tabsStorage && tabsKey && tabId) {
      const tabs: Record<string, number> = JSON.parse(tabsStorage.getItem(tabsKey) ?? '{}')
      delete tabs[tabId]
      if (Object.keys(tabs).length === 0) {
        tabsStorage.removeItem(tabsKey)
      } else {
        tabsStorage.setItem(tabsKey, JSON.stringify(tabs))
      }
    }
  } catch (err) {
    log.warn('Failed to update tab registry:', err)
    released = false
  }
  tabsStorage = null
  tabsKey = ''
  tabId = ''
  lastHeartbeat = 0
  return released
}

/**
 * Re-arms the tab registry after consent is granted mid-page. Called by setTrackingConsent() —
 * without it the liveness heuristic stays dead for the rest of the page's life, and the README's
 * recommended consent-first flow (init() before the banner is answered) never arms it at all.
 */
export const onConsentGranted = (): void => {
  if (!config.storageKey) {
    return
  }
  armTabRegistry({ detectClosedTabs: false })
}

const read = (): StoredState | null => {
  if (!store) {
    return null
  }
  try {
    const raw = store.getItem(config.storageKey)
    if (raw === null) {
      return null // absent is the ordinary first visit, not a fault — silent
    }
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.deviceId === 'string' &&
      typeof parsed.startTime === 'number' &&
      typeof parsed.lastActivityTime === 'number'
    ) {
      return parsed as StoredState
    }
    // Present but malformed must not share absence's silence: falling through quietly rotated the
    // session with no trace of why analytics saw a new one. The value is omitted from the message
    // for the same reason the parse error is below — it can echo identity fragments.
    log.warn('Stored session state is malformed; starting fresh.')
  } catch {
    // Omit the parse error: its message can echo a fragment of the stored session JSON.
    log.warn('Failed to read session state; starting fresh.')
  }
  return null
}

const write = (s: StoredState): boolean => {
  if (!store) {
    return false
  }
  // Advance the throttle clock only on a persist that actually landed, so a dropped write leaves
  // lastPersistMs stale and is retried on the next event rather than suppressed for the window. The
  // store already logs the underlying failure, so this frequent path stays quiet.
  const persisted = store.setItem(config.storageKey, JSON.stringify(s))
  if (persisted) {
    lastPersistMs = Date.now()
  }
  // Debounced heartbeat — only update if enough time has passed.
  if (tabsStorage && tabId && tabsKey) {
    try {
      const now = Date.now()
      if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        const tabs: Record<string, number> = JSON.parse(tabsStorage.getItem(tabsKey) ?? '{}')
        tabs[tabId] = now
        tabsStorage.setItem(tabsKey, JSON.stringify(tabs))
        lastHeartbeat = now
      }
    } catch (err) {
      log.warn('Failed to update tab registry:', err)
    }
  }
  return persisted
}

const isExpired = (s: StoredState): boolean => {
  const now = Date.now()
  return now - s.startTime > config.maxSessionMs || now - s.lastActivityTime > config.idleTimeoutMs
}

// Rotates session only — preserves deviceId across sessions
export const rotate = (): void => {
  if (!config.storageKey) {
    log.warn('rotate() called before init().')
    return
  }
  const now = Date.now()
  const deviceId = state?.deviceId ?? read()?.deviceId ?? uuidv7()
  const next: StoredState = { sessionId: uuidv7(), startTime: now, lastActivityTime: now, deviceId }
  state = next
  // Public API, so reachable while cookieless or denied — where writing a fresh session id would
  // plant the identifier those states promise not to store. A later grant persists lazily.
  if (!mayWriteToDevice()) {
    log.debug('rotate() rotated the session in memory only — consent does not permit writing to the device.')
    return
  }
  // `store &&` skips the in-memory-only case, which configureSession already warned about.
  if (store && !write(next)) {
    log.warn('Failed to persist the rotated session; the new session id may not survive a page load.')
  }
}

export const resolveSessionId = (): string => {
  try {
    state = read() ?? state
    if (!state || isExpired(state)) {
      rotate()
    }

    if (!state) {
      log.warn('Session state unavailable after rotation attempt.')
      return fallbackSessionId
    }

    const next = { ...state, lastActivityTime: Date.now() }
    state = next
    // Origin-scoped stores persist every event (localStorage is cheap); cross-subdomain stores
    // throttle so the shared cookie is not rewritten on every event. A missing or expired session
    // was already persisted by rotate() above, so new session ids are never delayed.
    if (!store?.crossSubdomain || next.lastActivityTime - lastPersistMs >= ACTIVITY_PERSIST_THROTTLE_MS) {
      write(next)
    }
    return next.sessionId
  } catch (err) {
    log.warn('Failed to resolve session ID:', err)
    return state?.sessionId ?? fallbackSessionId
  }
}

/**
 * Resets both session and device ID — call on logout. Returns false when the reset could not be made
 * durable: both failure arms log and return rather than throw, so reset()'s try/catch could not see
 * them and reported success while the previous user's ids were still on the device.
 */
export const resetIdentity = (): boolean => {
  const now = Date.now()
  const next: StoredState = { sessionId: uuidv7(), startTime: now, lastActivityTime: now, deviceId: uuidv7() }
  state = next
  // Reachable from reset() while cookieless or denied, where persisting a fresh session + device id
  // would plant an identifier for a user who declined one. Clear instead of write — reset() means
  // "forget this user", and in those states nothing should be stored.
  if (!mayWriteToDevice()) {
    let cleared = true
    if (store && !store.removeItem(config.storageKey)) {
      log.error('Failed to clear the session during reset — the previous session may resurface on the next page load.')
      cleared = false
    }
    state = null
    lastPersistMs = 0
    return cleared
  }
  // Error, not warning: a failed persist means the previous session and device id resurface.
  if (store && !write(next)) {
    log.error('Failed to persist the identity reset; the previous session may resurface on the next page load.')
    return false
  }
  return true
}

// Clears the persisted session and in-memory state while leaving the module configured, so a later
// resolveSessionId() lazily starts a fresh session. The opt-out teardown, as opposed to
// destroySession()'s runtime one. In cross-subdomain mode this removes the shared cookie, so the
// opt-out propagates to sibling subdomains.
export const clearSession = (): boolean => {
  let cleared = true
  // Error level: in cross-subdomain mode a failed removal means the shared cookie survived.
  if (store && !store.removeItem(config.storageKey)) {
    log.error('Failed to clear the session from storage — it may resurface on the next page load.')
    cleared = false
  }
  // The whole registry key, not just this tab's entry — a device wipe, not a tab teardown. Left
  // behind, it survived carrying the tabId → timestamp pair written under granted consent, with the
  // reaper still attached to write again on the way out.
  if (!releaseTabRegistry({ purge: true })) {
    log.error('Failed to clear the tab registry from storage — it may resurface on the next page load.')
    cleared = false
  }
  state = null
  lastPersistMs = 0
  return cleared
}

export const destroySession = (): void => {
  // Teardown, not logout: the persisted session stays so a later init() resumes it. In
  // cross-subdomain mode removing it would end sessions site-wide from one page's teardown;
  // reset() and clearSession() are the deliberate discards. Only this tab's registry entry goes.
  releaseTabRegistry({ purge: false })
  state = null
  store = null
  lastPersistMs = 0
  fallbackSessionId = ''
  sessionProjectId = ''
  isGrantedFn = null
  config = { ...DEFAULT_CONFIG }
}
