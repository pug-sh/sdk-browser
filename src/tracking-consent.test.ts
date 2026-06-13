import { beforeEach, describe, expect, it, vi } from 'vitest'

const logSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('./logger.js', () => ({
  log: logSpies,
}))

import { createTrackingConsent } from './tracking-consent.js'
import { makeStorageKey } from './utils.js'

const PROJECT_ID = 'proj'
const CONSENT_KEY = makeStorageKey(PROJECT_ID, 'consent')

interface MockStorageOptions {
  readonly throwOnGet?: boolean
  /** Return true for a key whose `setItem` should throw. The availability probe uses a `probe` key. */
  readonly throwOnSet?: (key: string) => boolean
}

const createMockStorage = (opts: MockStorageOptions = {}): Storage => {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => {
      if (opts.throwOnGet) {
        throw new Error('getItem blocked')
      }
      return store[key] ?? null
    },
    setItem: (key: string, value: string) => {
      if (opts.throwOnSet?.(key)) {
        throw new Error('setItem blocked')
      }
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key]
      }
    },
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
}

const installStorage = (storage: Storage | null): void => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  installStorage(createMockStorage())
})

describe('createTrackingConsent — in-memory (persist: false)', () => {
  it('defaults to granted', () => {
    const c = createTrackingConsent({ projectId: PROJECT_ID })
    expect(c.getConsent()).toBe('granted')
    expect(c.isGranted()).toBe(true)
  })

  it('honors the supplied default', () => {
    const c = createTrackingConsent({ projectId: PROJECT_ID, defaultConsent: 'denied' })
    expect(c.isGranted()).toBe(false)
  })

  it('never reads or writes storage', () => {
    const storage = createMockStorage()
    const getItem = vi.spyOn(storage, 'getItem')
    const setItem = vi.spyOn(storage, 'setItem')
    installStorage(storage)

    const c = createTrackingConsent({ projectId: PROJECT_ID })
    c.optOut()
    c.optIn()

    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('ignores a persisted value when persistence is off', () => {
    const storage = createMockStorage()
    storage.setItem(CONSENT_KEY, 'denied')
    installStorage(storage)

    const c = createTrackingConsent({ projectId: PROJECT_ID, defaultConsent: 'granted' })
    expect(c.isGranted()).toBe(true)
  })
})

describe('createTrackingConsent — persisted (persist: true)', () => {
  it('uses the default when nothing is stored', () => {
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'granted' })
    expect(c.isGranted()).toBe(true)
    expect(logSpies.warn).not.toHaveBeenCalled()
  })

  it('restores a persisted denied over a granted default', () => {
    localStorage.setItem(CONSENT_KEY, 'denied')
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'granted' })
    expect(c.isGranted()).toBe(false)
  })

  it('restores a persisted granted over a denied default', () => {
    localStorage.setItem(CONSENT_KEY, 'granted')
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'denied' })
    expect(c.isGranted()).toBe(true)
  })

  it('persists granted on optIn and denied on optOut', () => {
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true })
    c.optOut()
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied')
    c.optIn()
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted')
  })

  it('optIn overrides a restored opt-out, flipping status and overwriting storage', () => {
    // User opted out previously; now changes their mind on a later load.
    localStorage.setItem(CONSENT_KEY, 'denied')
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'granted' })
    expect(c.getConsent()).toBe('denied') // restored

    c.optIn()
    expect(c.getConsent()).toBe('granted')
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted')
  })

  it('warns when persist is requested but storage is unavailable', () => {
    // setItem always throws → the availability probe fails → storage is treated as unavailable.
    installStorage(createMockStorage({ throwOnSet: () => true }))

    createTrackingConsent({ projectId: PROJECT_ID, persist: true })
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('storage is unavailable'))
  })
})

describe('createTrackingConsent — malformed / corrupted storage', () => {
  it('ignores a present-but-unrecognized value and warns', () => {
    localStorage.setItem(CONSENT_KEY, 'garbage')
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'granted' })

    expect(c.isGranted()).toBe(true) // fell back to default
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('malformed persisted tracking consent'))
  })

  it('stays silent when nothing is stored (null is the normal first run)', () => {
    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true })
    expect(c.isGranted()).toBe(true)
    expect(logSpies.warn).not.toHaveBeenCalled()
  })
})

describe('createTrackingConsent — storage failures fail safe', () => {
  it('fails safe to denied and logs error when the read throws', () => {
    // Probe (setItem/removeItem) succeeds so storage is considered available; only getItem throws.
    installStorage(createMockStorage({ throwOnGet: true }))

    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'granted' })

    expect(c.isGranted()).toBe(false) // did NOT inherit the granted default
    expect(logSpies.error).toHaveBeenCalledWith(expect.stringContaining('failing safe to denied'), expect.any(Error))
  })

  it('keeps the in-memory opt-out and logs error when the denial write throws', () => {
    // Availability probe uses a `probe` key; only the consent-key write throws.
    installStorage(createMockStorage({ throwOnSet: key => key === CONSENT_KEY }))

    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true })
    expect(() => c.optOut()).not.toThrow()

    expect(c.isGranted()).toBe(false) // current session still honors the opt-out
    expect(logSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist tracking consent (denied)'),
      expect.any(Error),
    )
  })

  it('logs only a warn when the grant write throws', () => {
    installStorage(createMockStorage({ throwOnSet: key => key === CONSENT_KEY }))

    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true, defaultConsent: 'denied' })
    expect(() => c.optIn()).not.toThrow()

    expect(c.isGranted()).toBe(true)
    expect(logSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist tracking consent (granted)'),
      expect.any(Error),
    )
    expect(logSpies.error).not.toHaveBeenCalled()
  })

  it('runs in memory when storage is unavailable despite persist: true', () => {
    // setItem always throws → the availability probe fails → storage is treated as unavailable.
    installStorage(createMockStorage({ throwOnSet: () => true }))

    const c = createTrackingConsent({ projectId: PROJECT_ID, persist: true })
    expect(() => c.optOut()).not.toThrow()

    expect(c.isGranted()).toBe(false)
    // No persistence attempted, so no persist-failure log fires.
    expect(logSpies.error).not.toHaveBeenCalled()
  })
})
