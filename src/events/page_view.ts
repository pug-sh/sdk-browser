import type { TrackFn } from '../transport.js'

export type PageViewEventName = 'page_view'

let patched = false

export function setupPageViewTracking(track: TrackFn<PageViewEventName>) {
  track('page_view')

  let originalPushState: typeof history.pushState | null = null
  let originalReplaceState: typeof history.replaceState | null = null

  if (!patched) {
    patched = true

    originalPushState = history.pushState
    history.pushState = function (...args) {
      originalPushState!.apply(this, args)
      window.dispatchEvent(new Event('cotton:navigation'))
    }

    originalReplaceState = history.replaceState
    history.replaceState = function (...args) {
      originalReplaceState!.apply(this, args)
      window.dispatchEvent(new Event('cotton:navigation'))
    }
  }

  const onNav = () => track('page_view')
  window.addEventListener('cotton:navigation', onNav)
  window.addEventListener('popstate', onNav)

  return () => {
    window.removeEventListener('cotton:navigation', onNav)
    window.removeEventListener('popstate', onNav)
    if (originalPushState) {
      history.pushState = originalPushState
    }
    if (originalReplaceState) {
      history.replaceState = originalReplaceState
    }
    patched = false
  }
}
