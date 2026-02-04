import type { EventData, Transport } from './transport.js'

export interface QueueStorage {
  push(event: EventData): void
  drain(): EventData[]
  readonly size: number
}

function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__cotton_ls_test__'
    localStorage.setItem(testKey, '1')
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
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

export function createLocalStorageQueueStorage(key: string): QueueStorage {
  function read(): EventData[] {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as EventData[]) : []
    } catch {
      return []
    }
  }

  function write(events: EventData[]): void {
    try {
      if (events.length === 0) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify(events))
      }
    } catch {
      // localStorage full or unavailable
    }
  }

  return {
    push(event: EventData) {
      const events = read()
      events.push(event)
      write(events)
    },
    drain(): EventData[] {
      const events = read()
      write([])
      return events
    },
    get size(): number {
      return read().length
    },
  }
}

export function createDefaultQueueStorage(key: string): QueueStorage {
  return isLocalStorageAvailable()
    ? createLocalStorageQueueStorage(key)
    : createMemoryQueueStorage()
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
  const storage = config.storage ?? createDefaultQueueStorage('__cotton_queue__')
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
