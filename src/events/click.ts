import type { TrackFn, WellKnownEventName } from '../track.js'
import { getSafeElementText, isElement } from '../utils.js'

const eventClick = 'click' satisfies WellKnownEventName

const MAX_TEXT_LENGTH = 50

export const setupClickTracking = (track: TrackFn) => {
  // A label click and the click the browser forwards to its control are both kept: they are two
  // elements, and only the control's click carries its id.
  const onClick = (event: MouseEvent) => {
    const target = event.target
    if (!isElement(target)) {
      return
    }
    track(eventClick, {
      class: target.getAttribute('class') ?? '',
      id: target.id,
      tag: target.tagName,
      // Own text only; structural fields still send so the click keeps counting.
      text: getSafeElementText(target, MAX_TEXT_LENGTH),
      x: event.clientX,
      y: event.clientY,
    })
  }

  window.addEventListener('click', onClick, true)

  return () => window.removeEventListener('click', onClick, true)
}
