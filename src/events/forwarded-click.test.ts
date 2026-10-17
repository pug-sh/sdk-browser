import { afterEach, describe, expect, it } from 'vitest'
import { createForwardedClickDetector } from './forwarded-click.js'

// jsdom forwards a label click to its control at (0, 0) where browsers copy the label click's
// coordinates, so label clicks here are dispatched at (0, 0) too.
describe('createForwardedClickDetector', () => {
  let stop: (() => void) | undefined

  afterEach(() => {
    stop?.()
    stop = undefined
    document.body.innerHTML = ''
  })

  const recordClicks = (): string[] => {
    const forwardedTo = createForwardedClickDetector()
    const seen: string[] = []
    const onClick = (event: MouseEvent) => {
      const name = (event.target as Node).nodeName
      seen.push(forwardedTo(event) ? `${name} (forwarded)` : name)
    }
    window.addEventListener('click', onClick, true)
    stop = () => window.removeEventListener('click', onClick, true)
    return seen
  }

  const click = (target: EventTarget, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))

  const nextTask = () => new Promise(resolve => setTimeout(resolve))

  it('flags the click the browser forwards from a label to its control', () => {
    document.body.innerHTML = '<input type="checkbox" id="cb"><label for="cb">Subscribe</label>'
    const seen = recordClicks()

    click(document.querySelector('label')!)

    expect(seen).toEqual(['LABEL', 'INPUT (forwarded)'])
    expect(document.querySelector('input')!.checked).toBe(true)
  })

  it('flags the forward from a label that wraps its control', () => {
    document.body.innerHTML = '<label><input type="checkbox"> <span>Subscribe</span></label>'
    const seen = recordClicks()

    click(document.querySelector('span')!)

    expect(seen).toEqual(['SPAN', 'INPUT (forwarded)'])
  })

  it('flags the forward from a label inside an open shadow root', () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<label><input type="checkbox"> <span>Subscribe</span></label>'
    const seen = recordClicks()

    click(root.querySelector('span')!, { composed: true, clientX: 5, clientY: 7 })
    // A browser's forward is composed and reaches the window; jsdom's stays inside the shadow root.
    click(root.querySelector('input')!, { composed: true, clientX: 5, clientY: 7 })

    expect(seen).toEqual(['DIV', 'DIV (forwarded)'])
  })

  it('does not flag clicks on the control itself', () => {
    document.body.innerHTML = '<label><input type="checkbox"> Subscribe</label>'
    const seen = recordClicks()

    click(document.querySelector('input')!)
    click(document.querySelector('input')!)

    expect(seen).toEqual(['INPUT', 'INPUT'])
  })

  it('does not flag a click on the control after a label click the page cancelled', () => {
    document.body.innerHTML = '<input type="checkbox" id="cb"><label for="cb">Subscribe</label>'
    const label = document.querySelector('label')!
    label.addEventListener('click', event => event.preventDefault())
    const seen = recordClicks()

    click(label)
    click(document.querySelector('input')!, { clientX: 5, clientY: 5 })

    expect(seen).toEqual(['LABEL', 'INPUT'])
  })

  // Keyboard clicks all sit at (0, 0), so only the task tells this one from a forward.
  it('does not flag a later keyboard click on the control after a click on a link in its label', async () => {
    document.body.innerHTML = '<label><input type="checkbox"> I agree to the <a href="#terms">terms</a></label>'
    const seen = recordClicks()

    click(document.querySelector('a')!)
    await nextTask()
    click(document.querySelector('input')!)

    expect(seen).toEqual(['A', 'INPUT'])
  })

  it('handles a click dispatched at a non-element target', () => {
    const seen = recordClicks()

    click(document)

    expect(seen).toEqual(['#document'])
  })
})
