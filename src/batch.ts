import type { EventData, Transport } from './transport.js'

export interface QueueStorage {
  push(event: EventData): void
  peek(): readonly EventData[]
  drain(): readonly EventData[]
  shift(count: number): void
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

export function createMemoryQueueStorage(maxQueueSize: number): QueueStorage {
  let buffer: EventData[] = []
  return {
    push(event: EventData) {
      if (buffer.length >= maxQueueSize) {
        buffer.shift()
        console.warn('[Cotton SDK] Queue full, dropping oldest event')
      }
      buffer.push(event)
    },
    peek(): readonly EventData[] {
      return buffer.slice()
    },
    drain(): readonly EventData[] {
      const batch = buffer
      buffer = []
      return batch
    },
    shift(count: number): void {
      buffer.splice(0, count)
    },
    get size(): number {
      return buffer.length
    },
  }
}

export function createLocalStorageQueueStorage(key: string, maxQueueSize: number): QueueStorage {
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
      console.warn('[Cotton SDK] localStorage write failed, events may be lost')
    }
  }

  return {
    push(event: EventData) {
      const events = read()
      if (events.length >= maxQueueSize) {
        events.shift()
        console.warn('[Cotton SDK] Queue full, dropping oldest event')
      }
      events.push(event)
      write(events)
    },
    peek(): readonly EventData[] {
      return read()
    },
    drain(): readonly EventData[] {
      const events = read()
      write([])
      return events
    },
    shift(count: number): void {
      const events = read()
      events.splice(0, count)
      write(events)
    },
    get size(): number {
      return read().length
    },
  }
}

export function createDefaultQueueStorage(key: string, maxQueueSize: number): QueueStorage {
  return isLocalStorageAvailable()
    ? createLocalStorageQueueStorage(key, maxQueueSize)
    : createMemoryQueueStorage(maxQueueSize)
}

export interface BatchConfig {
  readonly maxSize: number
  readonly maxWaitMs: number
  readonly maxQueueSize: number
  readonly storage?: QueueStorage
}

export const DEFAULT_BATCH_CONFIG: Omit<BatchConfig, 'storage'> = {
  maxSize: 10,
  maxWaitMs: 5000,
  maxQueueSize: 1000,
}

export function createBatchedTransport(inner: Transport, config: BatchConfig): Transport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return inner
  }

  const storage = config.storage ?? createDefaultQueueStorage('__cotton_queue__', config.maxQueueSize)
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false

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

  // TODO: Use navigator.sendBeacon once ConnectRPC transport is wired in
  function flush(): void {
    if (flushing) return
    clearTimer()
    const batch = storage.peek()
    if (batch.length === 0) return

    flushing = true
    const batchSize = batch.length

    const sendPromise = inner.sendBatch
      ? inner.sendBatch(batch)
      : Promise.all(batch.map((event) => inner.send(event)))

    sendPromise
      .then(() => {
        storage.shift(batchSize)
      })
      .catch((err) => {
        console.error('[Cotton SDK] Failed to send batch:', err)
      })
      .finally(() => {
        flushing = false
        if (storage.size >= config.maxSize) {
          flush()
        } else if (storage.size > 0) {
          scheduleFlush()
        }
      })
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      flush()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', flush)

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
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', flush)
      flushing = false

      // TODO: Use navigator.sendBeacon once ConnectRPC transport is wired in
      const remaining = storage.drain()
      if (remaining.length > 0) {
        if (inner.sendBatch) {
          inner.sendBatch(remaining).catch((err) =>
            console.error('[Cotton SDK] Failed to send remaining batch on destroy:', err),
          )
        } else {
          for (const event of remaining) {
            inner.send(event).catch((err) =>
              console.error(`[Cotton SDK] Failed to send event "${event.eventName}" on destroy:`, err),
            )
          }
        }
      }

      inner.destroy?.()
    },
  }
}
