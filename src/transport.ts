export interface EventData {
  eventName: string
  properties: Record<string, any>
  timestamp: number
}

export interface Transport {
  send(event: EventData): Promise<void>
}

// Mock transport for development - replace with ConnectRPC client
export function createTransport(endpoint: string): Transport {
  console.log(`Initialized mock transport to ${endpoint}`)
  return {
    async send(event: EventData) {
      console.log(`[CottonTransport] Sending event:`, event)
    },
  }
}
