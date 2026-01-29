import Cotton from '../cotton.js'

export function setupScrollTracking(cotton: Cotton) {
  let timer: any = null
  const THROTTLE_MS = 2000 // Track at most every 2 seconds

  window.addEventListener('scroll', () => {
    if (timer) return

    timer = setTimeout(() => {
      const scrollEventDetails = {
        scrollY: window.scrollY,
        percent: (() => {
          const scrollable = document.body.scrollHeight - window.innerHeight
          return scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0
        })(),
      }

      // Log the scroll event details to console
      console.log('[Cotton SDK] Scroll event details:', scrollEventDetails)

      cotton.track('scroll', scrollEventDetails)
      timer = null
    }, THROTTLE_MS)
  })
}
