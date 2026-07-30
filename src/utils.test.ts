import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureUrlRedaction,
  decodeStored,
  encodeStored,
  getSafeElementText,
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Instance spies, not Storage.prototype: in this jsdom environment a prototype-level spy never
  // fires, so every assertion below would pass unconditionally.
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

  // A fixed sentinel let residue from an earlier failed probe read back as this run's own write, so
  // a store that no-ops setItem reported available — the exact fault the read-back exists to catch.
  it('is not fooled by a stale probe value left on the device', () => {
    localStorage.setItem('__pug___probe__', '1')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {})
    expect(isStorageAvailable()).toBe(false)
    localStorage.removeItem('__pug___probe__')
  })
})
