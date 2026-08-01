import type { CookieLayer } from './cookie.js'
import { log } from './logger.js'
import {
  DEFAULT_MAX_AGE_DAYS,
  decodeStored,
  encodeStored,
  isStorageAvailable,
  SECONDS_PER_DAY,
  type StoredEnvelope,
  safeStringify,
} from './utils.js'

/**
 * Layered key-value persistence: an optional cross-subdomain cookie layer over localStorage.
 * Reads prefer the cookie (it is the shared source of truth across subdomains — a stale per-origin
 * localStorage value must not shadow it); writes go to every available layer; methods never throw.
 *
 * Every value carries an absolute expiry (see `encodeStored`), so nothing stored here outlives
 * `maxAgeDays` in any mode — including plain localStorage, which has no expiry of its own.
 */
export interface PersistentStore {
  /**
   * A read can delete: an expired or undecodable stored value is removed on sight rather than
   * ignored (see Retention in CLAUDE.md), logging an error when that removal cannot be confirmed.
   * A pre-envelope value from an older build reads as absent — see `getItemOrLegacy`.
   */
  getItem(key: string): string | null
  /**
   * `getItem`, but a pre-envelope (undecodable) value is returned instead of read as absent. It is
   * still removed from the device either way, so retention cannot be evaded; the caller validates
   * it and re-persists through `setItem`, which stamps a fresh envelope.
   *
   * A separate method rather than an option on `getItem`: adopting a bare value is only ever
   * correct for the consent record, which records a *refusal* that must not silently revert to the
   * config seed. Identifiers must stay on `getItem` — adopting one resurrects an identifier no
   * deadline can reach — and that is caller discipline either way, but the distinct name puts it in
   * the call rather than in an argument.
   */
  getItemOrLegacy(key: string): string | null
  /**
   * Returns true when the value will be readable on the next page load. In cross-subdomain mode
   * that requires the cookie write to land (reads trust only the cookie); otherwise any layer
   * suffices — provided a stale cookie left by a failed cookie write was cleared, since reads
   * prefer the cookie and an uncleared one shadows the localStorage value with the previous one.
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
const resolveMaxAgeMs = (maxAgeDays: unknown, hasCookies: boolean): number => {
  if (maxAgeDays === undefined) {
    return DEFAULT_MAX_AGE_DAYS * MS_PER_DAY
  }
  if (typeof maxAgeDays !== 'number' || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    // safeStringify: the value being rejected is exactly the kind (bigint, circular) that makes
    // JSON.stringify throw, which downgraded the whole SDK to memory-only persistence via init()'s
    // generic catch instead of warning about one option.
    log.warn(
      `maxAgeDays ${safeStringify(maxAgeDays)} must be a number greater than 0; using the ${DEFAULT_MAX_AGE_DAYS}-day default.`,
    )
    return DEFAULT_MAX_AGE_DAYS * MS_PER_DAY
  }
  if (hasCookies && maxAgeDays > BROWSER_COOKIE_CAP_DAYS) {
    log.warn(
      `maxAgeDays ${maxAgeDays} exceeds the ${BROWSER_COOKIE_CAP_DAYS}-day cap Chromium enforces on cookies; the cookie will be shortened by the browser.`,
    )
  }
  const maxAgeMs = Math.round(maxAgeDays * MS_PER_DAY)
  // A finite day count can still overflow as milliseconds; stamped, the non-finite deadline is an
  // envelope decodeStored rejects, so every value would be written and then deleted on its next read.
  if (!Number.isFinite(maxAgeMs)) {
    log.warn(`maxAgeDays ${maxAgeDays} is too large; using the ${DEFAULT_MAX_AGE_DAYS}-day default.`)
    return DEFAULT_MAX_AGE_DAYS * MS_PER_DAY
  }
  return maxAgeMs
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
  // One-time-per-*episode*-per-key throttle so a repeatedly-failing cross-subdomain cookie write
  // (e.g. the session-state write re-attempted on activity) does not spam the console over a long
  // session. Released by the next landed write, like every other latch here: once per episode, never
  // outliving the fact it describes.
  const warnedKeys = new Set<string>()
  // Deadlines seen this page load, so setItem can carry one forward without re-reading what getItem
  // just decoded — session activity read-then-writes on every event, which otherwise doubles the
  // storage reads per event. Never *later* than the deadline on the device: getItem caches what it
  // decoded, setItem the (clamped) deadline it is about to write, and a key another tab recreated
  // gets this tab's older cached deadline — a shorter life, the safe direction.
  //
  // Deadlines only; values are always re-read, which is what cross-tab sync needs.
  const knownExpiry = new Map<string, number>()
  // Keys whose stale localStorage mirror was already swept after a shared-cookie miss this load.
  const sweptKeys = new Set<string>()
  // Two independent once-per-key latches, deliberately not shared. They describe the same residue
  // but answer to different callers: shared, one throwing sweep *would* permanently suppress the
  // teardown report below, which is the only signal anywhere that an opt-out left an identifier on
  // the device (removeItem's return value excludes this layer in cross-subdomain mode). Stated as a
  // counterfactual because it is one — no committed build shared them; persistence.test.ts pins it.
  // Both are released once their key's residue is verifiably gone.
  const sweepWarnedKeys = new Set<string>()
  const residueWarnedKeys = new Set<string>()
  // Once per key per episode, like the two above, and released by the next landed write for the same
  // reason: writeLocal() sits on the per-event session write, so an unlatched warn there is one
  // console line per event for the life of the page on a quota-exhausted store — drowning the single
  // actionable message setItem() logs.
  const writeFailedKeys = new Set<string>()

  /**
   * Deletes this origin's localStorage mirror of a key whose shared cookie is gone. Reads never
   * consult the mirror in cross-subdomain mode, so nothing observable changes — but without this
   * the retention deadline could never reach it: the cookie dies on its own schedule while the
   * mirrored copy (an identify()ed email, for a visitor the app never re-identifies) sat in
   * localStorage indefinitely, readable again the moment the integrator turns cross-subdomain off.
   * The next write after a sweep is a fresh record, so the cached deadline goes with it.
   */
  const sweepLocalMirror = (key: string): void => {
    if (!local || sweptKeys.has(key)) {
      return
    }
    sweptKeys.add(key)
    try {
      if (local.getItem(key) !== null) {
        local.removeItem(key)
        knownExpiry.delete(key)
        if (local.getItem(key) !== null) {
          // Error, not warn: the residue is an identifier — routinely an identify()ed email — that no
          // deadline reaches and that becomes readable again the moment cross-subdomain is turned off.
          // The same outcome is reported at error everywhere else in the teardown chain.
          log.error(
            `localStorage still holds "${key}" after its shared cookie was deleted; residue remains on this device.`,
          )
          return
        }
      }
      // Re-arm, like removeItem's residue latch: the mirror this key's latch described is verifiably
      // gone (or was never there), and a latch may not outlive the residue it describes. Held for the
      // page, one throwing sweep silenced every later miss episode for that key — and this report is
      // the only signal anywhere that a shared cookie's origin-local mirror survived it.
      sweepWarnedKeys.delete(key)
    } catch (err) {
      // Un-latch so a later miss retries, as reconcileTwin does: latched, one throwing sweep left
      // the mirror unreachable for the rest of the page load. The error stays once per key.
      sweptKeys.delete(key)
      if (!sweepWarnedKeys.has(key)) {
        sweepWarnedKeys.add(key)
        log.error(`Failed to remove the stale localStorage mirror for "${key}"; residue remains on this device:`, err)
      }
    }
  }

  const readRaw = (key: string): string | null => {
    if (cookies) {
      let value: string | null = null
      let readFailed = false
      try {
        value = cookies.get(key)
      } catch (err) {
        readFailed = true
        log.warn(`Failed to read "${key}" from cookies:`, err)
      }
      if (value !== null) {
        return value
      }
      // The shared cookie is authoritative, so a miss means deleted. Falling back to this origin's
      // localStorage would resurrect a value a sibling still holds and re-broadcast it on the next
      // write, so a logout on one subdomain would not stick. Origin-scoped stores still fall back.
      if (crossSubdomain) {
        // Only on a genuine miss: a throwing jar is not evidence the cookie is gone.
        if (!readFailed) {
          sweepLocalMirror(key)
        }
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

  /**
   * Drops `key`'s cookie without throwing; true when it is verifiably gone — including when there
   * is no cookie layer to hold one. `what` is the verb phrase the failure log reads with.
   */
  const dropCookie = (key: string, what: string): boolean => {
    if (!cookies) {
      return true
    }
    try {
      return cookies.remove(key)
    } catch (err) {
      log.warn(`Failed to ${what} "${key}" cookie:`, err)
      return false
    }
  }

  /**
   * One residue report per key per *episode*, not per page. Both of removeItem's failure arms report
   * the same fact — an identifier survived a teardown — so they share a latch deliberately; what
   * they must not share is a latch that outlives the fact. Released by the next confirmed removal
   * below, mirroring sweptKeys' un-latch in sweepLocalMirror: held for the page, one mechanism's
   * report silenced every later one for that key, including the other mechanism's, and in
   * cross-subdomain mode (where the return value excludes this layer) that report is the only signal
   * anywhere that the identifier is still on the device.
   */
  const reportResidue = (key: string, message: string, err?: unknown): void => {
    if (residueWarnedKeys.has(key)) {
      return
    }
    residueWarnedKeys.add(key)
    // Error, matching how clearProfile() reports the same outcome on the cookie layer. The mechanism
    // of failure does not pick the severity — a no-op and a throw leave the same identifier behind.
    if (err === undefined) {
      log.error(message)
    } else {
      log.error(message, err)
    }
  }

  const removeItem = (key: string): boolean => {
    const cookieRemoved = dropCookie(key, 'remove the')
    // An absent layer can't hold a stale value, so it defaults to "removed".
    let localRemoved = true
    if (local) {
      try {
        local.removeItem(key)
        // Read back like the cookie layer does: a shimmed or quota-locked store no-ops the removal
        // without throwing, and the teardown booleans rest on this answer.
        localRemoved = local.getItem(key) === null
        if (!localRemoved) {
          reportResidue(key, `localStorage still holds "${key}" after removal; residue remains on this device.`)
        }
      } catch (err) {
        localRemoved = false
        reportResidue(key, `Failed to remove "${key}" from localStorage; residue remains on this device:`, err)
      }
    }
    if (localRemoved) {
      // Re-arm. A latch may only outlive the residue it describes, and this key no longer has any.
      residueWarnedKeys.delete(key)
    }
    knownExpiry.delete(key)
    // A subsequent getItem returns null only when every layer it would consult is cleared: the
    // cookie is authoritative in cross-subdomain mode; otherwise reads prefer the cookie and fall
    // back to localStorage, so both must be gone.
    return crossSubdomain ? cookieRemoved : cookieRemoved && localRemoved
  }

  /**
   * The one localStorage write path. `raw` is typed to the envelope, like `CookieLayer.set`, so a
   * bare value cannot reach this layer either — written bare it reads as undecodable and getItem
   * deletes it on sight.
   *
   * No read-back here, unlike `removeItem`: the failure it would catch — a Storage shim that
   * no-ops without throwing — is a property of the Storage object rather than of a key, so
   * `isStorageAvailable()` verifies it once at startup and `local` is null when it fails. A
   * per-write check would put a second `getItem` on the per-event session write for a fact already
   * known. Quota exhaustion, the other no-op-shaped failure, throws and is caught below.
   */
  const writeLocal = (key: string, raw: StoredEnvelope): boolean => {
    if (!local) {
      return false
    }
    try {
      local.setItem(key, raw)
      // Re-arm, like removeItem's residue latch: the next genuine failure must report again.
      writeFailedKeys.delete(key)
      return true
    } catch (err) {
      // Latched: this runs on the per-event session write, so an unlatched warn is one console line
      // per event. setItem()'s own warnedKeys message carries the actionable half.
      if (!writeFailedKeys.has(key)) {
        writeFailedKeys.add(key)
        log.warn(`Failed to write "${key}" to localStorage:`, err)
      }
      return false
    }
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

  // Per key, not per failure: the session read runs getItem on every tracked event, so a removal
  // that keeps failing would otherwise report once per event for the life of the page.
  const dropFailedKeys = new Set<string>()

  /** Drops a value retention no longer covers, reporting a removal that did not land. */
  const dropStale = (key: string, why: string): void => {
    if (removeItem(key)) {
      // Re-arm, like removeItem's own residue latch: a latch may outlive one episode but never the
      // residue it describes, and this key's is verifiably gone. Held for the page, this was the
      // worst of the three: in cross-subdomain mode reportResidue is unreachable (it sits inside
      // `if (local)`, and the mirror is swept, not removed, there), so this line is the *only*
      // signal anywhere that an expired identifier — routinely an identify()ed email — outlived its
      // retention deadline. Latched permanently, retention enforcement went silent for that key.
      dropFailedKeys.delete(key)
      return
    }
    if (!dropFailedKeys.has(key)) {
      dropFailedKeys.add(key)
      log.error(`"${key}" ${why} but could not be removed; it may survive on this device.`)
    }
  }

  const readItem = (key: string, adoptLegacy: boolean): string | null => {
    const raw = readRaw(key)
    const record = decodeStored(raw)
    if (!record) {
      // Pre-envelope or corrupted: unreadable, and it carries no deadline, so leaving it strands
      // an identifier retention can never reach.
      if (raw !== null) {
        dropStale(key, 'is not in the retention format')
        // getItemOrLegacy hands the bare value back after the removal above, instead of reading it
        // as absent — the migration path for the consent record, whose silent loss reverted a
        // recorded 'denied' to the config seed. The caller validates and re-persists it.
        if (adoptLegacy) {
          return raw
        }
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
  }

  return {
    crossSubdomain,
    getItem: key => readItem(key, false),
    getItemOrLegacy: key => readItem(key, true),
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
        // A landed write ends the current miss episode: the next cookie miss is a fresh deletion
        // (expiry, or a sibling's opt-out) and the mirror sweep must run for it again.
        if (cookiePersisted) {
          sweptKeys.delete(key)
        }
      }
      // A cookie surviving a failed write shadows the value below on reads — clear it in host-only
      // mode, where reads fall back to localStorage; a shared one has no fallback and must stay.
      const shadowCleared = cookiePersisted || crossSubdomain || dropCookie(key, 'clear the stale')
      const localPersisted = writeLocal(key, raw)
      // In cross-subdomain mode reads never fall back to localStorage, so a localStorage-only
      // success is not persistence; nor is one a stale cookie we could not clear still shadows.
      const persisted = crossSubdomain ? cookiePersisted : cookiePersisted || (localPersisted && shadowCleared)
      // The init-time probe does not guarantee later writes land (cookies disabled mid-session,
      // quota filling), so say so once per key whenever the value will not survive a page load.
      if (persisted) {
        // Re-arm, like writeLocal's own latch one layer down: this key's value will survive a page
        // load, so the fact the latch describes no longer holds. Held for the page, a store that
        // recovered and failed again reported nothing the second time — and session.ts discards
        // setItem's boolean precisely because "the store already logs the underlying failure",
        // which was true only of the first episode.
        warnedKeys.delete(key)
      } else if (!warnedKeys.has(key)) {
        warnedKeys.add(key)
        let reason = `Persisting "${key}" failed on every available storage layer; this value will not survive a page load.`
        if (crossSubdomain) {
          reason = `Cross-subdomain cookie for "${key}" did not persist; this value will not survive a page load.`
        } else if (!shadowCleared) {
          reason = `Stale cookie for "${key}" could not be cleared and shadows the stored value; reads will return the previous one.`
        }
        log.warn(reason)
      }
      return persisted
    },
    removeItem,
  }
}

/**
 * Resolves the store argument shared by configureSession / configureProfile / createTrackingConsent
 * — a genuinely optional trailing parameter on the last, a required positional (typed
 * `| undefined`) on the other two. `undefined` (non-init internal callers and tests) builds a
 * localStorage-only store; an explicit `null` (init() found no usable layer) means no persistence;
 * a provided store is used as-is.
 */
export const resolveStore = (provided?: PersistentStore | null): PersistentStore | null =>
  provided === undefined ? createPersistentStore(null) : provided
