import { CookieJar, JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DENIED, GRANTED } from './consent-gate.test-utils.js'
import { type CookieDocument, type CrossSubdomainConfig, createCookieLayer, seekRegistrableDomain } from './cookie.js'
import { persisted } from './storage-envelope.test-utils.js'
import type { GrantedGate } from './tracking-consent.js'

/**
 * The layer under test with consent granted. The twin promotion is the one write on the read path
 * and is gated on full consent (see reconcileTwin), so every case below that exercises it says so;
 * the gate itself is covered by the "consent gate" describe at the end.
 */
const grantedLayer = (config: CrossSubdomainConfig, doc?: CookieDocument | null) =>
  createCookieLayer(config, GRANTED, doc)

// A document whose writes are captured for assertion while reads/writes still delegate to a real
// jsdom cookie jar — so read-back verification and public-suffix rules stay faithful. Needed
// because jsdom's document.cookie read-back strips attributes (Secure, Max-Age, Domain, SameSite),
// leaving them otherwise unassertable.
const capturingDoc = (url: string): { doc: CookieDocument; writes: string[] } => {
  const real = new JSDOM('', { url }).window.document
  const { hostname, protocol } = new URL(url)
  const writes: string[] = []
  const doc: CookieDocument = {
    get cookie() {
      return real.cookie
    },
    set cookie(value: string) {
      writes.push(value)
      real.cookie = value
    },
    location: { hostname, protocol },
  }
  return { doc, writes }
}

const logSpies = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

vi.mock('./logger.js', () => ({ log: logSpies }))

// jsdom documents share a tough-cookie jar when constructed with the same CookieJar, which
// enforces real browser rules (public-suffix rejection, domain matching). Documents at different
// origins over one jar simulate a user moving between subdomains.
const docAt = (url: string, jar?: CookieJar): CookieDocument =>
  new JSDOM('', { url, ...(jar ? { cookieJar: jar } : {}) }).window.document

const KEY = '__pug_proj_profile__'
// Every set() carries a lifetime — the store owns retention, so the layer never picks one.
const TTL = 31_536_000

/** The max-age a captured cookie write carries, or NaN when there is no write to read one from. */
const maxAgeOf = (write: string | undefined): number => Number(write?.match(/max-age=(\d+)/)?.[1])

beforeEach(() => {
  vi.clearAllMocks()
})

describe('seekRegistrableDomain', () => {
  it('finds eTLD+1 from a subdomain', () => {
    expect(seekRegistrableDomain(docAt('https://app.example.com/'))).toBe('example.com')
  })

  it('finds eTLD+1 from a deep subdomain', () => {
    expect(seekRegistrableDomain(docAt('https://a.b.c.example.com/'))).toBe('example.com')
  })

  it('walks past multi-label public suffixes like .co.uk', () => {
    expect(seekRegistrableDomain(docAt('https://foo.bar.co.uk/'))).toBe('bar.co.uk')
  })

  it('returns the hostname itself when already at the registrable domain', () => {
    expect(seekRegistrableDomain(docAt('https://example.com/'))).toBe('example.com')
  })

  it('cleans up its probe cookies', () => {
    const doc = docAt('https://app.example.com/')
    seekRegistrableDomain(doc)
    expect(doc.cookie).not.toContain('__pug_probe_')
  })
})

describe('createCookieLayer', () => {
  it('returns null when config is false', () => {
    expect(grantedLayer(false, docAt('https://app.example.com/'))).toBeNull()
  })

  it('returns null and warns when the document refuses cookies', () => {
    const sandboxed: CookieDocument = {
      get cookie(): string {
        throw new Error('SecurityError')
      },
      set cookie(_value: string) {
        throw new Error('SecurityError')
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    expect(grantedLayer(true, sandboxed)).toBeNull()
    expect(logSpies.warn).toHaveBeenCalledWith('Cookies unavailable; identity will not be shared across subdomains.')
  })

  it('shares values across subdomains via the registrable domain', () => {
    const jar = new CookieJar()
    const app = grantedLayer(true, docAt('https://app.example.com/', jar))
    const www = grantedLayer(true, docAt('https://www.example.com/', jar))

    expect(app?.crossSubdomain).toBe(true)
    expect(app?.set(KEY, 'anon-123', TTL)).toBe(true)
    expect(www?.get(KEY)).toBe('anon-123')
  })

  it('does not leak values to unrelated sites sharing the jar', () => {
    const jar = new CookieJar()
    const app = grantedLayer(true, docAt('https://app.example.com/', jar))
    app?.set(KEY, 'anon-123', TTL)
    expect(docAt('https://app.other.org/', jar).cookie).not.toContain('anon-123')
  })

  it('uses a host-only cookie on localhost', () => {
    const layer = grantedLayer(true, docAt('http://localhost:3000/'))
    expect(layer).not.toBeNull()
    expect(layer?.crossSubdomain).toBe(false)
    expect(layer?.set(KEY, 'v', TTL)).toBe(true)
    expect(layer?.get(KEY)).toBe('v')
  })

  it('uses a host-only cookie on IP hosts', () => {
    const layer = grantedLayer(true, docAt('http://192.168.1.7/'))
    expect(layer?.crossSubdomain).toBe(false)
  })

  it('does not leak identity to sibling tenants on a multi-tenant platform', () => {
    // herokuapp.com is a public suffix, so the probe lands on the tenant's own host, not the
    // shared suffix — a sibling app must never see the value.
    const jar = new CookieJar()
    const app = grantedLayer(true, docAt('https://myapp.herokuapp.com/', jar))
    expect(app?.set(KEY, 'anon-123', TTL)).toBe(true)
    expect(docAt('https://other.herokuapp.com/', jar).cookie).not.toContain('anon-123')
  })

  it('honors an explicit domain narrower than the registrable domain', () => {
    const jar = new CookieJar()
    const a = grantedLayer({ domain: 'app.acme.com' }, docAt('https://a.app.acme.com/', jar))
    const b = grantedLayer({ domain: 'app.acme.com' }, docAt('https://b.app.acme.com/', jar))

    expect(a?.crossSubdomain).toBe(true)
    a?.set(KEY, 'scoped', TTL)
    expect(b?.get(KEY)).toBe('scoped')
    // The whole point of pinning a narrower domain: siblings outside it must not see the cookie.
    expect(docAt('https://blog.acme.com/', jar).cookie).not.toContain('scoped')
  })

  it('normalizes a leading dot in an explicit domain', () => {
    const layer = grantedLayer({ domain: '.app.acme.com' }, docAt('https://a.app.acme.com/'))
    expect(layer?.crossSubdomain).toBe(true)
  })

  it('falls back to host-only with a warning when the explicit domain does not cover the host', () => {
    const layer = grantedLayer({ domain: 'evil.com' }, docAt('https://app.acme.com/'))
    expect(layer?.crossSubdomain).toBe(false)
    expect(logSpies.warn).toHaveBeenCalledWith(
      'crossSubdomainTracking domain "evil.com" is not usable on "app.acme.com"; using a host-only cookie instead.',
    )
  })

  it('falls back to host-only with a warning when the explicit domain is a public suffix', () => {
    const layer = grantedLayer({ domain: 'co.uk' }, docAt('https://foo.bar.co.uk/'))
    expect(layer?.crossSubdomain).toBe(false)
    expect(logSpies.warn).toHaveBeenCalledWith(
      'crossSubdomainTracking domain "co.uk" is not usable on "foo.bar.co.uk"; using a host-only cookie instead.',
    )
  })

  // The opt-in must be *stated*. TypeScript rules these shapes out for npm consumers, but the
  // one-tag install supplies crossSubdomainTracking as untyped `data-options` JSON that no compiler
  // ever sees — and every one of these used to reach the registrable-domain probe and share
  // identity across subdomains without anyone asking for it.
  describe('never infers the opt-in from a shape that states no domain', () => {
    it('treats {} as disabled rather than auto-discovering', () => {
      // What a config builder spreading unset optionals produces.
      const jar = new CookieJar()
      const layer = grantedLayer({} as never, docAt('https://app.example.com/', jar))
      expect(layer).toBeNull()
      expect(docAt('https://other.example.com/', jar).cookie).toBe('')
      expect(logSpies.warn).toHaveBeenCalledWith(
        `crossSubdomainTracking {} does not state a domain; identity stays origin-scoped. Pass true to discover the registrable domain, or { domain: 'example.com' } to pin one.`,
      )
    })

    it('treats a leftover { maxAgeDays } from the removed arm as disabled', () => {
      // The realistic upgrade path: the object arm used to carry a cookie lifetime and still
      // auto-discovered. A one-tag page keeping that JSON must not silently retain cross-subdomain.
      expect(grantedLayer({ maxAgeDays: 30 } as never, docAt('https://app.example.com/'))).toBeNull()
    })

    it('does not warn about keys a config builder left explicitly undefined', () => {
      // { domain, maxAgeDays: undefined } is what spreading an unset legacy optional produces; the
      // key configures nothing, so "ignores [maxAgeDays]" reported a problem that was not there.
      // Object.keys sees the key either way; the extras filter must not.
      const layer = grantedLayer(
        { domain: 'example.com', maxAgeDays: undefined } as never,
        docAt('https://app.example.com/'),
      )
      expect(layer?.crossSubdomain).toBe(true)
      expect(logSpies.warn).not.toHaveBeenCalled()
    })

    it('warns when a pinned domain still carries the removed maxAgeDays key, and pins anyway', () => {
      // The other half of that upgrade path: JSON pinning a domain AND keeping the old lifetime
      // key. The domain is stated, so the opt-in stands — but the deliberately shortened lifetime
      // was silently replaced by the 365-day default, the harmful direction for a privacy setting.
      const layer = grantedLayer({ domain: 'example.com', maxAgeDays: 30 } as never, docAt('https://app.example.com/'))
      expect(layer?.crossSubdomain).toBe(true)
      expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('maxAgeDays'))
    })

    it('treats a non-string or empty domain as disabled', () => {
      expect(grantedLayer({ domain: '' } as never, docAt('https://app.example.com/'))).toBeNull()
      expect(grantedLayer({ domain: 123 } as never, docAt('https://app.example.com/'))).toBeNull()
      expect(grantedLayer({ domain: null } as never, docAt('https://app.example.com/'))).toBeNull()
    })

    it('treats a stringly-typed value from a template as disabled', () => {
      // Both are truthy non-objects, so both used to fall through to the probe — including "false".
      expect(grantedLayer('true' as never, docAt('https://app.example.com/'))).toBeNull()
      expect(grantedLayer('false' as never, docAt('https://app.example.com/'))).toBeNull()
      expect(grantedLayer(1 as never, docAt('https://app.example.com/'))).toBeNull()
    })

    it('still discovers for a literal true', () => {
      // The guard above must not have disabled the documented opt-in.
      expect(grantedLayer(true, docAt('https://app.example.com/'))?.crossSubdomain).toBe(true)
    })
  })

  it('round-trips values needing encoding', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    const value = 'a; b=c, d €'
    expect(layer?.set(KEY, value, TTL)).toBe(true)
    expect(layer?.get(KEY)).toBe(value)
  })

  it('refuses oversized values and warns', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    expect(layer?.set(KEY, 'x'.repeat(4000), TTL)).toBe(false)
    expect(logSpies.warn).toHaveBeenCalledWith(`Cookie for "${KEY}" would exceed 3800 chars; skipping cookie write.`)
  })

  it('returns false instead of throwing on malformed UTF-16 (lone surrogate)', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    expect(layer?.set(KEY, '\uD800', TTL)).toBe(false)
  })

  it('logs the cause when a cookie write throws instead of silently swallowing it', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    layer?.set(KEY, '\uD800', TTL) // encodeURIComponent throws inside writeCookie
    expect(logSpies.debug).toHaveBeenCalledWith(expect.any(String), expect.any(Error))
  })

  it('escalates that write-threw log to warn when it destroyed a twin it could not put back', () => {
    // The other half of the split above. A throw that harmed nothing is debug (the case above); a
    // throw that already expired a preserved twin to make room for itself, and then could not
    // restore it, has destroyed the sole copy — cross-subdomain reads have no localStorage fallback.
    // At debug that loss was invisible to exactly the person diagnosing it, which is the same
    // argument that put remove()'s catch at error. Only the level differs, so nothing about the
    // return value or the cookie jar can pin it.
    const real = new JSDOM('', { url: 'https://app.example.com/' }).window.document
    let failWrites = false
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        // Deletions still land — the twin must actually be destroyed — but nothing carrying a value
        // can be written, so neither the replacement nor the restore that follows it can succeed.
        if (failWrites && !value.includes('max-age=0')) {
          throw new Error('cookie store blocked mid-session')
        }
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    real.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin, registering it for a later expiry

    failWrites = true
    expect(layer?.set(KEY, persisted('replacement'), 600)).toBe(false)

    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('twin could not be put back'), expect.any(Error))
  })

  // At error, not debug. The intent ("must surface why") was always stated, but log.debug is off
  // unless the integrator already passed `debug: true` — invisible to exactly the person diagnosing
  // a failed opt-out. The teardown boolean chain now rests on this return value, and the outcome is
  // an identity cookie surviving on the registrable domain.
  it('logs the cause at error level when a cookie removal throws (privacy teardown must surface why)', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    expect(layer?.remove('\uD800')).toBe(false) // encodeURIComponent(key) throws inside remove
    expect(logSpies.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error))
    expect(logSpies.debug).not.toHaveBeenCalledWith(expect.any(String), expect.any(Error))
  })

  it('skips a malformed same-name twin and returns the valid shared value', () => {
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    // Malformed host-only twin, created first so it sorts ahead of the shared cookie.
    doc.cookie = `${KEY}=%E0%A4; path=/`
    const www = grantedLayer(true, docAt('https://www.example.com/', jar))
    expect(www?.set(KEY, 'anon-good', TTL)).toBe(true)
    const app = grantedLayer(true, doc)
    expect(app?.get(KEY)).toBe('anon-good')
  })

  it('returns null from get for a missing name', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    expect(layer?.get('missing')).toBeNull()
  })

  it('removes values across subdomains', () => {
    const jar = new CookieJar()
    const app = grantedLayer(true, docAt('https://app.example.com/', jar))
    const www = grantedLayer(true, docAt('https://www.example.com/', jar))
    app?.set(KEY, 'v', TTL)
    app?.remove(KEY)
    expect(app?.get(KEY)).toBeNull()
    expect(www?.get(KEY)).toBeNull()
  })

  it('reports removal success via the return value', () => {
    const layer = grantedLayer(true, docAt('https://app.example.com/'))
    layer?.set(KEY, 'v', TTL)
    expect(layer?.remove(KEY)).toBe(true)
    expect(layer?.get(KEY)).toBeNull()
  })

  it('clears a host-only twin on remove so it cannot be re-promoted later', () => {
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    // A legacy host-only twin coexisting with the shared cookie (older SDK / a prior host-only run).
    doc.cookie = `${KEY}=anon-legacy; path=/`
    const sibling = grantedLayer(true, docAt('https://www.example.com/', jar))
    sibling?.set(KEY, 'anon-shared', TTL)

    const local = grantedLayer(true, doc)
    // Removal must clear BOTH the shared cookie and the host-only twin, so a later reconcile on a
    // fresh page load finds nothing to promote back onto the shared cookie.
    expect(local?.remove(KEY)).toBe(true)

    const fresh = grantedLayer(true, docAt('https://app.example.com/', jar))
    expect(fresh?.get(KEY)).toBeNull()
    expect(docAt('https://app.example.com/', jar).cookie).not.toContain(KEY)
  })

  it('returns false when a blocked cookie store cannot delete the value', () => {
    // A document that silently drops deletions (max-age=0 writes) while still reporting the value —
    // e.g. cookies blocked mid-session. remove() must report the failure, not assume success, so a
    // privacy teardown surfaces rather than silently leaving identity behind.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const layer = grantedLayer(true, doc)
    expect(layer?.set(KEY, 'anon-123', TTL)).toBe(true)
    expect(layer?.remove(KEY)).toBe(false)

    // And says so. This arm was silent while the throwing one logged at error — but a no-op and a
    // throw leave the same identity cookie on the device, and the mechanism of failure does not pick
    // the severity. Callers surface remove() only as an aggregate boolean (clearProfile,
    // clearSession, the store's removeItem), so nothing else can name the key or the layer.
    expect(logSpies.error).toHaveBeenCalledWith(expect.stringContaining('survived removal'))
  })

  it('reports a failed removal once per key, then again after a later removal lands', () => {
    // remove() is not only a teardown path: the store's dropStale() reaches it from readItem(),
    // which the session read runs on every tracked event — so an unlatched report is one console
    // line per event for the life of the page. The release is the other half: a latch may report
    // once per episode but must never outlive the residue it describes.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let blockDeletes = true
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (blockDeletes && value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const survived = () => logSpies.error.mock.calls.filter(c => String(c[0]).includes('survived removal'))

    const layer = grantedLayer(true, doc)
    expect(layer?.set(KEY, 'anon-123', TTL)).toBe(true)
    expect(layer?.remove(KEY)).toBe(false)
    expect(layer?.remove(KEY)).toBe(false)
    expect(survived()).toHaveLength(1)

    // The store recovers and the key genuinely leaves the device — the reported fact is now false.
    logSpies.error.mockClear()
    blockDeletes = false
    expect(layer?.remove(KEY)).toBe(true)

    // A second, distinct teardown failure on the same key must not be swallowed by the first.
    blockDeletes = true
    expect(layer?.set(KEY, 'anon-456', TTL)).toBe(true)
    expect(layer?.remove(KEY)).toBe(false)
    expect(survived()).toHaveLength(1)
  })

  it('does not spend the teardown report on a failed write-path clear', () => {
    // persistence.setItem() reaches remove() through dropCookie when a cookie write did not land, to
    // stop the stale cookie shadowing the localStorage value. That is a *write*, not a teardown, and
    // reporting it here spent the key's one layer-level diagnostic on it — permanently, since the
    // release requires a *confirmed* removal and the jar that failed the write is still blocked. The
    // genuine opt-out that followed then named neither the key nor the layer, which is exactly the
    // gap reportRemoveFailure was added to close. The store already warns for the shadow case
    // ("shadows the stored value"), so the diagnostic is not lost, only correctly attributed.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (value.includes('max-age=0')) return // deletes blocked all the way through
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const survived = () => logSpies.error.mock.calls.filter(c => String(c[0]).includes('survived removal'))

    const layer = grantedLayer(true, doc)
    expect(layer?.set(KEY, 'anon-123', TTL)).toBe(true)

    // The write path's clear-the-shadow call: still returns false, but says nothing here.
    expect(layer?.remove(KEY, 'write')).toBe(false)
    expect(survived()).toHaveLength(0)

    // ...so the teardown that follows still gets its diagnostic, naming the key and the layer.
    expect(layer?.remove(KEY)).toBe(false)
    expect(survived()).toHaveLength(1)
  })

  // remove() latches reconciledKeys / consumes the preservedTwins registration only on a CONFIRMED
  // removal. Both directions of the up-front spelling regress quietly, so each gets its own pin.
  it('a later landed set() still reports success after a removal that did not land', () => {
    // Consumed up front, a removal that no-opped (blocked cookie store) left the twin in place but
    // untracked — so when the store healed, a *landed* set() failed read-back against the twin and
    // reported false, reaching the integrator as optOutTracking()/reset() claiming identity remains
    // on a device where the write succeeded.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let blockDeletes = false
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (blockDeletes && value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin host-only, registering it for later expiry

    blockDeletes = true
    expect(layer?.remove(KEY)).toBe(false)

    blockDeletes = false
    const next = persisted('anon-next')
    expect(layer?.set(KEY, next, 600)).toBe(true)
    expect(layer?.get(KEY)).toBe(next)
  })

  it('a failed removal leaves the key un-latched so the next access reconciles a stale twin', () => {
    // Latched up front, a removal that no-opped marked the key reconciled with the stale host-only
    // twin still present — so it shadowed the shared cookie for the rest of the page load, the
    // exact condition reconcileTwin exists to prevent.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let blockDeletes = false
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (blockDeletes && value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    // Stale host-only twin first (sorts ahead), then the authoritative shared value via a sibling.
    doc.cookie = `${KEY}=anon-stale; path=/`
    const www = grantedLayer(true, docAt('https://www.example.com/', jar))
    expect(www?.set(KEY, 'anon-shared', TTL)).toBe(true)

    const layer = grantedLayer(true, doc)
    blockDeletes = true
    expect(layer?.remove(KEY)).toBe(false)

    blockDeletes = false
    expect(layer?.get(KEY)).toBe('anon-shared')
  })

  it('expires a stale host-only twin so it cannot shadow the shared cookie', () => {
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    doc.cookie = `${KEY}=stale; path=/`
    const layer = grantedLayer(true, doc)
    expect(layer?.set(KEY, 'fresh', TTL)).toBe(true)
    expect(layer?.get(KEY)).toBe('fresh')
    expect(doc.cookie.split('; ').filter(part => part.startsWith(`${KEY}=`))).toHaveLength(1)
  })

  it('does not let a stale host-only twin shadow or corrupt the shared cookie on read', () => {
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    // A stale host-only twin, created first so it sorts ahead of the shared cookie on this origin.
    doc.cookie = `${KEY}=anon-stale; path=/`
    // The authoritative shared identity is written afterward (e.g. from a sibling subdomain).
    const www = grantedLayer(true, docAt('https://www.example.com/', jar))
    expect(www?.set(KEY, 'anon-shared', TTL)).toBe(true)

    const app = grantedLayer(true, doc)
    const read = app?.get(KEY)
    // Reads must resolve to the shared value, never the stale host-only twin.
    expect(read).toBe('anon-shared')
    // The SDK refreshes what it reads (to extend expiry); that must not promote the twin onto the
    // shared cookie. The sibling must still see the uncorrupted shared identity.
    app?.set(KEY, read as string, TTL)
    expect(www?.get(KEY)).toBe('anon-shared')
  })

  it('promotes a lone host-only value to the shared cookie so siblings inherit it', () => {
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    // Only a host-only value exists (e.g. left by a prior crossSubdomainTracking:false run).
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    const app = grantedLayer(true, doc)
    expect(app?.crossSubdomain).toBe(true)
    expect(app?.get(KEY)).toBe(stored)
    // First access promotes it to the registrable domain, so a sibling now reads the same identity.
    expect(grantedLayer(true, docAt('https://www.example.com/', jar))?.get(KEY)).toBe(stored)
  })

  it('keeps a pre-envelope host-only twin host-only instead of promoting it', () => {
    // A bare value predates the retention envelope, so it carries no deadline. Promoting it would
    // widen an identifier to the whole registrable domain that nothing can ever expire — but it is
    // handed back rather than destroyed, because only the store can say what an undecodable value
    // means: it removes one on sight, and getItemOrLegacy adopts the consent record's first.
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    doc.cookie = `${KEY}=anon-legacy; path=/`
    expect(grantedLayer(true, doc)?.get(KEY)).toBe('anon-legacy')
    expect(docAt('https://www.example.com/', jar).cookie).not.toContain('anon-legacy')
  })

  it('discards an expired host-only twin instead of promoting it', () => {
    // The expiry write leaves nothing, twinLifetime() sees the lapsed deadline, and the twin is
    // dropped — never promoted. `seconds > 0` is the whole guard between an expired identity cookie
    // and a promotion that re-widens it to the registrable domain with whatever positive lifetime a
    // "safe" clamp would grant it; a mutation flipping it to Math.max(1, seconds) survived the
    // entire suite, so the discard is pinned here.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    const writes: string[] = []
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        writes.push(value)
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    doc.cookie = `${KEY}=${encodeURIComponent(persisted('anon-old', -60_000))}; path=/`
    expect(grantedLayer(true, doc)?.get(KEY)).toBeNull()
    const promotion = writes.find(w => w.startsWith(`${KEY}=`) && w.includes('domain=') && !w.includes('max-age=0'))
    expect(promotion).toBeUndefined()
  })

  it('warns and retries on a later access when twin reconciliation throws mid-way', () => {
    // reconciledKeys was marked before the try: a throw at the expiry write latched the key as
    // done, so the stale twin kept shadowing the shared cookie for the whole page load with no
    // retry — the exact condition the function exists to prevent — and the only trace was a debug
    // line no default install can see.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let expiryAttempts = 0
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (value.startsWith(`${KEY}=`) && value.includes('max-age=0') && !value.includes('domain=')) {
          expiryAttempts += 1
          throw new Error('blocked')
        }
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    real.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    const layer = grantedLayer(true, doc)

    layer?.get(KEY)
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('reconcil'), expect.anything())

    layer?.get(KEY)
    expect(expiryAttempts).toBe(2) // un-latched on failure, so the next access retries
    expect(logSpies.warn).toHaveBeenCalledTimes(1) // …while the warning stays once per key
  })

  it('restores the host-only twin when promoting it to the shared cookie fails', () => {
    // A document that accepts probe/host-only writes but drops the long-lived domain-scoped identity
    // write (a browser that stops accepting domain cookies mid-session). The lone host-only value
    // must survive — restored — rather than be lost when the promotion write cannot land, since
    // cross-subdomain reads do not fall back to localStorage.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        // Drop the domain-scoped identity write only; the probe uses its own key name.
        if (value.includes(KEY) && value.includes('domain=.example.com')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    const layer = grantedLayer(true, doc)
    expect(layer?.crossSubdomain).toBe(true)
    expect(layer?.get(KEY)).toBe(stored)
  })

  it('restores the twin with its original attributes, not a bare write', () => {
    // The raw fallback dropped SameSite and secure, handing a previously-Secure identity cookie to
    // plain http on the same host.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    const writes: string[] = []
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        writes.push(value)
        if (value.includes(KEY) && value.includes('domain=.example.com')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    grantedLayer(true, doc)?.get(KEY)
    // Not the promotion attempt (domain-scoped, dropped above), not the expiry (max-age=0), not the
    // seed (no max-age) — the host-only restore is what is left.
    const restore = writes.find(
      w => w.startsWith(`${KEY}=`) && !w.includes('domain=') && w.includes('max-age=') && !w.includes('max-age=0'),
    )
    expect(restore).toBeDefined()
    expect(restore).toContain('SameSite=Lax')
    expect(restore).toContain('; secure')
  })

  it('reports at error when neither the promotion nor the restore lands, losing the twin', () => {
    // The restore is the last copy anywhere — cross-subdomain reads have no localStorage fallback —
    // so a restore that also fails must not be silent.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        // Allow the expiry (so the twin actually goes away), drop the promotion and the restore.
        if (value.startsWith(`${KEY}=`) && !value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    // Seeded through the real document — the dropping setter above must only affect SDK writes.
    real.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    expect(grantedLayer(true, doc)?.get(KEY)).toBeNull()
    // Error, not warn: this only runs in cross-subdomain mode, where the twin was the sole copy and
    // reads have no localStorage fallback — a confirmed loss, reported the way clearProfile()
    // reports the same outcome.
    expect(logSpies.error).toHaveBeenCalledWith(expect.stringContaining('restore'))
  })
})

describe('cookie attributes', () => {
  const identityWrite = (writes: string[]): string | undefined => writes.find(w => w.includes('max-age=31536000'))

  it('writes Secure, SameSite=Lax, path, domain, and a 365-day max-age on https', () => {
    const { doc, writes } = capturingDoc('https://app.example.com/')
    const layer = grantedLayer(true, doc)
    expect(layer?.set(KEY, 'v', TTL)).toBe(true)
    const write = identityWrite(writes)
    expect(write).toBeDefined()
    expect(write).toContain('; secure')
    expect(write).toContain('SameSite=Lax')
    expect(write).toContain('path=/')
    expect(write).toContain('domain=.example.com')
  })

  it('omits Secure on http so http subdomains can still read the cookie', () => {
    const { doc, writes } = capturingDoc('http://app.example.com/')
    const layer = grantedLayer(true, doc)
    expect(layer?.set(KEY, 'v', TTL)).toBe(true)
    const write = identityWrite(writes)
    expect(write).toBeDefined()
    expect(write).not.toContain('secure')
  })
})

describe('cookie lifetime', () => {
  // The identity write is the long-lived one; probe writes carry max-age=3 or max-age=0.
  const longLivedWrite = (writes: string[]): string | undefined =>
    writes.find(w => w.includes(KEY) && !w.includes('max-age=0'))

  it("uses the caller's lifetime, so the cookie dies with the value it holds", () => {
    const { doc, writes } = capturingDoc('https://app.example.com/')
    grantedLayer(true, doc)?.set(KEY, 'v', 600)
    expect(longLivedWrite(writes)).toContain('max-age=600')
  })

  it('promotes a host-only twin with the lifetime it has left, not a fresh full-length one', () => {
    // The twin carries its own deadline; a fresh 365-day max-age would leave the cookie outliving
    // the value inside it, and would ignore a lowered maxAgeDays entirely.
    const { doc, writes } = capturingDoc('https://app.example.com/')
    doc.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy', 600_000))}; path=/`
    grantedLayer(true, doc)?.get(KEY)
    const write = writes.find(w => w.includes(KEY) && w.includes('domain=.example.com'))
    const maxAge = maxAgeOf(write)
    expect(maxAge).toBeGreaterThan(500)
    expect(maxAge).toBeLessThanOrEqual(600)
  })
})

describe('restoring a twin whose registration a failed write consumed', () => {
  // writeCookie() expires a preserved twin to make room for its own write, so a write that then
  // fails must put the twin back — restoreConsumedTwin. Every existing twin-restore case asserts
  // only that the value *comes back*, which the lifetime cannot affect, so the whole function was
  // free: replacing its body with a flat `preserveTwin(key, value, 31536000)` — reintroducing the
  // captured-TTL bug at its maximum — left the entire suite green.

  /**
   * A layer holding a preserved host-only twin with `ttlMs` left, plus a switch for making the next
   * cookie write fail. Preserved via the denied arm of reconcileTwin, which is what registers a twin
   * in the first place; `advance` moves the clock so "recomputed now" and "captured when preserved"
   * stop agreeing — without it every implementation of the lifetime looks identical.
   */
  const withPreservedTwin = (ttlMs: number) => {
    const real = new JSDOM('', { url: 'https://app.example.com/' }).window.document
    const writes: string[] = []
    let blocked: string | null = null
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (blocked !== null && value.includes(blocked)) {
          return
        }
        writes.push(value)
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const twin = persisted('anon-legacy', ttlMs)
    real.cookie = `${KEY}=${encodeURIComponent(twin)}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin host-only and registers it for a later expiry
    writes.length = 0 // the preserve-time restore is not the write under test

    const clock = vi.spyOn(Date, 'now')
    const start = Date.now()
    return {
      layer,
      advance: (ms: number) => clock.mockReturnValue(start + ms),
      /** A set() whose write cannot land, so writeCookie consumes the twin and must restore it. */
      failingSet: () => {
        blocked = 'replacement'
        return layer?.set(KEY, persisted('replacement'), 600)
      },
      restore: () => writes.find(w => w.includes('anon-legacy')),
      done: () => clock.mockRestore(),
    }
  }

  it('puts it back with the lifetime it has left now, not the one it had when preserved', () => {
    // A twin preserved with 600s left and restored 300s later must go back with ~300s. Replaying the
    // preserve-time figure writes a cookie that outlives the deadline stamped in the value it
    // carries, contradicting CookieLayer.set's "the cookie expires with the value it holds" on the
    // one path that also widens scope. Not a data leak — the envelope still governs what the store
    // reads — but the physical cookie sits on the device past its own deadline.
    // 900s preserved, 300s elapsed, so ~600s expected — deliberately NOT 300, which is
    // LEGACY_TWIN_RESTORE_SECONDS. At the old 600/300 figures the expected value and the legacy
    // constant coincided, so collapsing the ternary that picks between them (giving *every* twin the
    // legacy lifetime, decodable or not) passed this test.
    const twin = withPreservedTwin(900_000)
    try {
      twin.advance(300_000)
      expect(twin.failingSet()).toBe(false)

      const maxAge = maxAgeOf(twin.restore())
      expect(maxAge).toBeGreaterThan(550)
      expect(maxAge).toBeLessThanOrEqual(600)
    } finally {
      twin.done()
    }
  })

  it('does not put back a twin whose retention ended while it was preserved', () => {
    // The 'expired' arm. writeCookie's expiry write already removed it, which is exactly what its
    // own deadline asks for — restoring it would resurrect an identifier past its retention bound,
    // on a path the store cannot see.
    const twin = withPreservedTwin(600_000)
    try {
      twin.advance(700_000)
      expect(twin.failingSet()).toBe(false)

      expect(twin.restore()).toBeUndefined()
      expect(twin.layer?.get(KEY)).toBeNull()
    } finally {
      twin.done()
    }
  })
})

describe('consent gate on the twin promotion', () => {
  /** A lone host-only twin at app.example.com, over a jar its sibling can be read from. */
  const seedTwin = () => {
    const jar = new CookieJar()
    const doc = docAt('https://app.example.com/', jar)
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    return { jar, doc, stored }
  }

  const siblingSees = (jar: CookieJar) => docAt('https://www.example.com/', jar).cookie.includes('anon-legacy')

  // The untyped-caller shape the arity pin in consent-gate.test-d.ts cannot reach. An omitted gate
  // used to throw inside reconcileTwin's try — after the live twin was already expired, so the
  // misuse *destroyed a value* and produced only a once-per-key warn. A TypeError at creation fails
  // loud before any twin machinery runs, matching configureProfile and configureSession.
  it('throws at creation on an omitted gate instead of destroying a twin later', () => {
    expect(() => (createCookieLayer as (c: unknown, g?: unknown, d?: unknown) => unknown)(true)).toThrow(TypeError)
  })

  // reconcileTwin() promotes a lone host-only cookie onto the registrable domain. That is an
  // identity *write*, and it happens on the read path, so every other consent check missed it:
  // configureProfile reads external_id unconditionally (only its refresh write was gated), so a
  // denied or default-cookieless init widened an identify()ed email to every sibling subdomain.
  it('does not promote a host-only twin while consent is not granted', () => {
    const { jar, doc } = seedTwin()

    createCookieLayer(true, DENIED, doc)?.get(KEY)

    expect(siblingSees(jar)).toBe(false)
  })

  // Skipping the promotion must not cost the value: the expiry probe runs regardless (it is a
  // deletion, and it is what stops a stale twin shadowing the shared cookie), so the twin is put
  // back rather than left destroyed. Read back through a *second denied* layer — through a granted
  // one the read itself promotes, so the assertion could not tell "restored" from "never touched".
  it('restores the twin, still readable on this host and still invisible to siblings', () => {
    const { jar, doc, stored } = seedTwin()

    createCookieLayer(true, DENIED, doc)?.get(KEY)

    expect(createCookieLayer(true, DENIED, doc)?.get(KEY)).toBe(stored)
    expect(siblingSees(jar)).toBe(false)
  })

  it('restores it with its host-only attributes, not a bare write', () => {
    // Same reason the failed-promotion restore does: a bare write drops SameSite and secure, and
    // hands a previously-Secure identity cookie to plain http on the same host.
    const { doc, writes } = capturingDoc('https://app.example.com/')
    doc.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    writes.length = 0 // drop the seed write above, which is not the layer's
    createCookieLayer(true, DENIED, doc)?.get(KEY)

    const restore = writes.find(w => w.includes('anon-legacy') && !w.includes('max-age=0'))
    expect(restore).toContain('SameSite=Lax')
    expect(restore).toContain('secure')
    expect(restore).not.toContain('domain=')
  })

  it('keeps a pre-envelope twin host-only and short-lived under a denied gate too', () => {
    // The undecodable arm runs before the gate — deliberately, since what a bare value means is
    // the store's call and getItemOrLegacy needs it handed up — so this is a Set-Cookie carrying a
    // raw identifier while consent is withheld. Net-zero on the device: never widened (no shared
    // write), and the restore carries LEGACY_TWIN_RESTORE_SECONDS rather than a lifetime of its
    // own — long enough for the store's same-call read, short enough that a value nothing can
    // expire cannot linger if that read never comes.
    const { doc, writes } = capturingDoc('https://app.example.com/')
    doc.cookie = `${KEY}=anon-legacy; path=/`
    writes.length = 0
    expect(createCookieLayer(true, DENIED, doc)?.get(KEY)).toBe('anon-legacy')

    expect(writes.filter(w => w.includes('domain=') && !w.includes('__pug_probe_'))).toEqual([])
    const restore = writes.find(w => w.includes('anon-legacy') && !w.includes('max-age=0'))
    expect(restore).toContain('max-age=300')
  })

  // The reconciliation latches even when it cannot promote. Un-latched, every later get()/set()
  // repeated the delete-and-restore — an identity Set-Cookie on the *read* path, in the one consent
  // state that promises no device writes at all (measured: 10 cookie writes across 5 reads).
  it('does not repeat the delete-and-restore on later accesses', () => {
    const { doc, writes } = capturingDoc('https://app.example.com/')
    doc.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    writes.length = 0

    for (let i = 0; i < 5; i++) {
      layer?.get(KEY)
    }

    expect(writes.filter(w => !w.includes('__pug_probe_'))).toHaveLength(2) // one expire + one restore
  })

  it('a refused oversized write leaves the preserved twin readable', () => {
    // writeCookie expires a preserved twin only after the size/encodability checks: expired ahead
    // of them, an oversized or unencodable value destroyed the sole copy (cross-subdomain reads
    // have no localStorage fallback) and returned false with nothing in its place.
    const { doc } = capturingDoc('https://app.example.com/')
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin host-only

    expect(layer?.set(KEY, 'x'.repeat(4000), 600)).toBe(false)
    expect(layer?.get(KEY)).toBe(stored)
  })

  it('restores the preserved twin when the replacement write does not land', () => {
    // The pre-write expiry consumes the preserved twin so read-back cannot resolve to it — but if
    // the replacement write is then rejected (a cookie store blocked mid-session), returning false
    // with the twin destroyed leaves the device holding nothing. The failed-write path must put it
    // back, exactly like reconcileTwin's failed-promotion arm. The reachable case is the consent
    // record: its restore write is the first set() after the preserving reconcile, and losing the
    // twin there reverts a recorded refusal to the config seed on the next init().
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let blockShared = false
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        // Blocks only the domain-scoped replacement write: deletions (max-age=0) and the
        // host-only restore must still land, or the test could not tell "restored" from "the
        // whole jar is dead".
        if (blockShared && value.includes('domain=') && !value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin host-only

    blockShared = true
    expect(layer?.set(KEY, persisted('anon-next'), 600)).toBe(false)
    expect(layer?.get(KEY)).toBe(stored)
  })

  it('puts the preserved twin back when the replacement write throws', () => {
    // The read-back-mismatch path is covered above; a *throwing* jar reaches the same loss by a
    // different route — the pre-write expiry has already landed, so without the catch's restore the
    // twin is simply gone, and in cross-subdomain mode it was the sole copy. Deleting that restore
    // block left the whole suite green before this case existed.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let throwShared = false
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        // Only the domain-scoped replacement throws: the expiry (max-age=0) must land, or the twin
        // would never be consumed and there would be nothing to restore.
        if (throwShared && value.includes('domain=') && !value.includes('max-age=0')) {
          throw new Error('blocked')
        }
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    const stored = persisted('anon-legacy')
    doc.cookie = `${KEY}=${encodeURIComponent(stored)}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin host-only

    throwShared = true
    expect(layer?.set(KEY, persisted('anon-next'), 600)).toBe(false)
    expect(layer?.get(KEY)).toBe(stored)
  })

  it('does not resurrect a removed value through a later failed write', () => {
    // remove() clears the preserved-twin registration, but only on a *confirmed* removal. Left
    // behind, the registration outlives the teardown and the failed-write restore above puts the
    // twin back — returning an identify()ed email to the device after optOutTracking()/reset()
    // already reported success. Deleting `preservedTwins.delete(key)` left the suite green.
    const jar = new CookieJar()
    const real = new JSDOM('', { url: 'https://app.example.com/', cookieJar: jar }).window.document
    let blockShared = false
    const doc: CookieDocument = {
      get cookie() {
        return real.cookie
      },
      set cookie(value: string) {
        if (blockShared && value.includes('domain=') && !value.includes('max-age=0')) return
        real.cookie = value
      },
      location: { hostname: 'app.example.com', protocol: 'https:' },
    }
    doc.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY) // preserves the twin host-only

    expect(layer?.remove(KEY)).toBe(true)
    expect(layer?.get(KEY)).toBeNull()

    blockShared = true
    expect(layer?.set(KEY, persisted('anon-next'), 600)).toBe(false)
    expect(layer?.get(KEY)).toBeNull() // the teardown holds — nothing came back
  })

  // A preserved twin was created before any shared cookie, so RFC 6265 sorts it first in
  // document.cookie: left in place, it wins writeCookie's read-back and a write that landed
  // reports failure — which reaches the integrator as optOutTracking() returning false, i.e.
  // "identity may still be on this device" shown to an end user.
  it('reports a shared write as persisted even after preserving a twin', () => {
    const { doc } = capturingDoc('https://app.example.com/')
    doc.cookie = `${KEY}=${encodeURIComponent(persisted('anon-legacy'))}; path=/`
    const layer = createCookieLayer(true, DENIED, doc)
    layer?.get(KEY)

    const next = persisted('anon-new') // once: persisted() stamps Date.now(), so two calls differ
    expect(layer?.set(KEY, next, 600)).toBe(true)
    expect(layer?.get(KEY)).toBe(next)
  })
})
