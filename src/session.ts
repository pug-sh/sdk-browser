import { uuidv7 } from 'uuidv7'
import { isStorageAvailable } from './utils.js'

interface SessionState {
  readonly sessionId: string
  readonly startTime: number
  readonly lastActivityTime: number
}

export interface SessionConfig {
  readonly idleTimeoutMinutes?: number
  readonly maxSessionSeconds?: number
}

const STORAGE_KEY = 'cotton_session_state'
let idleTimeoutMs = 30 * 60 * 1000
let maxSessionMs = 24 * 60 * 60 * 1000

export const configureSession = (config: SessionConfig): void => {
  if (config.idleTimeoutMinutes) idleTimeoutMs = config.idleTimeoutMinutes * 60 * 1000
  if (config.maxSessionSeconds) maxSessionMs = config.maxSessionSeconds * 1000
}

let sessionState: SessionState | null = null
const storage: Storage | null = isStorageAvailable(localStorage) ? localStorage : null
if (!storage) console.warn('[Cotton SDK] Storage unavailable; session state will not persist.')

const readStorage = (): SessionState | null => {
  if (!storage) return null
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (parsed && typeof parsed.sessionId === 'string') return parsed as SessionState
  } catch {
    // corrupted or missing — start fresh
  }
  return null
}

const writeStorage = (state: SessionState): void => {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    console.warn('[Cotton SDK] Failed to persist session to storage:', err)
  }
}

const isExpired = (state: SessionState): boolean => {
  const now = Date.now()
  return now - state.startTime > maxSessionMs || now - state.lastActivityTime > idleTimeoutMs
}

export const rotate = (): void => {
  const now = Date.now()
  const newState: SessionState = { sessionId: uuidv7(), startTime: now, lastActivityTime: now }
  sessionState = newState
  writeStorage(newState)
}

export const resolveSessionId = (): string => {
  sessionState = readStorage() ?? sessionState
  if (!sessionState || isExpired(sessionState)) rotate()

  const next = { ...(sessionState as SessionState), lastActivityTime: Date.now() }
  sessionState = next
  writeStorage(next)
  return next.sessionId
}

export const destroySession = (): void => {
  storage?.removeItem(STORAGE_KEY)
  sessionState = null
  idleTimeoutMs = 30 * 60 * 1000
  maxSessionMs = 24 * 60 * 60 * 1000
}
