import { afterEach, describe, expect, it } from 'vitest'
import {
  configureUrlRedaction,
  decodeStored,
  encodeStored,
  getSafeElementText,
  isCaptureSuppressed,
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

  it('passes through empty and unparseable input', () => {
    expect(scrubUrl('')).toBe('')
    expect(scrubUrl('not a url ?token=abc')).toBe('not a url ?token=abc')
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
