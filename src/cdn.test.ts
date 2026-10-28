import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PugStub } from './cdn-install.js'
import { SDK_VERSION } from './version.js'

const logSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('./logger.js', () => ({
  log: logSpies,
  setDebugLogging: vi.fn(),
}))

// The entry runs at import time, so every test gets a fresh module registry and a clean global.
// The callable view is derived from the module's own stub contract so the two cannot drift.
type PugGlobal = PugStub & Record<string, (...args: unknown[]) => unknown>
const pugGlobal = (): PugGlobal | undefined => (window as unknown as { pug?: PugGlobal }).pug
const setPugGlobal = (value: unknown): void => {
  ;(window as unknown as { pug?: unknown }).pug = value
}

const importEntry = async () => import('./cdn.js')

// The entry reads currentScript from the prototype, never off document, so stub it there. The extra link
// mirrors browsers, where HTMLDocument.prototype sits between document and the getter; jsdom has none.
const stubCurrentScript = (script: HTMLScriptElement): void => {
  vi.spyOn(Document.prototype, 'currentScript', 'get').mockReturnValue(script)
  Object.setPrototypeOf(document, Object.create(Document.prototype))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  setPugGlobal(undefined)
  localStorage.clear()
})

afterEach(() => {
  pugGlobal()?.destroy?.()
  setPugGlobal(undefined)
  vi.restoreAllMocks()
  Object.setPrototypeOf(document, Document.prototype)
  document.body.replaceChildren()
})

describe('cdn entry', () => {
  it('installs the full API on window.pug for a bare script load', async () => {
    await importEntry()

    const pug = pugGlobal()
    if (!pug) throw new Error('window.pug not installed')
    expect(pug.__loaded).toBe(SDK_VERSION)
    expect(pug.version).toBe(SDK_VERSION)
    for (const method of ['init', 'track', 'identify', 'optInTracking', 'optOutTracking', 'ready', 'destroy']) {
      expect(typeof pug[method], method).toBe('function')
    }
  })

  it('replays the queued snippet calls and supports runtime consent flipping', async () => {
    const readySpy = vi.fn()
    setPugGlobal({
      _q: [
        ['init', ['demo-project', { apiKey: 'demo-key', dryRun: true, trackingConsent: 'denied' }]],
        ['ready', [readySpy]],
      ],
      _v: 1,
    })

    await importEntry()

    const pug = pugGlobal()
    if (!pug) throw new Error('window.pug not installed')
    expect(pug._q).toHaveLength(0)
    expect(readySpy).toHaveBeenCalledTimes(1)
    expect(pug.isTrackingEnabled()).toBe(false) // queued init seeded consent denied

    pug.optInTracking()
    expect(pug.isTrackingEnabled()).toBe(true)

    pug.optOutTracking()
    expect(pug.isTrackingEnabled()).toBe(false)
  })

  it('isolates a throwing queued init and still replays the rest', async () => {
    const readySpy = vi.fn()
    setPugGlobal({
      _q: [
        ['init', ['', { apiKey: 'demo-key' }]], // throws: projectId is required
        ['ready', [readySpy]],
      ],
      _v: 1,
    })

    await importEntry()

    expect(logSpies.error).toHaveBeenCalledWith(expect.stringContaining('Queued init() call failed'), expect.any(Error))
    expect(readySpy).toHaveBeenCalledTimes(1)
  })

  it('warns once about calls queued before init', async () => {
    setPugGlobal({
      _q: [
        ['track', ['too-early']],
        ['identify', ['too-early@example.com']],
        ['init', ['demo-project', { apiKey: 'demo-key', dryRun: true }]],
      ],
      _v: 1,
    })

    await importEntry()

    const aggregate = logSpies.warn.mock.calls.filter(call => String(call[0]).includes('queued before pug.init()'))
    expect(aggregate).toHaveLength(1) // one aggregate warning, not one per dropped call
  })

  it('never throws from ready() after load', async () => {
    await importEntry()

    const pug = pugGlobal()
    if (!pug) throw new Error('window.pug not installed')
    expect(() => pug.ready(123)).not.toThrow()
    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('ready() expects a function'))
    expect(() =>
      pug.ready(() => {
        throw new Error('cb boom')
      }),
    ).not.toThrow()
    expect(logSpies.error).toHaveBeenCalledWith('ready() callback failed:', expect.any(Error))
  })

  it('ignores a duplicate script load and keeps the first instance', async () => {
    await importEntry()
    const firstInit = pugGlobal()?.init

    vi.resetModules()
    await importEntry()

    expect(logSpies.warn).toHaveBeenCalledWith(expect.stringContaining('already loaded'))
    expect(pugGlobal()?.init).toBe(firstInit)
  })

  it('auto-inits from script data attributes for the one-tag install', async () => {
    const script = document.createElement('script')
    script.setAttribute('data-project-id', 'demo-project')
    script.setAttribute('data-api-key', 'demo-key')
    script.setAttribute('data-options', '{"dryRun":true}')
    stubCurrentScript(script)

    await importEntry()

    const pug = pugGlobal()
    if (!pug) throw new Error('window.pug not installed')
    expect(pug.isTrackingEnabled()).toBe(true) // true only after init(); the 'cookieless' default tracks
  })

  it('seeds consent denied from a one-tag data-options trackingConsent', async () => {
    const script = document.createElement('script')
    script.setAttribute('data-project-id', 'demo-project')
    script.setAttribute('data-api-key', 'demo-key')
    script.setAttribute('data-options', '{"dryRun":true,"trackingConsent":{"initial":"denied"}}')
    stubCurrentScript(script)

    await importEntry()

    const pug = pugGlobal()
    if (!pug) throw new Error('window.pug not installed')
    expect(pug.getTrackingConsent()).toBe('denied') // undefined had auto-init not run
    // A wrong key fails closed to 'denied' too, so prove this one was honored.
    expect(logSpies.warn).not.toHaveBeenCalledWith(expect.stringMatching(/failing closed/i))
  })

  it('fails closed when a one-tag data-options trackingConsent is malformed', async () => {
    const script = document.createElement('script')
    script.setAttribute('data-project-id', 'demo-project')
    script.setAttribute('data-api-key', 'demo-key')
    // A mangled server-side interpolation renders a bare array/primitive where a consent object or
    // string was intended. It must never silently fall back to tracking enabled.
    script.setAttribute('data-options', '{"dryRun":true,"trackingConsent":["denied"]}')
    stubCurrentScript(script)

    await importEntry()

    const pug = pugGlobal()
    if (!pug) throw new Error('window.pug not installed')
    expect(pug.getTrackingConsent()).toBe('denied') // out-of-domain consent config → fail closed
  })

  it('runs auto-init before replaying queued calls, so they land after init', async () => {
    const script = document.createElement('script')
    script.setAttribute('data-project-id', 'demo-project')
    script.setAttribute('data-api-key', 'demo-key')
    script.setAttribute('data-options', '{"dryRun":true}')
    stubCurrentScript(script)
    setPugGlobal({ _q: [['track', ['queued-before-load']]], _v: 1 })

    await importEntry()

    // The queued track executed against an initialized SDK (the 'cookieless' default → debug log), was not
    // dropped as a before-init call, and triggered no aggregate warning.
    expect(logSpies.debug).toHaveBeenCalledWith(expect.stringContaining('track("queued-before-load")'))
    expect(logSpies.warn).not.toHaveBeenCalledWith(expect.stringContaining('track() called before init()'))
    expect(logSpies.warn).not.toHaveBeenCalledWith(expect.stringContaining('queued before pug.init()'))
  })

  it('lets a queued init win over data attributes', async () => {
    const script = document.createElement('script')
    script.setAttribute('data-project-id', 'attr-project')
    script.setAttribute('data-api-key', 'attr-key') // alone these would seed 'cookieless'
    stubCurrentScript(script)
    setPugGlobal({
      _q: [['init', ['queued-project', { apiKey: 'queued-key', dryRun: true, trackingConsent: 'denied' }]]],
      _v: 1,
    })

    await importEntry()

    // Consent denied proves the queued init ran and the data attributes were ignored.
    expect(pugGlobal()?.getTrackingConsent()).toBe('denied')
  })

  it('still replays the queue when the currentScript getter throws, as on a sandboxed Proxy document', async () => {
    vi.spyOn(Document.prototype, 'currentScript', 'get').mockImplementation(() => {
      throw new TypeError('Illegal invocation')
    })
    const readySpy = vi.fn()
    setPugGlobal({ _q: [['ready', [readySpy]]], _v: 1 })

    await importEntry()

    expect(readySpy).toHaveBeenCalledTimes(1)
  })

  describe('with markup shadowing document.currentScript', () => {
    beforeEach(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<img name="currentScript" data-project-id="attacker" data-api-key="attacker-key"
          data-endpoint="https://attacker.example" data-options='{"dryRun":true,"trackingConsent":"granted"}'>`,
      )
      expect(document.currentScript).toBeInstanceOf(HTMLImageElement)
    })

    it('auto-inits from the real script tag', async () => {
      const script = document.createElement('script')
      script.setAttribute('data-project-id', 'demo-project')
      script.setAttribute('data-api-key', 'demo-key')
      script.setAttribute('data-options', '{"dryRun":true,"trackingConsent":"denied"}')
      stubCurrentScript(script)

      await importEntry()

      expect(pugGlobal()?.getTrackingConsent()).toBe('denied')
    })

    it('never auto-inits from the markup itself', async () => {
      await importEntry()

      const pug = pugGlobal()
      if (!pug) throw new Error('window.pug not installed')
      expect(pug.getTrackingConsent()).toBeUndefined()
    })
  })
})
