import type { CookieLayer } from './cookie.js'
import { log } from './logger.js'
import { DEFAULT_MAX_AGE_DAYS, decodeStored, encodeStored, isStorageAvailable, SECONDS_PER_DAY } from './utils.js'

/**
 * Layered key-value persistence: an optional cross-subdomain cookie layer over localStorage.
 * Reads prefer the cookie (it is the shared source of truth across subdomains — a stale per-origin
 * localStorage value must not shadow it); writes go to every available layer; methods never throw.
 *
 * Every value carries an absolute expiry (see `encodeStored`), so nothing stored here outlives
 * `maxAgeDays` in any mode — including plain localStorage, which has no expiry of its own.
 */
export interface PersistentStore {
  getItem(key: string): string | null
  /**
   * Returns true when the value will be readable on the next page load. In cross-subdomain mode
   * that requires the cookie write to land (reads trust only the cookie); otherwise any layer
   * suffices.
   */
  setItem(key: string, value: string): boolean
  /**
   * Returns true when a subsequent getItem would return null — the value is gone from every layer
   * reads consult (the cookie in cross-subdomain mode; both layers otherwise). Lets opt-out/reset
   * surface a privacy teardown that did not land.
   */
  removeItem(key: string): boolean
  /** True when values are shared across subdomains via a domain-scoped cookie. */
  readonly crossSubdomain: boolean
}

/** Chromium silently shortens any cookie past this. */
const BROWSER_COOKIE_CAP_DAYS = 400

const MS_PER_DAY = SECONDS_PER_DAY * 1000

// Untrusted: the one-tag install feeds this from `data-options` JSON. `hasCookies` gates only the
// browser-cap warning — warning about a cookie the default localStorage-only install never writes
// points integrators at a feature they did not enable.
const resolveMaxAgeMs = (maxAgeDays: number | undefined, hasCookies: boolean): number => {
  if (maxAgeDays === undefined) {
    return DEFAULT_MAX_AGE_DAYS * MS_PER_DAY
  }
  if (typeof maxAgeDays !== 'number' || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    log.warn(
      `maxAgeDays ${JSON.stringify(maxAgeDays)} must be a number greater than 0; using the ${DEFAULT_MAX_AGE_DAYS}-day default.`,
    )
    return DEFAULT_MAX_AGE_DAYS * MS_PER_DAY
  }
  if (hasCookies && maxAgeDays > BROWSER_COOKIE_CAP_DAYS) {
    log.warn(
      `maxAgeDays ${maxAgeDays} exceeds the ${BROWSER_COOKIE_CAP_DAYS}-day cap Chromium enforces on cookies; the cookie will be shortened by the browser.`,
    )
  }
  return Math.round(maxAgeDays * MS_PER_DAY)
}

/**
 * Returns null only when no layer is usable (cookies absent and localStorage unavailable).
 * `maxAgeDays` bounds how long any stored value is kept, in every mode.
 */
export const createPersistentStore = (cookies: CookieLayer | null, maxAgeDays?: number): PersistentStore | null => {
  const local = isStorageAvailable() ? localStorage : null
  if (!local && !cookies) {
    return null
  }
  const maxAgeMs = resolveMaxAgeMs(maxAgeDays, cookies !== null)
  const crossSubdomain = cookies?.crossSubdomain ?? false
  // One-time-per-key throttle so a repeatedly-failing cross-subdomain cookie write (e.g. the
  // session-state write re-attempted on activity) does not spam the console over a long session.
  const warnedKeys = new Set<string>()
  // Deadlines seen this page load, so setItem can carry one forward without re-reading what getItem
  // just decoded — session activity read-then-writes on every event, which otherwise doubles the
  // storage reads per event. Never *later* than the deadline on the device: getItem caches what it
  // decoded, setItem the (clamped) deadline it is about to write, and a key another tab recreated
  // gets this tab's older cached deadline — a shorter life, the safe direction.
  //
  // Deadlines only; values are always re-read, which is what cross-tab sync needs.
  const knownExpiry = new Map<string, number>()

  const readRaw = (key: string): string | null => {
    if (cookies) {
      let value: string | null = null
      try {
        value = cookies.get(key)
      } catch (err) {
        log.warn(`Failed to read "${key}" from cookies:`, err)
      }
      if (value !== null) {
        return value
      }
      // The shared cookie is authoritative, so a miss means deleted. Falling back to this origin's
      // localStorage would resurrect a value a sibling still holds and re-broadcast it on the next
      // write, so a logout on one subdomain would not stick. Origin-scoped stores still fall back.
      if (crossSubdomain) {
        return null
      }
    }
    if (local) {
      try {
        return local.getItem(key)
      } catch (err) {
        log.warn(`Failed to read "${key}" from localStorage:`, err)
      }
    }
    return null
  }

  const removeItem = (key: string): boolean => {
    // Absent layers can't hold a stale value, so they default to "removed".
    let cookieRemoved = true
    if (cookies) {
      try {
        cookieRemoved = cookies.remove(key)
      } catch (err) {
        cookieRemoved = false
        log.warn(`Failed to remove "${key}" from cookies:`, err)
      }
    }
    let localRemoved = true
    if (local) {
      try {
        local.removeItem(key)
        // Read back like the cookie layer does: a shimmed or quota-locked store no-ops the removal
        // without throwing, and the teardown booleans rest on this answer.
        localRemoved = local.getItem(key) === null
      } catch (err) {
        localRemoved = false
        log.warn(`Failed to remove "${key}" from localStorage:`, err)
      }
    }
    knownExpiry.delete(key)
    // A subsequent getItem returns null only when every layer it would consult is cleared: the
    // cookie is authoritative in cross-subdomain mode; otherwise reads prefer the cookie and fall
    // back to localStorage, so both must be gone.
    return crossSubdomain ? cookieRemoved : cookieRemoved && localRemoved
  }

  /** The deadline already stamped on `key`, or undefined when there is none left to carry forward. */
  const liveExpiry = (key: string, now: number): number | undefined => {
    const cached = knownExpiry.get(key)
    if (cached !== undefined && cached > now) {
      return cached
    }
    const stored = decodeStored(readRaw(key))
    return stored && stored.expiresAt > now ? stored.expiresAt : undefined
  }

  /** Drops a value retention no longer covers, reporting a removal that did not land. */
  const dropStale = (key: string, why: string): void => {
    if (!removeItem(key)) {
      log.error(`"${key}" ${why} but could not be removed; it may survive on this device.`)
    }
  }

  return {
    crossSubdomain,
    getItem: key => {
      const raw = readRaw(key)
      const record = decodeStored(raw)
      if (!record) {
        // Pre-envelope or corrupted: unreadable, and it carries no deadline, so leaving it strands
        // an identifier retention can never reach.
        if (raw !== null) {
          dropStale(key, 'is not in the retention format')
        }
        return null
      }
      if (record.expiresAt <= Date.now()) {
        // Delete rather than ignore, so the identifier leaves the device on the first visit after
        // it lapses.
        dropStale(key, 'is past its retention deadline')
        return null
      }
      knownExpiry.set(key, record.expiresAt)
      return record.value
    },
    setItem: (key, value) => {
      const now = Date.now()
      // Carried forward when still live, so a refresh cannot extend retention; clamped to the
      // current window so lowering maxAgeDays reaches existing visitors, not just new devices.
      const expiresAt = Math.min(liveExpiry(key, now) ?? Infinity, now + maxAgeMs)
      knownExpiry.set(key, expiresAt)
      const raw = encodeStored(value, expiresAt)
      // The cookie gets the value's *remaining* lifetime, so both die on the same deadline.
      const maxAgeSeconds = Math.max(1, Math.round((expiresAt - now) / 1000))

      let cookiePersisted = false
      if (cookies) {
        try {
          cookiePersisted = cookies.set(key, raw, maxAgeSeconds)
        } catch (err) {
          log.warn(`Failed to write "${key}" to cookies:`, err)
        }
      }
      let localPersisted = false
      if (local) {
        try {
          local.setItem(key, raw)
          localPersisted = true
        } catch (err) {
          log.warn(`Failed to write "${key}" to localStorage:`, err)
        }
      }
      // In cross-subdomain mode reads never fall back to localStorage, so a localStorage-only
      // success is not persistence.
      const persisted = crossSubdomain ? cookiePersisted : cookiePersisted || localPersisted
      // The init-time probe does not guarantee later writes land (cookies disabled mid-session,
      // quota filling), so say so once per key whenever the value will not survive a page load.
      if (!persisted && !warnedKeys.has(key)) {
        warnedKeys.add(key)
        log.warn(
          crossSubdomain
            ? `Cross-subdomain cookie for "${key}" did not persist; this value will not survive a page load.`
            : `Persisting "${key}" failed on every available storage layer; this value will not survive a page load.`,
        )
      }
      return persisted
    },
    removeItem,
  }
}

/**
 * Resolves the optional store argument shared by configureSession / configureProfile /
 * createTrackingConsent. `undefined` (the caller omitted it — non-init internal callers and tests)
 * builds a localStorage-only store; an explicit `null` (init() found no usable layer) means no
 * persistence; a provided store is used as-is.
 */
export const resolveStore = (provided?: PersistentStore | null): PersistentStore | null =>
  provided === undefined ? createPersistentStore(null) : provided
