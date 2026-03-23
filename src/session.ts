import { uuidv7 } from 'uuidv7'
import { isStorageAvailable } from './utils.js'

interface StoredState {
  readonly sessionId: string
  readonly startTime: number
  readonly lastActivityTime: number
  readonly deviceId: string
}

export interface SessionConfig {
  readonly idleTimeoutMinutes?: number
  readonly maxSessionSeconds?: number
}

let idleTimeoutMs = 30 * 60 * 1000
let maxSessionMs = 24 * 60 * 60 * 1000
let storageKey = ''

let state: StoredState | null = null
const storage: Storage | null = isStorageAvailable(localStorage) ? localStorage : null
if (!storage) console.warn('[Cotton SDK] Storage unavailable; session state will not persist.')

export const configureSession = (projectId: string, config?: SessionConfig): void => {
  storageKey = `__cotton_${projectId}__`
  if (config?.idleTimeoutMinutes) idleTimeoutMs = config.idleTimeoutMinutes * 60 * 1000
  if (config?.maxSessionSeconds) maxSessionMs = config.maxSessionSeconds * 1000
}

const read = (): StoredState | null => {
  if (!storage) return null
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? 'null')
    if (parsed && typeof parsed.sessionId === 'string' && typeof parsed.deviceId === 'string') {
      return parsed as StoredState
    }
  } catch {
    // corrupted — start fresh
  }
  return null
}

const write = (s: StoredState): void => {
  if (!storage) return
  try {
    storage.setItem(storageKey, JSON.stringify(s))
  } catch (err) {
    console.warn('[Cotton SDK] Failed to persist state to storage:', err)
  }
}

const isExpired = (s: StoredState): boolean => {
  const now = Date.now()
  return now - s.startTime > maxSessionMs || now - s.lastActivityTime > idleTimeoutMs
}

// Rotates session only — preserves deviceId across sessions
export const rotate = (): void => {
  const now = Date.now()
  const deviceId = state?.deviceId ?? uuidv7()
  const next: StoredState = { sessionId: uuidv7(), startTime: now, lastActivityTime: now, deviceId }
  state = next
  write(next)
}

export const resolveSessionId = (): string => {
  state = read() ?? state
  if (!state || isExpired(state)) rotate()

  const next = { ...(state as StoredState), lastActivityTime: Date.now() }
  state = next
  write(next)
  return next.sessionId
}

export const getDeviceId = (): string => {
  if (!state) state = read()
  if (!state) rotate()
  return (state as StoredState).deviceId
}

// Resets both session and device ID — call on logout
export const resetIdentity = (): void => {
  const now = Date.now()
  const next: StoredState = { sessionId: uuidv7(), startTime: now, lastActivityTime: now, deviceId: uuidv7() }
  state = next
  write(next)
}

export const destroySession = (): void => {
  storage?.removeItem(storageKey)
  state = null
  storageKey = ''
  idleTimeoutMs = 30 * 60 * 1000
  maxSessionMs = 24 * 60 * 60 * 1000
}
