import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupDeadClickTracking, setupRageClickTracking } from './frustration.js'

const withText = <T extends HTMLElement>(el: T, text: string): T => {
  el.textContent = text
  return el
}

const labelledCheckbox = (): HTMLLabelElement => {
  const label = withText(document.createElement('label'), 'Subscribe')
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  label.appendChild(checkbox)
  return document.body.appendChild(label)
}

describe('setupRageClickTracking', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  const clickRepeatedly = (target: Element, times: number, at = { x: 0, y: 0 }) => {
    for (let i = 0; i < times; i++) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: at.x, clientY: at.y }))
      vi.advanceTimersByTime(100)
    }
  }

  const button = () => document.body.appendChild(withText(document.createElement('button'), 'Pay'))

  it('reports four quick clicks in one spot, with the click count', () => {
    const track = vi.fn()
    cleanup = setupRageClickTracking(track)

    clickRepeatedly(button(), 4, { x: 10, y: 20 })

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('rage_click', { clickCount: 4, element: 'BUTTON', x: 10, y: 20 })
  })

  it('does not report a triple-click, which is how a paragraph is selected', () => {
    const track = vi.fn()
    cleanup = setupRageClickTracking(track)
    const paragraph = document.body.appendChild(withText(document.createElement('p'), 'Order 4815-1623-42'))

    clickRepeatedly(paragraph, 3)

    expect(track).not.toHaveBeenCalled()
  })

  it('reports a sustained burst once', () => {
    const track = vi.fn()
    cleanup = setupRageClickTracking(track)

    clickRepeatedly(button(), 15)

    expect(track).toHaveBeenCalledTimes(1)
  })

  it('reports again once a pause has ended the burst', () => {
    const track = vi.fn()
    cleanup = setupRageClickTracking(track)
    const target = button()

    clickRepeatedly(target, 4)
    vi.advanceTimersByTime(1000)
    clickRepeatedly(target, 4)

    expect(track).toHaveBeenCalledTimes(2)
  })

  it('does not count clicks more than 40px apart as one burst', () => {
    const track = vi.fn()
    cleanup = setupRageClickTracking(track)
    const target = button()

    for (let i = 0; i < 6; i++) {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: i % 2 === 0 ? 0 : 50 }))
      vi.advanceTimersByTime(100)
    }

    expect(track).not.toHaveBeenCalled()
  })

  it('counts a label click once, though the browser forwards it to the control', () => {
    const track = vi.fn()
    cleanup = setupRageClickTracking(track)
    const label = labelledCheckbox()

    clickRepeatedly(label, 3)
    expect(track).not.toHaveBeenCalled()

    clickRepeatedly(label, 1)
    expect(track).toHaveBeenCalledWith('rage_click', expect.objectContaining({ clickCount: 4, element: 'LABEL' }))
  })
})

describe('setupDeadClickTracking', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    // Before restoring real timers, so jsdom's queued selectionchange is dropped, not left to fire in the next test.
    document.getSelection()?.removeAllRanges()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  // We append the target and flush the MutationObserver microtask *before* clicking so the
  // mutation baseline is settled, then advance past the timeout with no further mutations.
  const clickAndSettle = async (target: HTMLElement): Promise<void> => {
    await Promise.resolve() // flush pending MutationObserver records from the append
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 7, clientY: 8 }))
    await vi.advanceTimersByTimeAsync(500)
  }

  const click = (target: Element, detail: number) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))

  it('captures element text on a dead click', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    const div = withText(document.createElement('div'), 'Submit order')
    document.body.appendChild(div)

    await clickAndSettle(div)

    expect(track).toHaveBeenCalledWith('dead_click', { element: 'DIV', text: 'Submit order', x: 7, y: 8 })
  })

  it('captures the element own text only, never descendant text', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    const card = withText(document.createElement('div'), 'Open ')
    card.appendChild(withText(document.createElement('span'), 'jane@example.com'))
    document.body.appendChild(card)

    await clickAndSettle(card)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'DIV', text: 'Open' }))
  })

  it('truncates to 20 characters', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    const div = withText(document.createElement('div'), 'a'.repeat(60))
    document.body.appendChild(div)

    await clickAndSettle(div)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ text: 'a'.repeat(20) }))
  })

  it('captures no text when the click lands inside a contenteditable region', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const line = withText(document.createElement('p'), 'my secret diary entry')
    editor.appendChild(line)
    document.body.appendChild(editor)

    await clickAndSettle(line)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'P', text: '' }))
  })

  it('redacts text on a dead click inside a data-pug-no-capture region', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-pug-no-capture', '')
    const div = withText(document.createElement('div'), 'card 4111 1111 1111 1111')
    wrapper.appendChild(div)
    document.body.appendChild(wrapper)

    await clickAndSettle(div)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'DIV', text: '' }))
  })

  it('redacts text on a dead click when the element itself is marked', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    const div = withText(document.createElement('div'), 'jane@example.com')
    div.setAttribute('data-pug-no-capture', '')
    document.body.appendChild(div)

    await clickAndSettle(div)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'DIV', text: '' }))
  })

  it('does not report a double-click that selects text', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const paragraph = document.body.appendChild(withText(document.createElement('p'), 'Order 4815-1623-42'))
    await Promise.resolve()

    click(paragraph, 1)
    // The second press selects the word, and selectionchange fires, before its click does.
    document.getSelection()?.selectAllChildren(paragraph)
    await vi.advanceTimersByTimeAsync(0)
    click(paragraph, 2)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })

  it('does not report the click that ends a drag-selection', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const paragraph = document.body.appendChild(withText(document.createElement('p'), 'Order 4815-1623-42'))
    await Promise.resolve()

    // The drag selects the text, and selectionchange fires, before the click.
    document.getSelection()?.setBaseAndExtent(paragraph.firstChild!, 6, paragraph.firstChild!, 18)
    await vi.advanceTimersByTimeAsync(0)
    click(paragraph, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })

  it('still reports a dead click while unrelated text is selected', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const paragraph = document.body.appendChild(withText(document.createElement('p'), 'Order 4815-1623-42'))
    const div = document.body.appendChild(withText(document.createElement('div'), 'Open'))
    document.getSelection()?.selectAllChildren(paragraph)
    await vi.advanceTimersByTimeAsync(0)

    click(div, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'DIV' }))
  })

  it('still reports a click that only moves the caret', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const paragraph = document.body.appendChild(withText(document.createElement('p'), 'Order 4815-1623-42'))
    await Promise.resolve()

    click(paragraph, 1)
    document.getSelection()?.collapse(paragraph.firstChild, 3)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'P' }))
  })

  it('reports a double-click that gets no response once', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const div = document.body.appendChild(withText(document.createElement('div'), 'Open'))
    await Promise.resolve()

    click(div, 1)
    await vi.advanceTimersByTimeAsync(150)
    click(div, 2)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledTimes(1)
  })

  it('does not report a label click, which the browser answers by activating the control', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const label = labelledCheckbox()
    await Promise.resolve()

    click(label, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })

  it('reports a label click when the page cancels the click forwarded to its checkbox', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const label = labelledCheckbox()
    label.querySelector('input')!.addEventListener('click', event => event.preventDefault())
    await Promise.resolve()

    click(label, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'LABEL' }))
  })

  it('reports a label click whose control is a button that does nothing', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    document.body.innerHTML = '<label for="go">Go</label><button id="go">Go</button>'
    await Promise.resolve()

    click(document.querySelector('label')!, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'LABEL' }))
  })

  it('reports a slow double-click once, though its first click was judged before the second', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const div = document.body.appendChild(withText(document.createElement('div'), 'Open'))
    await Promise.resolve()

    click(div, 1)
    await vi.advanceTimersByTimeAsync(600)
    click(div, 2)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledTimes(1)
  })

  it('does not report a double-click whose first click replaced the element', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const button = document.body.appendChild(withText(document.createElement('button'), 'Save'))
    const spinner = withText(document.createElement('span'), 'Saving')
    button.addEventListener('click', () => button.replaceWith(spinner))
    await Promise.resolve()

    click(button, 1)
    await vi.advanceTimersByTimeAsync(100)
    click(spinner, 2)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })

  it('reports a rage burst on selectable text once, though its second press selected a word', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const div = document.body.appendChild(withText(document.createElement('div'), 'Open menu'))
    await Promise.resolve()

    click(div, 1)
    document.getSelection()?.selectAllChildren(div)
    await vi.advanceTimersByTimeAsync(0)
    for (const detail of [2, 3, 4, 5]) {
      click(div, detail)
    }
    await vi.advanceTimersByTimeAsync(500)

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('dead_click', expect.objectContaining({ element: 'DIV' }))
  })

  it('does not report a click whose response is highlighting text elsewhere', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const code = document.body.appendChild(withText(document.createElement('pre'), 'npm i @pug-sh/browser'))
    const button = document.body.appendChild(withText(document.createElement('button'), 'Select'))
    button.addEventListener('click', () => document.getSelection()?.selectAllChildren(code))
    await Promise.resolve()

    click(button, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })

  it('does not report a press inside highlighted text, which clears the highlight', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)
    const paragraph = document.body.appendChild(withText(document.createElement('p'), 'Order 4815-1623-42'))
    document.getSelection()?.selectAllChildren(paragraph)
    await vi.advanceTimersByTimeAsync(0)

    // Chromium collapses the highlight at mouseup, and selectionchange fires after the click.
    document.getSelection()?.collapse(paragraph.firstChild, 3)
    click(paragraph, 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })

  it('ignores a click dispatched at the document or window', async () => {
    const track = vi.fn()
    cleanup = setupDeadClickTracking(track)

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    window.dispatchEvent(new MouseEvent('click'))
    await vi.advanceTimersByTimeAsync(500)

    expect(track).not.toHaveBeenCalled()
  })
})
