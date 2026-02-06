import type { EventData, SendOptions, Transport } from './transport.js'

export function createRateLimitedTransport(inner: Transport, maxPerSecond: number): Transport {
  let tokens = maxPerSecond
  let lastRefill = Date.now()

  function tryConsume(): boolean {
    const now = Date.now()
    tokens = Math.min(maxPerSecond, tokens + ((now - lastRefill) / 1000) * maxPerSecond)
    lastRefill = now
    if (tokens >= 1) {
      tokens -= 1
      return true
    }
    return false
  }

  return {
    async send(event: EventData, options?: SendOptions): Promise<void> {
      if (!tryConsume()) return
      return inner.send(event, options)
    },
    sendBatch: inner.sendBatch
      ? (events: readonly EventData[]) => {
          const allowed = events.filter(() => tryConsume())
          if (allowed.length === 0) return Promise.resolve()
          return inner.sendBatch!(allowed)
        }
      : undefined,
    destroy(): void {
      inner.destroy?.()
    },
  }
}
