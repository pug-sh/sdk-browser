import type { EventData, Transport } from './transport.js'

export interface QueueStorage {
  push(event: EventData): void
  drain(): EventData[]
  readonly size: number
}

export function createMemoryQueueStorage(): QueueStorage {
  let buffer: EventData[] = []
  return {
    push(event: EventData) {
      buffer.push(event)
    },
    drain(): EventData[] {
      const batch = buffer
      buffer = []
      return batch
    },
    get size(): number {
      return buffer.length
    },
  }
}

export interface BatchConfig {
  readonly maxSize: number
  readonly maxWaitMs: number
  readonly storage?: QueueStorage
}

export const DEFAULT_BATCH_CONFIG: Omit<BatchConfig, 'storage'> = {
  maxSize: 10,
  maxWaitMs: 5000,
}

export function createBatchedTransport(inner: Transport, config: BatchConfig): Transport {
  const storage = config.storage ?? createMemoryQueueStorage()
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleFlush(): void {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, config.maxWaitMs)
  }

  function flush(): void {
    clearTimer()
    const batch = storage.drain()
    if (batch.length === 0) return

    if (inner.sendBatch) {
      inner.sendBatch(batch).catch((err) => console.error('[Cotton SDK] Failed to send batch:', err))
    } else {
      for (const event of batch) {
        inner.send(event).catch((err) =>
          console.error(`[Cotton SDK] Failed to send event "${event.eventName}" in batch:`, err),
        )
      }
    }
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      flush()
    }
  }

  const onPageHide = (): void => {
    flush()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)

  return {
    async send(event: EventData): Promise<void> {
      storage.push(event)
      if (storage.size >= config.maxSize) {
        flush()
      } else {
        scheduleFlush()
      }
    },

    destroy(): void {
      flush()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      clearTimer()
      inner.destroy?.()
    },
  }
}
