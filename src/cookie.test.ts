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
    // The expiry write leaves nothing, remainingSeconds() sees the lapsed deadline, and the twin is
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

  it('warns when neither the promotion nor the restore lands, losing the twin', () => {
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
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('restore'))
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
    const maxAge = Number(/max-age=(\d+)/.exec(write ?? '')?.[1])
    expect(maxAge).toBeGreaterThan(500)
    expect(maxAge).toBeLessThanOrEqual(600)
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
