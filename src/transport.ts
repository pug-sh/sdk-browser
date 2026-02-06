export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface TrackOptions {
  readonly immediate?: boolean
  /** Probability (0–1) that this event is sent. Defaults to 1 (always send). */
  readonly sampleRate?: number
}

export type TrackFn<T extends string = string> = (eventName: T, properties?: Record<string, JsonValue>, options?: TrackOptions) => void

export interface EventData {
  readonly eventName: string
  readonly properties: Readonly<Record<string, JsonValue>>
  readonly timestamp: number
}

export interface SendOptions {
  readonly immediate?: boolean
}

export interface Transport {
  send(event: EventData, options?: SendOptions): Promise<void>
  sendBatch?(events: readonly EventData[]): Promise<void>
  destroy?(): void
}

// Mock transport for development - replace with ConnectRPC client
export function createTransport(endpoint: string): Transport {
  if (typeof window === 'undefined') {
    return { async send() {} }
  }
  console.log(`Initialized mock transport to ${endpoint}`)
  return {
    async send(event: EventData) {
      console.log(`[CottonTransport] Sending event:`, event)
    },
  }
}
