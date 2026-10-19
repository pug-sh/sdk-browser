import { isElement } from '../utils.js'

// A click on a <label> makes the browser click its control too, at the same coordinates and in the
// same task. Call the detector first on every click; for that second click it returns the control.
export const createForwardedClickDetector = () => {
  let expected: { control: HTMLElement; x: number; y: number } | undefined

  return (event: MouseEvent): HTMLElement | undefined => {
    const pending = expected
    expected = undefined
    // The innermost target, so a label inside an open shadow root is still found.
    const target = event.composedPath()[0]
    if (!isElement(target)) {
      return undefined
    }
    if (target === pending?.control && event.clientX === pending.x && event.clientY === pending.y) {
      return pending.control
    }
    const control = target.closest('label')?.control
    if (control && !control.contains(target)) {
      expected = { control, x: event.clientX, y: event.clientY }
      // A click in a later task is never the forward. Not a microtask: one runs before the forward.
      setTimeout(() => (expected = undefined))
    }
    return undefined
  }
}
