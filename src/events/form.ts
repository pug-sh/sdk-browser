import type { TrackFn } from '../transport.js'

export type FormEventName = 'form_start' | 'form_submit'

export function setupFormTracking(track: TrackFn<FormEventName>) {
  const formsSeen = new WeakSet<HTMLFormElement>()

  window.addEventListener(
    'input',
    event => {
      if (!event.target) {
        return
      }
      handleFormInteraction(event.target as HTMLElement, track, formsSeen)
    },
    true
  )

  window.addEventListener(
    'submit',
    event => {
      if (!event.target) {
        return
      }
      const form = event.target as HTMLFormElement
      const formSubmitEventDetails = {
        action: form.action,
        formId: form.id,
        formName: form.name,
      }

      track('form_submit', formSubmitEventDetails)
    },
    true
  )
}

function handleFormInteraction(target: HTMLElement, track: TrackFn<FormEventName>, formsSeen: WeakSet<HTMLFormElement>) {
  const form = (target as HTMLInputElement).form

  if (form && !formsSeen.has(form)) {
    formsSeen.add(form)
    const formStartEventDetails = {
      formId: form.id,
      formName: form.name,
    }

    track('form_start', formStartEventDetails)
  }
}
