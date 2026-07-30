import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CookieLayer } from './cookie.js'
import { createPersistentStore, resolveStore } from './persistence.js'
import { expiryOf, persisted, storedValue } from './storage-envelope.test-utils.js'
import { isStorageAvailable } from './utils.js'

const logSpies = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

vi.mock('./logger.js', () => ({ log: logSpies }))

vi.mock('./utils.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./utils.js')>()
  return { ...actual, isStorageAvailable: vi.fn(() => true) }
})

const createFakeCookieLayer = (crossSubdomain = true) => {
  const jar = new Map<string, string>()
  const layer: CookieLayer = {
    crossSubdomain,
    get: key => jar.get(key) ?? null,
    set: (key, value) => {
      jar.set(key, value)
      return true
    },
    remove: key => {
      jar.delete(key)
      return true
    },
  }
  return { layer, jar }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isStorageAvailable).mockReturnValue(true)
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPersistentStore', () => {
  it('returns null when neither cookies nor localStorage are usable', () => {
    vi.mocked(isStorageAvailable).mockReturnValue(false)
    expect(createPersistentStore(null)).toBeNull()
  })

  it('works localStorage-only when the cookie layer is absent', () => {
    const store = createPersistentStore(null)
    expect(store?.crossSubdomain).toBe(false)
    expect(store?.setItem('k', 'v')).toBe(true)
    expect(storedValue(localStorage.getItem('k'))).toBe('v')
    expect(store?.getItem('k')).toBe('v')
    store?.removeItem('k')
    expect(store?.getItem('k')).toBeNull()
  })

  it('propagates the crossSubdomain flag from the cookie layer', () => {
    expect(createPersistentStore(createFakeCookieLayer(true).layer)?.crossSubdomain).toBe(true)
    expect(createPersistentStore(createFakeCookieLayer(false).layer)?.crossSubdomain).toBe(false)
  })

  it('writes to both layers', () => {
    const { layer, jar } = createFakeCookieLayer()
    const store = createPersistentStore(layer)
    expect(store?.setItem('k', 'v')).toBe(true)
    expect(storedValue(jar.get('k') ?? null)).toBe('v')
    expect(storedValue(localStorage.getItem('k'))).toBe('v')
  })

  it('prefers the cookie value over a conflicting localStorage value', () => {
    const { layer } = createFakeCookieLayer()
    const store = createPersistentStore(layer)
    localStorage.setItem('k', persisted('stale-local'))
    layer.set('k', persisted('shared-cookie'))
    expect(store?.getItem('k')).toBe('shared-cookie')
  })

  it('does not fall back to localStorage on a cookie miss in cross-subdomain mode', () => {
    // The shared cookie is authoritative; a miss must not resurrect a sibling origin's stale value.
    const store = createPersistentStore(createFakeCookieLayer(true).layer)
    localStorage.setItem('k', persisted('stale-sibling'))
    expect(store?.getItem('k')).toBeNull()
  })

  it('falls back to localStorage on a cookie miss for a host-only store', () => {
    const store = createPersistentStore(createFakeCookieLayer(false).layer)
    localStorage.setItem('k', persisted('local-only'))
    expect(store?.getItem('k')).toBe('local-only')
  })

  it('sweeps the localStorage mirror when the shared cookie is gone', () => {
    // setItem mirrors every value into localStorage, but cross-subdomain reads never consult it — so
    // once the shared cookie lapsed, the mirror (an identify()ed email, for a visitor the app never
    // re-identifies) outlived every retention deadline and became readable again the moment the
    // integrator turned cross-subdomain off. A genuine miss now deletes it.
    const { layer, jar } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'jane@example.com')
    jar.clear() // the cookie expired, or a sibling subdomain's opt-out deleted it
    expect(store?.getItem('k')).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('leaves the mirror alone when the cookie read throws', () => {
    // A throwing jar (sandboxed frame, a blocking extension) is not evidence the cookie is gone;
    // sweeping on it would destroy the only surviving copy over a transient failure.
    const { layer } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    localStorage.setItem('k', persisted('v'))
    layer.get = () => {
      throw new Error('blocked')
    }
    expect(store?.getItem('k')).toBeNull()
    expect(storedValue(localStorage.getItem('k'))).toBe('v')
  })

  it('reports an error when localStorage still holds a value after removal', () => {
    // The exact adversary the read-back exists for — a shimmed store that no-ops without throwing.
    // The cross-subdomain return value deliberately excludes this layer, so without a log the
    // residue is invisible everywhere.
    const { layer } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'v')
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})
    expect(store?.removeItem('k')).toBe(true)
    store?.removeItem('k')
    expect(logSpies.error.mock.calls.filter(c => String(c[0]).includes('still holds "k"'))).toHaveLength(1)
  })

  it('warns once when a cross-subdomain cookie write is silently dropped', () => {
    const { layer } = createFakeCookieLayer(true)
    layer.set = () => false
    const store = createPersistentStore(layer)
    store?.setItem('k', 'v')
    store?.setItem('k', 'v2')
    expect(logSpies.warn).toHaveBeenCalledTimes(1)
    expect(logSpies.warn).toHaveBeenCalledWith(
      'Cross-subdomain cookie for "k" did not persist; this value will not survive a page load.',
    )
  })

  it('does not warn about dropped cookie writes for a host-only store', () => {
    const { layer } = createFakeCookieLayer(false)
    layer.set = () => false
    const store = createPersistentStore(layer)
    store?.setItem('k', 'v')
    // localStorage is available here, so the value still persists (host-only reads fall back to it):
    // a dropped cookie is not a loss, so warning would be noise.
    expect(logSpies.warn).not.toHaveBeenCalled()
  })

  it('warns when a host-only write persists on no layer (localStorage also unavailable)', () => {
    // Host-only cookie drops the write AND localStorage is gone: the value is lost on every layer,
    // so a subsequent getItem misses. That must not be silent (previously the warning was gated on
    // cross-subdomain mode and this path logged nothing).
    vi.mocked(isStorageAvailable).mockReturnValue(false)
    const { layer } = createFakeCookieLayer(false)
    layer.set = () => false
    const store = createPersistentStore(layer)
    expect(store?.setItem('k', 'v')).toBe(false)
    expect(logSpies.warn).toHaveBeenCalledTimes(1)
  })

  it('removes from both layers', () => {
    const { layer, jar } = createFakeCookieLayer()
    const store = createPersistentStore(layer)
    store?.setItem('k', 'v')
    store?.removeItem('k')
    expect(jar.has('k')).toBe(false)
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('reports removal success when every consulted layer confirms', () => {
    const { layer } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'v')
    expect(store?.removeItem('k')).toBe(true)
  })

  it('reports failure in cross-subdomain mode when the cookie cannot be removed', () => {
    // The shared cookie is authoritative; if it survives, so does the value — report the failure so
    // opt-out/reset can surface an identity teardown that did not land.
    const { layer } = createFakeCookieLayer(true)
    layer.remove = () => false
    const store = createPersistentStore(layer)
    expect(store?.removeItem('k')).toBe(false)
  })

  it('reports success in cross-subdomain mode even if localStorage removal throws', () => {
    // getItem never consults localStorage in this mode, so a stale localStorage twin is irrelevant —
    // the cookie's removal is what determines whether a subsequent read misses.
    const { layer } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(store?.removeItem('k')).toBe(true)
  })

  it('reports failure for a host-only store when localStorage removal throws', () => {
    // Reads prefer the cookie and fall back to localStorage, so both must be gone to report success.
    const { layer } = createFakeCookieLayer(false)
    const store = createPersistentStore(layer)
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(store?.removeItem('k')).toBe(false)
    expect(logSpies.warn).toHaveBeenCalledWith('Failed to remove "k" from localStorage:', expect.any(Error))
  })

  it('reports success when only the cookie write lands', () => {
    const { layer } = createFakeCookieLayer()
    const store = createPersistentStore(layer)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(store?.setItem('k', 'v')).toBe(true)
    expect(logSpies.warn).toHaveBeenCalledWith('Failed to write "k" to localStorage:', expect.any(Error))
  })

  it('reports success when only the localStorage write lands for a host-only store', () => {
    const { layer } = createFakeCookieLayer(false)
    layer.set = () => false
    const store = createPersistentStore(layer)
    expect(store?.setItem('k', 'v')).toBe(true)
    expect(storedValue(localStorage.getItem('k'))).toBe('v')
  })

  it('drops a stale host-only cookie when its write fails, so reads see the new value', () => {
    // Reads prefer the cookie, so a survivor of the failed write would shadow the localStorage value
    // with the previous one while setItem reported success.
    const { layer, jar } = createFakeCookieLayer(false)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'first')
    layer.set = () => false
    expect(store?.setItem('k', 'second')).toBe(true)
    expect(jar.has('k')).toBe(false)
    expect(store?.getItem('k')).toBe('second')
  })

  it('reports failure when a shadowing host-only cookie cannot be cleared', () => {
    const { layer } = createFakeCookieLayer(false)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'first')
    layer.set = () => false
    layer.remove = () => false
    expect(store?.setItem('k', 'second')).toBe(false)
    expect(store?.getItem('k')).toBe('first')
    expect(logSpies.warn).toHaveBeenCalledWith(
      'Stale cookie for "k" could not be cleared and shadows the stored value; reads will return the previous one.',
    )
  })

  it('keeps the shared cookie when a cross-subdomain write fails', () => {
    // Reads have no localStorage fallback here, so clearing the shadow (as host-only mode does)
    // would end identity on every sibling subdomain over one page's failed write.
    const { layer, jar } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'first')
    layer.set = () => false
    expect(store?.setItem('k', 'second')).toBe(false)
    expect(jar.has('k')).toBe(true)
    expect(store?.getItem('k')).toBe('first')
  })

  it('reports failure in cross-subdomain mode when the cookie write fails, even if localStorage lands', () => {
    // getItem never falls back to localStorage in this mode, so a localStorage-only success is
    // unreadable on the next load and must not be reported as persisted.
    const { layer } = createFakeCookieLayer(true)
    layer.set = () => false
    const store = createPersistentStore(layer)
    expect(store?.setItem('k', 'v')).toBe(false)
    expect(storedValue(localStorage.getItem('k'))).toBe('v')
  })

  it('reports failure when every layer fails', () => {
    const { layer } = createFakeCookieLayer()
    layer.set = () => false
    const store = createPersistentStore(layer)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(store?.setItem('k', 'v')).toBe(false)
  })

  it('warns and returns null when a localStorage read throws', () => {
    const store = createPersistentStore(null)
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('read boom')
    })
    expect(store?.getItem('k')).toBeNull()
    expect(logSpies.warn).toHaveBeenCalledWith('Failed to read "k" from localStorage:', expect.any(Error))
  })

  it('never throws when the cookie layer throws (treats it as a miss/failure)', () => {
    const { layer } = createFakeCookieLayer(true)
    layer.get = () => {
      throw new Error('cookie read')
    }
    layer.set = () => {
      throw new Error('cookie write')
    }
    layer.remove = () => {
      throw new Error('cookie remove')
    }
    const store = createPersistentStore(layer)
    // A thrown read is treated as a miss; cross-subdomain mode does not fall back to localStorage.
    expect(() => store?.getItem('k')).not.toThrow()
    expect(store?.getItem('k')).toBeNull()
    // A thrown write is a cookie failure; cross-subdomain mode reports the cookie's outcome.
    expect(() => store?.setItem('k', 'v')).not.toThrow()
    expect(store?.setItem('k', 'v')).toBe(false)
    expect(() => store?.removeItem('k')).not.toThrow()
  })
})

describe('retention', () => {
  it('drops a value past its expiry and removes it from the device', () => {
    const { layer, jar } = createFakeCookieLayer(false)
    const store = createPersistentStore(layer)
    localStorage.setItem('k', persisted('expired', -1))
    jar.set('k', persisted('expired', -1))
    expect(store?.getItem('k')).toBeNull()
    // Deleted, not merely ignored — the point is that the identifier leaves the device.
    expect(localStorage.getItem('k')).toBeNull()
    expect(jar.has('k')).toBe(false)
  })

  it('does not extend the deadline when a value is re-written', () => {
    const store = createPersistentStore(null)
    const deadline = Date.now() + 5_000
    localStorage.setItem('k', `${deadline}|v`)
    store?.setItem('k', 'v2')
    // A returning visitor refreshes the value, not the retention window.
    expect(expiryOf(localStorage.getItem('k'))).toBe(deadline)
    expect(store?.getItem('k')).toBe('v2')
  })

  it('does not extend the deadline on the read-then-write path, and re-reads storage only once', () => {
    // resolveSessionId() does exactly this on every tracked event: getItem, then setItem to refresh
    // activity. setItem takes the deadline getItem already decoded rather than re-reading it.
    const store = createPersistentStore(null)
    const deadline = Date.now() + 5_000
    localStorage.setItem('k', `${deadline}|v`)
    const getSpy = vi.spyOn(localStorage, 'getItem')
    store?.getItem('k')
    store?.setItem('k', 'v2')
    expect(getSpy).toHaveBeenCalledTimes(1)
    getSpy.mockRestore()
    expect(expiryOf(localStorage.getItem('k'))).toBe(deadline)
  })

  it('always re-reads the value itself, so a sibling tab’s write is still picked up', () => {
    // Only deadlines are cached. Caching values would break session.ts's cross-tab sync, which
    // relies on re-reading storage on every call.
    const store = createPersistentStore(null)
    store?.setItem('k', 'mine')
    localStorage.setItem('k', persisted('from-other-tab'))
    expect(store?.getItem('k')).toBe('from-other-tab')
  })

  it('starts a fresh window when the cached deadline has lapsed', () => {
    vi.useFakeTimers()
    try {
      const store = createPersistentStore(null, 10)
      localStorage.setItem('k', `${Date.now() + 40}|v`)
      store?.getItem('k') // caches the near deadline
      vi.advanceTimersByTime(60)
      store?.setItem('k', 'v2')
      const expiry = expiryOf(localStorage.getItem('k')) ?? 0
      expect(expiry - Date.now()).toBeGreaterThan(9 * 24 * 60 * 60 * 1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stamps maxAgeDays on a first write', () => {
    const store = createPersistentStore(null, 10)
    store?.setItem('k', 'v')
    const expiry = expiryOf(localStorage.getItem('k')) ?? 0
    expect(expiry - Date.now()).toBeGreaterThan(9 * 24 * 60 * 60 * 1000)
    expect(expiry - Date.now()).toBeLessThanOrEqual(10 * 24 * 60 * 60 * 1000)
  })

  it('gives the cookie the value’s remaining lifetime, not a fresh one', () => {
    const { layer } = createFakeCookieLayer(true)
    const setSpy = vi.spyOn(layer, 'set')
    const store = createPersistentStore(layer)
    const deadline = Date.now() + 5_000
    // Cross-subdomain reads only consult the cookie, so seed the deadline there.
    layer.set('k', `${deadline}|v`)
    store?.setItem('k', 'v2')
    expect(setSpy).toHaveBeenLastCalledWith('k', `${deadline}|v2`, 5)
  })

  it('warns and falls back to the default on an unusable maxAgeDays from data-options JSON', () => {
    const store = createPersistentStore(null, '30' as never)
    expect(logSpies.warn).toHaveBeenCalledWith(
      'maxAgeDays "30" must be a number greater than 0; using the 365-day default.',
    )
    store?.setItem('k', 'v')
    const expiry = expiryOf(localStorage.getItem('k')) ?? 0
    expect(expiry - Date.now()).toBeGreaterThan(364 * 24 * 60 * 60 * 1000)
  })

  it.each([0, -1])('warns and falls back on the boundary value %d', boundary => {
    createPersistentStore(null, boundary)
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('must be a number greater than 0'))
  })

  it('warns and falls back when maxAgeDays is too large to make a deadline', () => {
    // 1e308 is "a number greater than 0", but its product with a day in ms is Infinity — stamped,
    // that is an envelope decodeStored rejects, so every value would be written and then deleted on
    // its next read.
    const store = createPersistentStore(null, 1e308)
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('too large'))
    store?.setItem('k', 'v')
    expect(store?.getItem('k')).toBe('v')
    const expiry = expiryOf(localStorage.getItem('k')) ?? 0
    expect(expiry - Date.now()).toBeLessThanOrEqual(365 * 24 * 60 * 60 * 1000)
  })

  it('warns but honors a lifetime past the browser cookie cap when a cookie layer is in use', () => {
    createPersistentStore(createFakeCookieLayer().layer, 500)
    expect(logSpies.warn).toHaveBeenCalledWith(
      'maxAgeDays 500 exceeds the 400-day cap Chromium enforces on cookies; the cookie will be shortened by the browser.',
    )
  })

  it('does not mention the cookie cap when there is no cookie layer', () => {
    // The cap is Chromium's, on cookies. The default install writes none, so warning about one
    // points integrators at a feature they never enabled — and localStorage honors 500 days fine.
    const store = createPersistentStore(null, 500)
    expect(logSpies.warn).not.toHaveBeenCalled()
    store?.setItem('k', 'v')
    const expiry = expiryOf(localStorage.getItem('k')) ?? 0
    expect(expiry - Date.now()).toBeGreaterThan(499 * 24 * 60 * 60 * 1000)
  })

  it('removes a stored value that is not in the expiry format, rather than stranding it', () => {
    // A bare value carries no deadline, so retention can never reach it. The anonymous ID would be
    // overwritten by the next mint, but an identify()ed externalId — often an email — is only ever
    // written by identify(), so a visitor who does not re-identify keeps theirs forever.
    const store = createPersistentStore(null)
    localStorage.setItem('k', 'bare-legacy-value')
    expect(store?.getItem('k')).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('hands a pre-envelope value to a caller that asked to adopt it, still removing it from the device', () => {
    // The migration hook the consent record needs: a legacy bare value is perfectly legible — it
    // fails decodeStored only for carrying no deadline — and for the one key whose loss is a
    // consent regression rather than a metrics blip, deleting it unread turned a recorded 'denied'
    // into the config seed. Device state matches the drop path (removed either way, so retention
    // cannot be evaded); only the return differs, and a caller that validates the value
    // re-persists it through setItem, which stamps a fresh envelope.
    const store = createPersistentStore(null)
    localStorage.setItem('k', 'denied')
    expect(store?.getItemOrLegacy('k')).toBe('denied')
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('does not resurrect an expired enveloped value under adopt', () => {
    // Expiry is not legacy: a decodable record past its deadline stays null under either option —
    // adopt widens only the undecodable arm.
    const store = createPersistentStore(null)
    localStorage.setItem('k', persisted('v', -60_000))
    expect(store?.getItemOrLegacy('k')).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('reads a live enveloped value under adopt exactly like a plain read', () => {
    const store = createPersistentStore(null)
    localStorage.setItem('k', persisted('v'))
    expect(store?.getItemOrLegacy('k')).toBe('v')
    expect(storedValue(localStorage.getItem('k'))).toBe('v')
  })

  it('rejects an unstringifiable maxAgeDays with a warning instead of throwing', () => {
    // The warning interpolates the very value being rejected, and a bigint (or a circular object
    // out of data-options JSON… less so, but the one-tag path is untyped) made JSON.stringify
    // throw — so init()'s wrapper caught it and silently downgraded the whole SDK to memory-only
    // persistence behind a generic message that never named the offending option.
    expect(() => createPersistentStore(null, 5n as never)).not.toThrow()
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('maxAgeDays'))
  })

  it('shortens an existing deadline when maxAgeDays is lowered', () => {
    // The carry-forward stops a refresh *extending* retention; it must not also stop an integrator
    // tightening it, since existing visitors are the population that matters.
    localStorage.setItem('k', persisted('v', 300 * 24 * 60 * 60 * 1000))
    const store = createPersistentStore(null, 30)
    store?.setItem('k', 'v2')
    const expiry = expiryOf(localStorage.getItem('k')) ?? 0
    expect(expiry - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000)
  })

  it('reports a removal that did not land instead of assuming it did', () => {
    // localStorage.removeItem can no-op without throwing (a Storage shim, an extension proxy). The
    // cookie layer read-back-verifies; so must this, or a teardown boolean lies.
    const store = createPersistentStore(null)
    localStorage.setItem('k', persisted('v'))
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})
    expect(store?.removeItem('k')).toBe(false)
  })

  // The sweep and the teardown report describe the same residue but answer to different callers, so
  // they keep independent once-per-key latches. Shared, one throwing sweep permanently suppressed
  // the teardown report — which in cross-subdomain mode is the only signal anywhere that an opt-out
  // left an identifier on the device, since removeItem's return value excludes the localStorage
  // layer there.
  it('still reports teardown residue after a throwing mirror sweep latched the same key', () => {
    const { layer, jar } = createFakeCookieLayer(true)
    const store = createPersistentStore(layer)
    store?.setItem('k', 'v')

    // 1. The shared cookie is gone, so a read sweeps the mirror — and the sweep throws.
    jar.delete('k')
    const throwOnce = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('proxied Storage')
    })
    store?.getItem('k')
    expect(logSpies.error).toHaveBeenCalledWith(expect.stringContaining('stale localStorage mirror'), expect.anything())

    // 2. The user opts out. removeItem now no-ops silently, leaving the identifier behind.
    logSpies.error.mockClear()
    throwOnce.mockImplementation(() => {})
    store?.removeItem('k')
    expect(logSpies.error).toHaveBeenCalledWith(expect.stringContaining('still holds "k" after removal'))
  })

  it('reports a stale value that cannot be removed once per key, not once per read', () => {
    // The session read runs getItem on every tracked event; against a store whose removeItem no-ops,
    // an unthrottled report here logged an error per event for the life of the page.
    const store = createPersistentStore(null)
    localStorage.setItem('k', 'pre-envelope')
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})
    store?.getItem('k')
    store?.getItem('k')
    // Two distinct once-per-key reports — the failed drop, and removeItem's residue read-back —
    // and neither repeats on the second read, which is the throttle this pins.
    expect(logSpies.error.mock.calls.filter(c => String(c[0]).includes('could not be removed'))).toHaveLength(1)
    expect(logSpies.error.mock.calls.filter(c => String(c[0]).includes('still holds'))).toHaveLength(1)
  })
})

describe('resolveStore', () => {
  it('builds a localStorage-only store when the argument is omitted (undefined)', () => {
    const store = resolveStore()
    expect(store).not.toBeNull()
    expect(store?.crossSubdomain).toBe(false)
  })

  it('returns null when explicitly passed null (init found no usable layer)', () => {
    expect(resolveStore(null)).toBeNull()
  })

  it('returns a provided store unchanged', () => {
    const provided = createPersistentStore(createFakeCookieLayer(true).layer)
    expect(resolveStore(provided)).toBe(provided)
  })
})
