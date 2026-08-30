import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureUrlRedaction,
  decodeStored,
  encodeStored,
  getSafeElementText,
  isAutomatedBrowser,
  isCaptureSuppressed,
  isStorageAvailable,
  makeStorageKey,
  scrubUrl,
} from './utils.js'

describe('the retention envelope', () => {
  it('round-trips a value, including one containing the separator', () => {
    // Reachable: identify('tenant|user-42') persists that string as the externalId, which becomes
    // the distinctId on every later event. Splitting on the last | would quietly fork the profile.
    for (const value of ['anon-123', 'tenant|user-42', '', '|leading', 'trailing|']) {
      expect(decodeStored(encodeStored(value, 1_700_000_000_000))).toEqual({ value, expiresAt: 1_700_000_000_000 })
    }
  })

  it('reads anything without a numeric deadline prefix as absent', () => {
    // The pre-1.0 migration: a bare value written by an older build is unreadable, so the device
    // mints a fresh anonymous ID once.
    expect(decodeStored(null)).toBeNull()
    expect(decodeStored('anon-legacy')).toBeNull()
    expect(decodeStored('|no-deadline')).toBeNull()
    expect(decodeStored('notanumber|v')).toBeNull()
  })

  // Everything the brand is cited for assumes an envelope decodes: CookieLayer.set requires it so a
  // bare value cannot reach the cookie layer, and readItem treats an undecodable value as a
  // pre-envelope legacy one. A non-finite deadline satisfied the brand and failed decodeStored, so
  // the two disagreed — and getItemOrLegacy, which exists to *adopt* an undecodable value, would
  // have handed a corrupt write back as a recorded consent choice. Unreachable today (setItem's
  // Math.min has finite operands by construction), which is exactly why it needs pinning here
  // rather than a note that it cannot happen.
  it('never mints an envelope its own decoder rejects', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(decodeStored(encodeStored('anon-123', bad))).not.toBeNull()
    }
  })

  it('stamps an unusable deadline as already expired rather than never expiring', () => {
    // The safe direction of the clamp: the value is dropped on its next read, which is what an
    // undecodable one did anyway. Never-expiring would be the failure that outlives every teardown.
    expect(decodeStored(encodeStored('anon-123', Number.POSITIVE_INFINITY))?.expiresAt).toBe(0)
  })
})

describe('scrubUrl', () => {
  afterEach(() => {
    configureUrlRedaction(undefined)
  })

  it('leaves a URL with nothing sensitive untouched, byte for byte', () => {
    const url = 'https://shop.example.com/orders/42?utm_source=news&sort=date+desc'
    expect(scrubUrl(url)).toBe(url)
  })

  it('redacts credentials and direct identifiers from the query', () => {
    expect(scrubUrl('https://x.com/reset?token=abc123&user=42')).toBe('https://x.com/reset?token=redacted&user=42')
    expect(scrubUrl('https://x.com/?email=jane%40example.com')).toBe('https://x.com/?email=redacted')
  })

  it('matches param names case-insensitively', () => {
    expect(scrubUrl('https://x.com/?Access_Token=abc')).toBe('https://x.com/?Access_Token=redacted')
  })

  it('redacts every distinct key when a sensitive param appears more than once', () => {
    // Pins the live params.keys() iteration: set() replaces the pair at the cursor and splices away
    // later duplicates of the same name, so no *distinct* key may be skipped. A "tidy" rewrite to
    // copied or index-based iteration can get this wrong silently — the fuzz run that validated it
    // does not survive into the suite, this does.
    expect(scrubUrl('https://x.com/?token=a&token=b&email=c&keep=1')).toBe(
      'https://x.com/?token=redacted&email=redacted&keep=1',
    )
  })

  it('redacts an OAuth implicit-flow fragment, which never reaches a server except through us', () => {
    expect(scrubUrl('https://x.com/cb#access_token=abc&token_type=bearer')).toBe(
      'https://x.com/cb#access_token=redacted&token_type=bearer',
    )
  })

  it('redacts a hash router query without mangling the route', () => {
    expect(scrubUrl('https://x.com/#/orders?token=abc&page=2')).toBe('https://x.com/#/orders?token=redacted&page=2')
  })

  it('leaves a plain hash route alone', () => {
    expect(scrubUrl('https://x.com/#/settings/billing')).toBe('https://x.com/#/settings/billing')
    expect(scrubUrl('https://x.com/#section')).toBe('https://x.com/#section')
    expect(scrubUrl('https://x.com/#!/legacy/hashbang')).toBe('https://x.com/#!/legacy/hashbang')
    // No redacted key, so it comes back untouched via the same path a token-bearing one takes.
    expect(scrubUrl('https://x.com/#/search/q=shoes/page=2')).toBe('https://x.com/#/search/q=shoes/page=2')
  })

  it('redacts an implicit-flow fragment whose other params contain slashes', () => {
    // A `state=/dashboard` or `redirect_uri=https://…` next to the token is the ordinary shape of an
    // OIDC callback. Skipping the whole fragment whenever it contained a '/' — on the theory that a
    // slash meant "route, not query" — disabled redaction in exactly the case it exists for.
    expect(scrubUrl('https://x.com/cb#access_token=abc&state=/dashboard')).toBe(
      'https://x.com/cb#access_token=redacted&state=%2Fdashboard',
    )
    expect(scrubUrl('https://x.com/cb#id_token=abc&redirect_uri=https://x.com/next')).toBe(
      'https://x.com/cb#id_token=redacted&redirect_uri=https%3A%2F%2Fx.com%2Fnext',
    )
  })

  // Query and fragment are redacted by two separate matchers joined by one "unchanged" protocol, and
  // every case above exercises exactly one of them — so returning early after the first match, or
  // dropping either call, passed the whole suite. An OIDC callback that carries both is the real
  // shape: the authorization code in the query, the token in the fragment.
  it('redacts query and fragment in the same URL', () => {
    expect(scrubUrl('https://x.com/cb?code=abc&page=2#access_token=xyz&state=ok')).toBe(
      'https://x.com/cb?code=redacted&page=2#access_token=redacted&state=ok',
    )
  })

  it('redacts one side without disturbing an unmatched other side', () => {
    expect(scrubUrl('https://x.com/cb?page=2#access_token=xyz')).toBe('https://x.com/cb?page=2#access_token=redacted')
    expect(scrubUrl('https://x.com/cb?token=abc#/orders/42')).toBe('https://x.com/cb?token=redacted#/orders/42')
  })

  // The same combination on the fail-closed path — scrubOpaque has its own pair of calls, so the
  // parseable case above pins neither of them.
  it('redacts query and fragment together when the URL does not parse', () => {
    expect(scrubUrl('http://ex ample.com/cb?code=abc&page=2#access_token=xyz')).toBe(
      'http://ex ample.com/cb?code=redacted&page=2#access_token=redacted',
    )
  })

  it('passes through empty input', () => {
    expect(scrubUrl('')).toBe('')
  })

  // Fail closed: this is a privacy control, so input too malformed for `new URL` still gets its
  // params redacted at the string level rather than passing through raw. The reachable funnel is
  // form.action — when the browser cannot parse the attribute against the base URL, the IDL getter
  // returns the raw attribute text, template bugs (a space in the host) included.
  it('redacts query params even when the URL does not parse', () => {
    expect(scrubUrl('not a url ?token=abc')).toBe('not a url ?token=redacted')
    expect(scrubUrl('http://ex ample.com/reset?token=s3cr3t')).toBe('http://ex ample.com/reset?token=redacted')
  })

  it('redacts fragment params even when the URL does not parse', () => {
    expect(scrubUrl('bad url#access_token=abc')).toBe('bad url#access_token=redacted')
    expect(scrubUrl('bad url#/route?token=a&page=2')).toBe('bad url#/route?token=redacted&page=2')
  })

  it('returns unparseable input byte-identical when nothing matches', () => {
    expect(scrubUrl('not a url ?page=2')).toBe('not a url ?page=2')
    expect(scrubUrl('bad url#/settings/billing')).toBe('bad url#/settings/billing')
  })

  it('passes a non-string value through instead of throwing', () => {
    // form.action is element-typed in browsers when a control is named "action" (HTMLFormElement is
    // [LegacyOverrideBuiltIns], so named properties shadow IDL attributes), and this function's own
    // JSDoc promises it never throws.
    const shadowed = document.createElement('input')
    expect(scrubUrl(shadowed as never)).toBe(shadowed)
  })

  // The list is the feature. Named individually because dropping one — a rebase, or a "dedupe
  // apikey/api_key" tidy — otherwise reopens exactly the leak it was added for, silently.
  it.each([
    'access_token',
    'api_key',
    'apikey',
    'auth',
    'authorization',
    'code',
    'email',
    'id_token',
    'otp',
    'passwd',
    'password',
    'phone',
    'pwd',
    'refresh_token',
    'secret',
    'sig',
    'signature',
    'ssn',
    'token',
  ])('redacts %s by default', param => {
    expect(scrubUrl(`https://x.com/?${param}=s3cr3t`)).toBe(`https://x.com/?${param}=redacted`)
  })

  it('redacts any *_token param by default, covering framework reset-link names', () => {
    // Rails/Devise ship reset_password_token, confirmation_token, invite_token — the single most
    // common shape a reset link takes — and exact matching missed every one of them.
    expect(scrubUrl('https://x.com/reset?reset_password_token=abc')).toBe(
      'https://x.com/reset?reset_password_token=redacted',
    )
    expect(scrubUrl('https://x.com/?CONFIRMATION_TOKEN=abc')).toBe('https://x.com/?CONFIRMATION_TOKEN=redacted')
  })

  it('applies the *_token suffix rule only to the default list', () => {
    // A replacement list is the integrator's exact statement; widening it behind their back would
    // redact params they deliberately kept.
    configureUrlRedaction(['email'])
    expect(scrubUrl('https://x.com/?reset_password_token=abc')).toBe('https://x.com/?reset_password_token=abc')
  })

  it('honors a replacement list', () => {
    configureUrlRedaction(['orderid'])
    expect(scrubUrl('https://x.com/?orderId=7&token=abc')).toBe('https://x.com/?orderId=redacted&token=abc')
  })

  it('lowercases the configured list, so a naturally-cased entry still matches', () => {
    // Lookups lowercase the URL's key; without the same on the config side, the obvious
    // `['Token', 'OrderId']` would match nothing at all and say nothing about it.
    configureUrlRedaction(['OrderId'])
    expect(scrubUrl('https://x.com/?orderId=7')).toBe('https://x.com/?orderId=redacted')
  })

  it('captures URLs verbatim when redaction is disabled', () => {
    configureUrlRedaction(false)
    expect(scrubUrl('https://x.com/reset?token=abc123')).toBe('https://x.com/reset?token=abc123')
  })

  it('keeps the default list when configured with an empty array', () => {
    // init() warns and never forwards []; this re-defends the direct call, where an empty Set is
    // truthy and matches nothing — disabling redaction exactly like `false`, but silently.
    configureUrlRedaction([])
    expect(scrubUrl('https://x.com/reset?token=abc123')).toBe('https://x.com/reset?token=redacted')
  })
})

describe('safeStringify', () => {
  it('stringifies the values JSON.stringify throws or gives up on', async () => {
    const { safeStringify } = await import('./utils.js')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(safeStringify(circular)).toBe('[object Object]') // circular → String() fallback
    expect(safeStringify(5n)).toBe('5') // bigint throws in JSON.stringify
    expect(safeStringify(undefined)).toBe('undefined') // JSON.stringify returns undefined
    expect(safeStringify({ a: 1 })).toBe('{"a":1}') // the ordinary case is unchanged
    expect(
      safeStringify({
        toString() {
          throw new Error('nope')
        },
        toJSON() {
          throw new Error('nope')
        },
      }),
    ).toBe('[unrepresentable]') // even String() throwing must not escape a log call
  })

  // JSON.stringify maps the non-finite numbers to the *string* "null", not to undefined, so the
  // `?? String(value)` fallback never fired for them. Every caller here interpolates a value it is
  // in the middle of rejecting, and these are the headline rejections: `Infinity` is what
  // JSON.parse yields for the `1e999` a data-options config can carry, and it is named by hand in
  // the comment above batch's validator as the value that disabled the queue bound. Reported as
  // "null" it named the *other* documented case, sending an integrator to look for a null they
  // never wrote.
  it('names the non-finite numbers rather than reporting them as null', async () => {
    const { safeStringify } = await import('./utils.js')
    expect(safeStringify(Number.POSITIVE_INFINITY)).toBe('Infinity')
    expect(safeStringify(Number.NEGATIVE_INFINITY)).toBe('-Infinity')
    expect(safeStringify(Number.NaN)).toBe('NaN')
    // A real null still reads as null — the two cases are distinguishable again, which is the point.
    expect(safeStringify(null)).toBe('null')
  })
})

describe('makeStorageKey', () => {
  it('formats key with dunder pattern', () => {
    expect(makeStorageKey('proj1', 'session')).toBe('__pug_proj1_session__')
  })

  it('handles special characters in projectId', () => {
    expect(makeStorageKey('my-project', 'queue')).toBe('__pug_my-project_queue__')
  })
})

describe('isCaptureSuppressed', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns false for null', () => {
    expect(isCaptureSuppressed(null)).toBe(false)
  })

  it('returns false for an unmarked element', () => {
    document.body.innerHTML = '<button id="b">Pay</button>'
    expect(isCaptureSuppressed(document.getElementById('b'))).toBe(false)
  })

  it('returns true when the element itself is marked', () => {
    document.body.innerHTML = '<button id="b" data-pug-no-capture>John Doe</button>'
    expect(isCaptureSuppressed(document.getElementById('b'))).toBe(true)
  })

  it('returns true when an ancestor is marked (covers everything inside it)', () => {
    document.body.innerHTML = '<div data-pug-no-capture><span><a id="inner">x@y.com</a></span></div>'
    expect(isCaptureSuppressed(document.getElementById('inner'))).toBe(true)
  })
})

describe('getSafeElementText', () => {
  const el = (html: string): Element => {
    document.body.innerHTML = html
    return document.getElementById('t') as Element
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns empty for null', () => {
    expect(getSafeElementText(null, 50)).toBe('')
  })

  it('reads direct child text nodes, skipping descendant text', () => {
    expect(getSafeElementText(el('<div id="t">Order <span>jane@example.com</span> total</div>'), 50)).toBe(
      'Order total',
    )
  })

  it('returns empty when the element only wraps other elements', () => {
    expect(getSafeElementText(el('<div id="t"><span>4111 1111 1111 1111</span></div>'), 50)).toBe('')
  })

  it('truncates to maxLength after collapsing whitespace', () => {
    expect(getSafeElementText(el(`<div id="t">  a\n\n  b  </div>`), 3)).toBe('a b')
  })

  // The early bail must not change the result, only how much is concatenated first.
  it('truncates correctly past the internal bail threshold', () => {
    expect(getSafeElementText(el(`<div id="t">${'ab '.repeat(500)}</div>`), 5)).toBe('ab ab')
  })

  it('drops whitespace the truncation exposes', () => {
    expect(getSafeElementText(el('<div id="t">abcd <span>X</span>efg</div>'), 5)).toBe('abcd')
  })

  it('returns empty for a textarea', () => {
    document.body.innerHTML = '<textarea id="t">my private draft</textarea>'
    expect(getSafeElementText(document.getElementById('t') as Element, 50)).toBe('')
  })

  it('returns empty when the element itself is contenteditable', () => {
    expect(getSafeElementText(el('<div id="t" contenteditable="true">typed by the user</div>'), 50)).toBe('')
  })

  // contenteditable is inherited: editors put it on a root and the pointer lands on a descendant, so
  // reading the attribute off the target alone leaked the whole draft.
  it('returns empty when an ancestor is contenteditable', () => {
    expect(getSafeElementText(el('<div contenteditable="true"><p id="t">my secret diary entry</p></div>'), 50)).toBe('')
  })

  it('still captures inside a contenteditable="false" island', () => {
    expect(
      getSafeElementText(
        el('<div contenteditable="true"><span id="t" contenteditable="false">Static</span></div>'),
        50,
      ),
    ).toBe('Static')
  })

  it('treats contenteditable with no value as editable', () => {
    expect(getSafeElementText(el('<div contenteditable=""><p id="t">draft</p></div>'), 50)).toBe('')
  })
})

describe('isStorageAvailable', () => {
  // `strandedProbeKey` is module-level mutable state and this is the only block that drives it, so
  // without a reset the tests below inherit a key from whichever ran first — and one of them
  // ("is not fooled by a stale probe value") then passes by a different mechanism than the one its
  // comment names. Uniquely among the suites that touch localStorage, this block also had no
  // clear(), while asserting on the device's probe-key contents.
  beforeEach(() => {
    localStorage.clear()
    // Releases any retained stranded key: its residue is gone, so the removal read-back lands and
    // the module returns to per-call keys. Then clear this probe's own leavings.
    isStorageAvailable()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const PROBE_PREFIX = '__pug___probe_'
  const probeKeys = () =>
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k?.startsWith(PROBE_PREFIX))

  // Instance spies, not Storage.prototype: in this jsdom environment a prototype-level spy never
  // fires, so the faults below would never be injected — the negative cases would fail against a
  // healthy store instead of exercising the fault they name, and the positive ones would pass
  // vacuously.
  it('reports available for a working store', () => {
    expect(isStorageAvailable()).toBe(true)
  })

  it('reports unavailable when the store throws', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(isStorageAvailable()).toBe(false)
  })

  // The shim adversary: a Storage proxy (privacy extension, a partial polyfill) that accepts every
  // call and stores nothing. Without the probe reading back, the store treated it as usable and
  // every later write reported success while nothing survived — and the store's own setItem cannot
  // afford a per-write read-back, since it is on the per-event session path.
  it('reports unavailable when the store silently no-ops writes', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {})
    expect(isStorageAvailable()).toBe(false)
  })

  // Deliberately still available: a removal that no-ops is a narrower fault than a write that does
  // — values still persist — and PersistentStore.removeItem verifies removals per call. Failing the
  // whole layer here would downgrade the default install to memory-only, i.e. a fresh anonymous ID
  // and session on every page load, over a teardown defect.
  it('still reports available when only removals no-op', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})
    expect(isStorageAvailable()).toBe(true)
  })

  // A fixed probe key let residue from an earlier failed run read back as this run's own write, so
  // a store that no-ops setItem reported available — the exact fault the read-back exists to catch.
  // The per-call key closes it by construction: the seeded residue can never be at this run's key.
  it('is not fooled by a stale probe value left on the device', () => {
    localStorage.setItem('__pug___probe__', '1')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {})
    expect(isStorageAvailable()).toBe(false)
    localStorage.removeItem('__pug___probe__')
  })

  // Reclaims residue an *earlier* failure stranded, once the store works again — it removes through
  // the same removeItem, so it can never reclaim anything while removals are still failing (that is
  // strandedProbeKey's job, below). Only demonstrably stale keys go: a fresh sibling may be another
  // tab's probe in flight, and deleting it mid-probe fails that tab's read-back, the exact
  // memory-only downgrade per-call keys exist to prevent. The timestamp rides the key, so staleness
  // needs no value read.
  it('sweeps stale probe residue left by earlier failed removals', () => {
    localStorage.setItem('__pug___probe_0_stranded__', '1') // stamp 0 — decades stale
    localStorage.setItem('__pug___probe__', '1') // the pre-timestamp fixed key: no stamp, stale
    expect(isStorageAvailable()).toBe(true)
    expect(localStorage.getItem('__pug___probe_0_stranded__')).toBeNull()
    expect(localStorage.getItem('__pug___probe__')).toBeNull()
  })

  // A fresh key per probe would strand a new one per call on a store whose removeItem never lands
  // (~2-3 per init(), accumulating across every visit, outside the retention envelope and every
  // teardown) — and the sweep above cannot reclaim them, because it removes through that same
  // failing removeItem. Reusing the key this tab already stranded is what actually bounds it: one
  // key, overwritten in place, as main's fixed key did by accident.
  it('strands at most one probe key when removals never land', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})
    for (let i = 0; i < 6; i++) {
      expect(isStorageAvailable()).toBe(true)
    }
    // Storage's own API, not Object.keys — jsdom's Storage does not expose its keys as own
    // enumerable properties, so Object.keys() comes back empty and the assertion passes vacuously.
    const stranded = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k =>
      k?.startsWith('__pug___probe_'),
    )
    expect(stranded).toHaveLength(1)
  })

  // The cost of reusing a key: residue now sits where this run writes, so a constant probe value
  // would read back as this run's own write and report a no-opping setItem as available — the exact
  // fault the read-back exists to catch. A fresh token per call keeps the two distinguishable.
  it('is not fooled by its own stranded residue when setItem later no-ops', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})
    expect(isStorageAvailable()).toBe(true) // strands a key holding this run's token
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {})
    expect(isStorageAvailable()).toBe(false)
  })

  it('leaves a fresh concurrent probe key from another tab alone', () => {
    const rival = `__pug___probe_${Date.now().toString(36)}_rival__`
    localStorage.setItem(rival, '1')
    expect(isStorageAvailable()).toBe(true)
    expect(localStorage.getItem(rival)).toBe('1')
    localStorage.removeItem(rival)
  })

  // Every removeItem fixture above is a silent no-op; none throws. That one omission left the whole
  // throwing-removal half of this function untested — the catch that strands the key, and the
  // separate try around the sweep.
  it('strands at most one probe key when removals throw rather than no-op', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('proxied Storage')
    })
    for (let i = 0; i < 4; i++) {
      expect(isStorageAvailable()).toBe(true)
    }
    // The catch's `strandedProbeKey = key`: without it each call mints and abandons a fresh key,
    // accumulating across every visit outside the retention envelope and every teardown.
    expect(probeKeys()).toHaveLength(1)
  })

  it('still sweeps reclaimable residue when its own removal throws', () => {
    // The sweep sits in its own try deliberately: sharing the removal's meant a throwing removeItem
    // skipped the sweep entirely — in exactly the failure mode that strands keys for it to reclaim.
    // Only this probe's own removal throws here, so the sweep's removals can still land.
    const realRemove = localStorage.removeItem.bind(localStorage)
    localStorage.setItem(`${PROBE_PREFIX}0_reclaimable__`, '1') // stamp 0 — decades stale
    vi.spyOn(localStorage, 'removeItem').mockImplementation((k: string) => {
      if (k.includes('_reclaimable__')) {
        return realRemove(k)
      }
      throw new Error('proxied Storage')
    })

    expect(isStorageAvailable()).toBe(true)

    expect(localStorage.getItem(`${PROBE_PREFIX}0_reclaimable__`)).toBeNull()
  })

  it('returns to a fresh key once a removal lands again', () => {
    // The release half of the reuse: "cleared by the first removal that lands, so a store that
    // recovers returns to per-call keys". Pinning it stops the reuse quietly becoming permanent,
    // which would put every later probe back on one shared key — the fixed-key fault the per-call
    // key exists to close.
    const realRemove = localStorage.removeItem.bind(localStorage)
    const setSpy = vi.spyOn(localStorage, 'setItem')
    const rmSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {})

    isStorageAvailable()
    isStorageAvailable()
    const stranded = setSpy.mock.calls[0]?.[0]
    expect(setSpy.mock.calls[1]?.[0]).toBe(stranded) // reused while removals do not land

    // Heal by swapping the implementation, not mockRestore(): restore does not reliably re-attach
    // over jsdom's Storage proxy, as persistence.test.ts documents.
    rmSpy.mockImplementation((k: string) => realRemove(k))
    isStorageAvailable() // this removal lands and releases the reuse
    isStorageAvailable()

    expect(setSpy.mock.calls[3]?.[0]).not.toBe(stranded)
  })

  it('sweeps a probe key just past the staleness window but not one just inside it', () => {
    // The constant guards a real concurrency hazard — a fresh sibling may be another tab's probe in
    // flight, and deleting it mid-probe fails that tab's read-back. Both existing cases sit at the
    // extremes (stamp 0, i.e. decades stale, and Date.now(), i.e. 0ms), so widening PROBE_STALE_MS
    // by a thousandfold changed nothing anywhere.
    vi.useFakeTimers()
    try {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)
      const inside = `${PROBE_PREFIX}${(now - 4_999).toString(36)}_sibling__`
      const outside = `${PROBE_PREFIX}${(now - 5_001).toString(36)}_abandoned__`
      localStorage.setItem(inside, '1')
      localStorage.setItem(outside, '1')

      expect(isStorageAvailable()).toBe(true)

      expect(localStorage.getItem(inside)).toBe('1')
      expect(localStorage.getItem(outside)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // The other fixed-key fault ran in the opposite direction: two tabs probing at once clobbered each
  // other's value on the shared key and both reported a working store unavailable — memory-only
  // persistence for both page loads. The rival write below lands where a fixed-key probe would read.
  it('is not failed by a concurrent probe from another tab', () => {
    const realSet = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      realSet(k, v)
      realSet('__pug___probe__', 'other-tab-nonce')
    })
    expect(isStorageAvailable()).toBe(true)
    localStorage.removeItem('__pug___probe__')
  })
})

describe('isAutomatedBrowser', () => {
  // Chrome still ships this token in new headless, so the server already catches it; see the note.
  const HEADLESS_UA = 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/151.0.0.0 Safari/537.36'
  const restore: (() => void)[] = []

  const stub = (prop: string, descriptor: PropertyDescriptor) => {
    const previous = Object.getOwnPropertyDescriptor(navigator, prop)
    Object.defineProperty(navigator, prop, { configurable: true, ...descriptor })
    restore.push(() => {
      if (previous) {
        Object.defineProperty(navigator, prop, previous)
      } else {
        Reflect.deleteProperty(navigator, prop)
      }
    })
  }

  afterEach(() => {
    while (restore.length > 0) {
      restore.pop()?.()
    }
  })

  it('reads an ordinary browser as a real visitor', () => {
    expect(isAutomatedBrowser()).toBe(false)
  })

  it('catches a WebDriver-driven browser', () => {
    stub('webdriver', { value: true })

    expect(isAutomatedBrowser()).toBe(true)
  })

  it('catches the headless user agent', () => {
    stub('userAgent', { value: HEADLESS_UA })

    expect(isAutomatedBrowser()).toBe(true)
  })

  // The UA is the last branch, so it is only reached once the brand list has declined to answer.
  it('catches a headless user agent behind an ordinary brand list', () => {
    stub('userAgentData', { value: { brands: [{ brand: 'Chromium', version: '151' }] } })
    stub('userAgent', { value: HEADLESS_UA })

    expect(isAutomatedBrowser()).toBe(true)
  })

  // They disagree: chrome-headless-shell carries the brand, full Chrome headless does not.
  it('catches a headless brand behind an ordinary user agent', () => {
    stub('userAgentData', { value: { brands: [{ brand: 'HeadlessChrome', version: '120' }] } })

    expect(isAutomatedBrowser()).toBe(true)
  })

  // Each signal is probed separately, so one unreadable source must not decide for the other two.
  it('falls through a throwing webdriver to the user agent', () => {
    stub('webdriver', {
      get: () => {
        throw new Error('blocked')
      },
    })
    stub('userAgent', { value: HEADLESS_UA })

    expect(isAutomatedBrowser()).toBe(true)
  })

  // `brand` is typed string but page-controlled; a missing one must not take the UA check with it.
  it('falls through a malformed brand entry to the user agent', () => {
    stub('userAgentData', { value: { brands: [{ version: '151' }] } })
    stub('userAgent', { value: HEADLESS_UA })

    expect(isAutomatedBrowser()).toBe(true)
  })

  // Fails open: a privacy extension shadowing navigator must not silence a real visitor.
  it('reads a throwing navigator as a real visitor', () => {
    stub('webdriver', {
      get: () => {
        throw new Error('blocked')
      },
    })

    expect(isAutomatedBrowser()).toBe(false)
  })
})
