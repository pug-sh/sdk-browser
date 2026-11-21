import { create } from '@bufbuild/protobuf'
import { DurationSchema, durationFromMs, timestampFromMs } from '@bufbuild/protobuf/wkt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureBeforeSend, toEvent } from './track.js'

const PROJECT_ID = 'test-project'
const SESSION_ID = '01234567-0123-7123-8123-012345678901'
const DISTINCT_ID = 'anon-01234567-0123-7123-8123-012345678901'
const ID = { sessionId: SESSION_ID, distinctId: DISTINCT_ID }

let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Well-known event names are a compile-time typing affordance only — there is no runtime
// schema, so a well-known name serializes through the exact same JS heuristic as a custom
// event. These tests lock in that runtime behavior (esp. int-vs-double, which the backend
// coalesces — see docs/ and the sdk-web bundle-size work).
describe('well-known event names (runtime heuristic, no schema)', () => {
  it('serializes an integer on a well-known numeric field as intValue (schema no longer forces double)', () => {
    const ev = toEvent(
      PROJECT_ID,
      'purchase',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      {
        productId: 'sku-1',
        amount: 5,
        currency: 'USD',
      },
    )
    expect(ev).not.toBeNull()
    // 5 is a safe integer → intValue. The backend reads Int64 and Float64 slots together.
    expect(ev!.customProperties.amount?.value.case).toBe('intValue')
    expect(ev!.customProperties.amount?.value.value).toBe(5n)
    expect(ev!.customProperties.productId?.value.case).toBe('stringValue')
    expect(ev!.customProperties.currency?.value.case).toBe('stringValue')
  })

  it('serializes a fractional value on the same field as doubleValue', () => {
    const ev = toEvent(
      PROJECT_ID,
      'purchase',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      {
        productId: 'sku-1',
        amount: 5.5,
        currency: 'USD',
      },
    )
    expect(ev!.customProperties.amount?.value.case).toBe('doubleValue')
    expect(ev!.customProperties.amount?.value.value).toBe(5.5)
  })

  it('includes an explicitly passed 0 and maps only the keys the caller provided', () => {
    const ev = toEvent(
      PROJECT_ID,
      'scroll',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { percent: 0, scrollY: 250 },
    )
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.percent?.value.case).toBe('intValue')
    expect(ev!.customProperties.percent?.value.value).toBe(0n)
    expect(ev!.customProperties.scrollY?.value.value).toBe(250n)
  })

  it('does not fabricate unset fields', () => {
    const ev = toEvent(PROJECT_ID, 'click', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, { tag: 'button' })
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.tag?.value.case).toBe('stringValue')
    expect(ev!.customProperties.id).toBeUndefined()
    expect(ev!.customProperties.text).toBeUndefined()
    expect(ev!.customProperties.x).toBeUndefined()
    expect(ev!.customProperties.y).toBeUndefined()
  })

  it('builds the event even when a value would violate a server-side constraint (server is the authority)', () => {
    const ev = toEvent(
      PROJECT_ID,
      'purchase',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      {
        productId: 'sku',
        amount: -1, // would violate double.gt = 0 server-side
        currency: 'USD',
      },
    )
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.amount?.value.case).toBe('intValue')
    expect(ev!.customProperties.amount?.value.value).toBe(-1n)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('serializes every provided prop — a well-known name gets no special-casing', () => {
    const ev = toEvent(
      PROJECT_ID,
      'click',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { tag: 'button', extraNote: 'hello' },
    )
    expect(ev!.customProperties.tag?.value.case).toBe('stringValue')
    expect(ev!.customProperties.extraNote?.value.case).toBe('stringValue')
    expect(ev!.customProperties.extraNote?.value.value).toBe('hello')
  })

  it('warns per key on function/symbol values and silently drops undefined', () => {
    const ev = toEvent(
      PROJECT_ID,
      'click',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      {
        tag: 'button',
        cb: () => {},
        sym: Symbol('x'),
        gone: undefined,
      },
    )
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.tag?.value.case).toBe('stringValue')
    expect(ev!.customProperties.cb).toBeUndefined()
    expect(ev!.customProperties.sym).toBeUndefined()
    expect(ev!.customProperties.gone).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"cb" on event "click" not representable (function)'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"sym" on event "click" not representable (symbol)'))
    // `gone: undefined` is dropped silently (common + unactionable), same as custom events.
  })
})

describe('JS heuristic (custom events)', () => {
  it('maps bigint to intValue', () => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { id: 9007199254740993n },
    )
    expect(ev!.customProperties.id?.value.case).toBe('intValue')
    expect(ev!.customProperties.id?.value.value).toBe(9007199254740993n)
  })

  it('maps Date to timestampValue', () => {
    const d = new Date('2026-01-15T10:30:00.000Z')
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, { ts: d })
    expect(ev!.customProperties.ts?.value.case).toBe('timestampValue')
  })

  it.each([NaN, Infinity, -Infinity])('drops non-finite number %p, keeps event, warns', n => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { weird: n, ok: 'kept' },
    )
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.weird).toBeUndefined()
    expect(ev!.customProperties.ok?.value.case).toBe('stringValue')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"weird" on event "my_event" not representable'))
  })

  it('drops Date(NaN) without dropping the event', () => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { ts: new Date(NaN), ok: 'kept' },
    )
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.ts).toBeUndefined()
    expect(ev!.customProperties.ok).toBeDefined()
  })

  it('JSON-stringifies a plain object as stringValue', () => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { meta: { a: 1, b: 'x' } },
    )
    expect(ev!.customProperties.meta?.value.case).toBe('stringValue')
    expect(ev!.customProperties.meta?.value.value).toBe('{"a":1,"b":"x"}')
  })

  it('drops circular structures, keeps event', () => {
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, { cyc, ok: 'kept' })
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.cyc).toBeUndefined()
    expect(ev!.customProperties.ok).toBeDefined()
  })

  it('drops object whose toJSON returns undefined', () => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      {
        weird: { toJSON: () => undefined },
        ok: 'kept',
      },
    )
    expect(ev!.customProperties.weird).toBeUndefined()
    expect(ev!.customProperties.ok).toBeDefined()
  })

  it('silently drops null and undefined (no warn)', () => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { a: null, b: undefined, ok: 'kept' },
    )
    expect(ev!.customProperties.a).toBeUndefined()
    expect(ev!.customProperties.b).toBeUndefined()
    expect(ev!.customProperties.ok).toBeDefined()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('drops function and symbol values with per-key warn, keeps event', () => {
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      {
        fn: () => {},
        sym: Symbol(),
        ok: 'kept',
      },
    )
    expect(ev).not.toBeNull()
    expect(ev!.customProperties.fn).toBeUndefined()
    expect(ev!.customProperties.sym).toBeUndefined()
    expect(ev!.customProperties.ok).toBeDefined()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"fn" on event "my_event" not representable (function)'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"sym" on event "my_event" not representable (symbol)'),
    )
  })

  it('writes a bigint inside an object as a string, every digit kept', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', ID, { meta: { id: 9007199254740993n } })
    expect(ev!.customProperties.meta?.value).toEqual({ case: 'stringValue', value: '{"id":"9007199254740993"}' })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('string truncation (UTF-8 bytes, not codepoints)', () => {
  it('truncates ASCII strings exceeding 1024 bytes', () => {
    const long = 'a'.repeat(2000)
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, { notes: long })
    const v = ev!.customProperties.notes?.value as { value: string }
    expect(v.value).toHaveLength(1024)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds 1024 bytes, truncating'))
  })

  it('truncates emoji string at a UTF-8 sequence boundary (no broken surrogate)', () => {
    // '😀' is 4 UTF-8 bytes, 2 UTF-16 units. 257 × 4 = 1028 bytes, exceeds cap.
    // Truncation should produce 256 complete emoji = 1024 bytes.
    const ev = toEvent(
      PROJECT_ID,
      'my_event',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { e: '😀'.repeat(257) },
    )
    const v = ev!.customProperties.e?.value as { value: string }
    expect(new TextEncoder().encode(v.value).byteLength).toBeLessThanOrEqual(1024)
    // Each emoji is exactly 2 UTF-16 units; if truncation split a surrogate pair, length would be odd.
    expect(v.value.length % 2).toBe(0)
  })

  it('does not truncate multi-byte strings under the cap', () => {
    const s = '€'.repeat(300) // 3 UTF-8 bytes each = 900 bytes
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, { e: s })
    const v = ev!.customProperties.e?.value as { value: string }
    expect(v.value).toBe(s)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('truncates schema-driven string fields too (not just custom)', () => {
    // search.query passes through scalarToPropertyValue → makeStringValue, so the well-known
    // path should also truncate (this was the C2 bug being fixed).
    const ev = toEvent(
      PROJECT_ID,
      'search',
      { sessionId: SESSION_ID, distinctId: DISTINCT_ID },
      { query: 'a'.repeat(2000) },
    )
    const v = ev!.customProperties.query?.value as { value: string }
    expect(v.value).toHaveLength(1024)
  })
})

describe('opts.timestamp', () => {
  it('uses opts.timestamp for occurTime when finite', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, undefined, {
      timestamp: 1700000000000,
    })
    expect(Number(ev!.occurTime!.seconds)).toBe(1700000000)
  })

  it('falls back to current time when opts.timestamp is NaN', () => {
    const before = Date.now()
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, undefined, {
      timestamp: NaN,
    })
    const after = Date.now()
    const ms = Number(ev!.occurTime!.seconds) * 1000
    expect(ms).toBeGreaterThanOrEqual(before - 1000)
    expect(ms).toBeLessThanOrEqual(after + 1000)
  })
})

describe('Event proto integrity', () => {
  it('generates a uuidv7 eventId', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
    expect(ev!.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates a fresh eventId each call', () => {
    const a = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
    const b = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
    expect(a!.eventId).not.toBe(b!.eventId)
  })

  it('includes auto-properties with $-prefixed keys', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
    expect(ev!.autoProperties.$projectId.value.value).toBe(PROJECT_ID)
    expect(ev!.autoProperties.$sdkVersion).toBeTruthy()
  })

  // Both directions pinned — asserting only the omission would pass if $pageTitle were dropped
  // entirely.
  describe('$pageTitle is page-view only', () => {
    beforeEach(() => {
      document.title = 'Invoice #4417 — Dana Okonkwo'
    })

    it('sends $pageTitle on page_view', () => {
      const ev = toEvent(PROJECT_ID, 'page_view', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
      expect(ev!.autoProperties.$pageTitle?.value.value).toBe('Invoice #4417 — Dana Okonkwo')
    })

    // Every kind an automatic tracker emits, plus a custom one.
    it.each(['click', 'scroll', 'form_start', 'form_submit', 'rage_click', 'dead_click', 'my_event'])(
      'omits $pageTitle on %s',
      kind => {
        const ev = toEvent(PROJECT_ID, kind, { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
        expect(ev!.autoProperties.$pageTitle).toBeUndefined()
      },
    )

    // The conditional spread must not swallow its siblings.
    it('still sends the other auto-properties on a non-page_view event', () => {
      const ev = toEvent(PROJECT_ID, 'click', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
      expect(ev!.autoProperties.$projectId.value.value).toBe(PROJECT_ID)
      expect(ev!.autoProperties.$platform.value.value).toBe('web')
      expect(ev!.autoProperties.$sdkVersion).toBeTruthy()
    })
  })

  // The redaction itself is covered in utils.test.ts; this pins that $url actually goes through it,
  // and that beforeSend sees the already-redacted value rather than being the only line of defence.
  describe('URL redaction', () => {
    const RESET_LINK = 'https://app.example.com/reset?token=s3cr3t&plan=pro'

    beforeEach(() => {
      window.history.replaceState({}, '', '/reset?token=s3cr3t&plan=pro')
    })

    afterEach(() => {
      window.history.replaceState({}, '', '/')
      configureBeforeSend(undefined)
    })

    it('redacts sensitive params from $url', () => {
      const ev = toEvent(PROJECT_ID, 'page_view', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
      const url = ev!.autoProperties.$url.value.value as string
      expect(url).toContain('token=redacted')
      expect(url).toContain('plan=pro')
    })

    it('redacts sensitive params from $referrer', () => {
      // The riskier of the two: the referrer carries the *previous* page's URL, so a visitor
      // arriving from their own magic-link page hands over that token — and unlike $url nobody
      // ever sees it in an address bar to notice.
      vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://mail.example.com/open?token=s3cr3t&id=9')
      const ev = toEvent(PROJECT_ID, 'page_view', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
      const referrer = ev!.autoProperties.$referrer.value.value as string
      expect(referrer).toContain('token=redacted')
      expect(referrer).toContain('id=9')
      expect(referrer).not.toContain('s3cr3t')
    })

    it('hands beforeSend the redacted value', () => {
      let seen = ''
      configureBeforeSend(e => {
        seen = e.autoProperties.$url
      })
      toEvent(PROJECT_ID, 'page_view', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
      expect(seen).not.toContain('s3cr3t')
      expect(RESET_LINK).toContain('s3cr3t') // the raw link really did carry it
    })
  })

  // The backend promotes $platform into a dedicated events column and never derives it from the UA
  // header, so an omitted or non-"web" value silently empties every platform breakdown/filter.
  it('sets $platform to "web"', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID })
    expect(ev!.autoProperties.$platform.value.value).toBe('web')
  })

  it('sets sessionId and distinctId as top-level Event fields, not as customProperties', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', { sessionId: SESSION_ID, distinctId: DISTINCT_ID }, { x: 1 })
    expect(ev!.sessionId).toBe(SESSION_ID)
    expect(ev!.distinctId).toBe(DISTINCT_ID)
    expect(ev!.customProperties.sessionId).toBeUndefined()
    expect(ev!.customProperties.distinctId).toBeUndefined()
  })
})

describe('toEvent cookieless identity', () => {
  it('builds an identity-free event with the cookieless flag set', () => {
    const event = toEvent(PROJECT_ID, 'page_view', { cookieless: true })
    expect(event).not.toBeNull()
    expect(event?.cookieless).toBe(true)
    expect(event?.distinctId).toBe('')
    expect(event?.sessionId).toBe('')
  })

  it('builds a consented event exactly as before via the identity object', () => {
    const event = toEvent(PROJECT_ID, 'click', { sessionId: 's-1', distinctId: 'anon-1' })
    expect(event?.cookieless).toBe(false)
    expect(event?.sessionId).toBe('s-1')
    expect(event?.distinctId).toBe('anon-1')
  })
})

describe('beforeSend', () => {
  const str = (pv: { value: { value: unknown } } | undefined) => pv?.value.value

  afterEach(() => {
    configureBeforeSend(undefined)
  })

  it('is a no-op when unconfigured', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', ID, { a: 1 })
    expect(str(ev!.customProperties.a)).toBe(1n)
    expect(str(ev!.autoProperties.$projectId)).toBe(PROJECT_ID)
  })

  it('rewrites an auto-property', () => {
    document.title = 'Invoice #4417 — Dana Okonkwo'
    configureBeforeSend(e => {
      e.autoProperties.$pageTitle = 'REDACTED'
      return e
    })
    const ev = toEvent(PROJECT_ID, 'page_view', ID)
    expect(str(ev!.autoProperties.$pageTitle)).toBe('REDACTED')
  })

  it('rewrites, adds and deletes custom properties', () => {
    configureBeforeSend(e => {
      delete e.customProperties.ssn
      e.customProperties.email = 'redacted@example.com'
      e.customProperties.tier = 'gold'
      return e
    })
    const ev = toEvent(PROJECT_ID, 'signup', ID, { ssn: '123-45-6789', email: 'dana@x.com' })
    expect(ev!.customProperties.ssn).toBeUndefined()
    expect(str(ev!.customProperties.email)).toBe('redacted@example.com')
    expect(str(ev!.customProperties.tier)).toBe('gold')
  })

  // The mutable bags invite `e => { e.x = y }` with no return; that must not read as a drop.
  it('keeps in-place mutations when the hook returns nothing', () => {
    configureBeforeSend(e => {
      e.customProperties.masked = true
    })
    const ev = toEvent(PROJECT_ID, 'my_event', ID, { a: 1 })
    expect(ev).not.toBeNull()
    expect(str(ev!.customProperties.masked)).toBe(true)
    expect(str(ev!.customProperties.a)).toBe(1n)
  })

  it('drops the event on null, at debug level (an intentional drop is not a warning)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    configureBeforeSend(e => (e.kind === 'internal_ping' ? null : e))
    expect(toEvent(PROJECT_ID, 'internal_ping', ID)).toBeNull()
    expect(toEvent(PROJECT_ID, 'my_event', ID)).not.toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
    debugSpy.mockRestore()
  })

  // The bag the hook receives must be the one we send from. Rebuilding it from the arguments meant
  // a hook that replaced a bag and returned nothing had its redaction dropped and the raw original
  // sent — the one failure direction a privacy hook must never have.
  it('honors a replaced bag when the hook returns nothing', () => {
    configureBeforeSend(e => {
      ;(e as { autoProperties: Record<string, string> }).autoProperties = {
        ...e.autoProperties,
        $url: 'REDACTED',
      }
      ;(e as { customProperties: Record<string, unknown> }).customProperties = {}
    })
    const ev = toEvent(PROJECT_ID, 'my_event', ID, { ssn: '123-45-6789' })
    expect(str(ev!.autoProperties.$url)).toBe('REDACTED')
    expect(ev!.customProperties.ssn).toBeUndefined()
  })

  it('cannot reroute the event: kind is readonly and re-reading it after mutation is unsupported', () => {
    configureBeforeSend(e => {
      ;(e as { kind: string }).kind = 'spoofed'
      return e
    })
    const ev = toEvent(PROJECT_ID, 'my_event', ID)
    expect(ev!.kind).toBe('my_event')
  })

  describe('protected auto-properties survive the hook', () => {
    it.each(['$projectId', '$platform', '$sdkVersion'])('re-asserts %s after a hook deletes it', key => {
      configureBeforeSend(e => {
        delete e.autoProperties[key]
        return e
      })
      const ev = toEvent(PROJECT_ID, 'my_event', ID)
      expect(ev!.autoProperties[key]).toBeDefined()
    })

    it('re-asserts them after a hook overwrites them', () => {
      configureBeforeSend(e => {
        e.autoProperties.$projectId = 'other-project'
        e.autoProperties.$platform = 'ios'
        return e
      })
      const ev = toEvent(PROJECT_ID, 'my_event', ID)
      expect(str(ev!.autoProperties.$projectId)).toBe(PROJECT_ID)
      expect(str(ev!.autoProperties.$platform)).toBe('web')
    })

    it('survives a hook returning a wholly empty event', () => {
      configureBeforeSend(() => ({ kind: 'my_event', autoProperties: {}, customProperties: {} }))
      const ev = toEvent(PROJECT_ID, 'my_event', ID, { a: 1 })
      expect(str(ev!.autoProperties.$projectId)).toBe(PROJECT_ID)
      expect(str(ev!.autoProperties.$sdkVersion)).toBeTruthy()
      expect(ev!.customProperties.a).toBeUndefined()
    })
  })

  describe('fails closed', () => {
    it('drops the event when the hook throws, without leaking the error message', () => {
      configureBeforeSend(() => {
        throw new Error('dana@example.com was being redacted')
      })
      expect(toEvent(PROJECT_ID, 'my_event', ID)).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('beforeSend threw'), 'Error')
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('dana@example.com'), expect.anything())
    })

    it.each([42, 'nope', [] as unknown, { autoProperties: {} }])('drops the event on malformed return %p', bad => {
      configureBeforeSend(() => bad as never)
      expect(toEvent(PROJECT_ID, 'my_event', ID)).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed event'))
    })

    // These pass a `typeof v === 'object'` check but yield nothing from Object.entries, so a laxer
    // guard sent a hollowed-out event — every property gone — with no warning at all.
    it.each([
      ['array bags', { autoProperties: [], customProperties: [] }],
      ['Map bags', { autoProperties: new Map([['$url', 'x']]), customProperties: new Map() }],
    ])('drops the event when the hook returns %s', (_label, bad) => {
      configureBeforeSend(() => bad as never)
      expect(toEvent(PROJECT_ID, 'my_event', ID)).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed event'))
    })

    it('drops every event when configured with a non-function', () => {
      configureBeforeSend('not a function' as never)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('beforeSend must be a function'))
      expect(toEvent(PROJECT_ID, 'my_event', ID)).toBeNull()
    })

    it('warns once per configure, not once per event', () => {
      configureBeforeSend(() => {
        throw new Error('boom')
      })
      toEvent(PROJECT_ID, 'my_event', ID)
      toEvent(PROJECT_ID, 'my_event', ID)
      toEvent(PROJECT_ID, 'my_event', ID)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    // Separate flags: sharing one meant a throw at page load silenced every later malformed return
    // for the life of the page, and vice versa.
    it('warns for a malformed return even after a throw already warned', () => {
      let mode: 'throw' | 'malformed' = 'throw'
      configureBeforeSend(() => {
        if (mode === 'throw') {
          throw new Error('boom')
        }
        return 42 as never
      })
      toEvent(PROJECT_ID, 'my_event', ID)
      mode = 'malformed'
      toEvent(PROJECT_ID, 'my_event', ID)

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('beforeSend threw'), 'Error')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed event'))
    })
  })

  // The only route to URL masking now that sanitizeUrl is gone.
  it('can mask $url and $referrer', () => {
    configureBeforeSend(e => {
      e.autoProperties.$url = (e.autoProperties.$url as string).replace(/\/orders\/\d+/, '/orders/:id')
      return e
    })
    window.history.replaceState({}, '', '/orders/12345?q=1')
    const ev = toEvent(PROJECT_ID, 'my_event', ID)
    expect(str(ev!.autoProperties.$url)).toContain('/orders/:id')
    expect(str(ev!.autoProperties.$url)).not.toContain('12345')
  })

  it('is cleared by configureBeforeSend(undefined)', () => {
    configureBeforeSend(() => null)
    expect(toEvent(PROJECT_ID, 'my_event', ID)).toBeNull()
    configureBeforeSend(undefined)
    expect(toEvent(PROJECT_ID, 'my_event', ID)).not.toBeNull()
  })
})

// The server fails a whole BatchCreate request on any of these, losing every event sent alongside.
describe('rules the server fails a whole batch on', () => {
  afterEach(() => {
    configureBeforeSend(undefined)
  })

  it.each(['Order Completed', 'signup:started', 'checkout/step', 'café', ''])(
    'drops an event whose kind is %j',
    kind => {
      expect(toEvent(PROJECT_ID, kind, ID)).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Event ${JSON.stringify(kind)} dropped`))
    },
  )

  it('keeps a kind made of letters, digits, _, . and -', () => {
    expect(toEvent(PROJECT_ID, 'Checkout.step-2_done', ID)).not.toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('drops an event whose kind is not a string, as plain JavaScript can pass', () => {
    expect(toEvent(PROJECT_ID, 42 as unknown as string, ID)).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Event 42 dropped: a kind must be a string, got number'),
    )
  })

  it('drops a custom key starting with $ and keeps the event', () => {
    const ev = toEvent(PROJECT_ID, 'signup', ID, { $plan: 'pro', ok: 'kept' })
    expect(ev!.customProperties.$plan).toBeUndefined()
    expect(ev!.customProperties.ok).toBeDefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Property "$plan" on event "signup" skipped'))
  })

  it('drops keys a beforeSend hook adds against either $ rule and keeps the event', () => {
    configureBeforeSend(e => {
      e.autoProperties.plan = 'pro'
      e.autoProperties.$locale = 'xx'
      e.customProperties.$tier = 'gold'
      e.customProperties.tier = 'gold'
    })
    const ev = toEvent(PROJECT_ID, 'signup', ID)
    expect(ev!.autoProperties.plan).toBeUndefined()
    expect(ev!.autoProperties.$locale?.value).toEqual({ case: 'stringValue', value: 'xx' })
    expect(ev!.customProperties.$tier).toBeUndefined()
    expect(ev!.customProperties.tier).toBeDefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-property "plan" on event "signup" skipped'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Property "$tier" on event "signup" skipped'))
  })

  it('skips a null or undefined $ key silently, as it would any other', () => {
    toEvent(PROJECT_ID, 'signup', ID, { $plan: null, $gone: undefined })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('Duration properties', () => {
  const sent = (position: unknown) =>
    toEvent(PROJECT_ID, 'video_pause', ID, { videoId: 'v1', position })?.customProperties.position?.value

  it.each([
    ['a { seconds, nanos } literal', { seconds: 90n, nanos: 500_000_000 }, '90.5s'],
    ['durationFromMs()', durationFromMs(90_500), '90.5s'],
    ['durationFromMs() of a fractional millisecond', durationFromMs(12.345678 * 1000), '12.345678s'],
    ['create(DurationSchema)', create(DurationSchema, { seconds: 3600n }), '3600s'],
    ['nanos alone', { nanos: 5 }, '0.000000005s'],
    ['zero', { seconds: 0n }, '0s'],
    ['number seconds, as plain JavaScript passes them', { seconds: 90, nanos: 500_000_000 }, '90.5s'],
    ['fractional seconds, such as a currentTime', { seconds: 90.534 }, '90.534s'],
    ['a negative duration', durationFromMs(-1_500), '-1.5s'],
    ['a negative fraction of a second', { nanos: -500_000_000 }, '-0.5s'],
    ['nanos past a whole second', { seconds: 1n, nanos: 1_500_000_000 }, '2.5s'],
  ])('sends %s as a seconds string', (_label, position, expected) => {
    expect(sent(position)).toEqual({ case: 'stringValue', value: expected })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  class Elapsed {
    get seconds() {
      return 30
    }
  }

  it.each([
    ['another key', { seconds: 30, label: 'timer' }, '{"seconds":30,"label":"timer"}'],
    ['a bigint seconds and another key, which type-checks', { seconds: 5n, label: 'x' }, '{"seconds":"5","label":"x"}'],
    ['a string seconds', { seconds: '30' }, '{"seconds":"30"}'],
    ['no fields', {}, '{}'],
    ['a class instance with a seconds getter', new Elapsed(), '{}'],
    [
      'the $typeName of a Timestamp',
      timestampFromMs(5_000),
      '{"$typeName":"google.protobuf.Timestamp","seconds":"5","nanos":0}',
    ],
  ])('sends an object with %s as JSON, not as a Duration', (_label, value, expected) => {
    expect(sent(value)).toEqual({ case: 'stringValue', value: expected })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('drops only an object property whose getter throws', () => {
    const ev = toEvent(PROJECT_ID, 'my_event', ID, {
      ok: 'kept',
      bag: {
        get detail() {
          throw new Error('boom')
        },
      },
    })
    expect(ev!.customProperties.ok).toBeDefined()
    expect(ev!.customProperties.bag).toBeUndefined()
  })
})
