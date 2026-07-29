import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupFormTracking } from './form.js'

describe('setupFormTracking', () => {
  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    document.body.innerHTML = ''
  })

  const buildForm = (): { form: HTMLFormElement; input: HTMLInputElement } => {
    const form = document.createElement('form')
    form.id = 'signup'
    form.setAttribute('name', 'signup-form')
    const input = document.createElement('input')
    input.name = 'email'
    form.appendChild(input)
    document.body.appendChild(form)
    return { form, input }
  }

  it('fires form_start once on first input', () => {
    const track = vi.fn()
    cleanup = setupFormTracking(track)
    const { input } = buildForm()

    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('form_start', { formId: 'signup', formName: 'signup-form' })
  })

  it('sends an action with nothing to redact unchanged', () => {
    const track = vi.fn()
    cleanup = setupFormTracking(track)
    const { form } = buildForm()
    form.setAttribute('action', '/plain/path')

    form.dispatchEvent(new Event('submit', { bubbles: true }))

    expect(track).toHaveBeenCalledWith(
      'form_submit',
      expect.objectContaining({ action: expect.stringContaining('/plain/path'), formId: 'signup' }),
    )
  })

  it('redacts sensitive params out of the action', () => {
    // A GET password-reset or login form puts them straight in the action URL, and this is the only
    // pass that sees it before beforeSend — which a one-tag install cannot supply at all.
    const track = vi.fn()
    cleanup = setupFormTracking(track)
    const { form } = buildForm()
    form.setAttribute('action', '/reset?token=s3cr3t&plan=pro')

    form.dispatchEvent(new Event('submit', { bubbles: true }))

    const action = track.mock.calls[0]?.[1]?.action as string
    expect(action).toContain('token=redacted')
    expect(action).toContain('plan=pro')
    expect(action).not.toContain('s3cr3t')
  })

  it('sends an empty action when a control named "action" shadows the form attribute', () => {
    // In browsers a control named "action" shadows the IDL attribute (HTMLFormElement is
    // [LegacyOverrideBuiltIns]) — the standard WordPress admin-ajax shape — so form.action is the
    // input element, not a URL. jsdom does not implement the shadowing, so it is emulated here.
    // Calling string methods on the element threw out of this capture-phase listener into the host
    // page, and the submit was never tracked.
    const track = vi.fn()
    cleanup = setupFormTracking(track)
    const { form } = buildForm()
    const shadow = document.createElement('input')
    shadow.type = 'hidden'
    shadow.name = 'action'
    shadow.value = 'do_thing'
    form.appendChild(shadow)
    Object.defineProperty(form, 'action', { value: shadow, configurable: true })

    form.dispatchEvent(new Event('submit', { bubbles: true }))

    expect(track).toHaveBeenCalledWith('form_submit', expect.objectContaining({ action: '', formId: 'signup' }))
  })

  it('sends empty formName and the anonymous formId when controls named "name"/"id" shadow the attributes', () => {
    // The same [LegacyOverrideBuiltIns] shadowing the "action" guard exists for, on far more common
    // markup: <input name="name"> on any signup or contact form, <input name="id"> on any CRUD
    // form. Unguarded, form.name shipped the element itself — serialized to "{}", or dropped with a
    // warning on every form_start/submit when a framework's own enumerable props made
    // JSON.stringify throw — and the truthy element defeated the '(anonymous)' fallback for formId.
    const track = vi.fn()
    cleanup = setupFormTracking(track)
    const { form, input } = buildForm()
    Object.defineProperty(form, 'name', { value: input, configurable: true })
    Object.defineProperty(form, 'id', { value: input, configurable: true })

    input.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true }))

    expect(track).toHaveBeenCalledWith('form_start', { formId: '(anonymous)', formName: '' })
    expect(track).toHaveBeenCalledWith('form_submit', expect.objectContaining({ formId: '(anonymous)', formName: '' }))
  })
})
