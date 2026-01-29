import { setupClickTracking } from './events/click.js'
import { setupFormTracking } from './events/form.js'
import { setupFrustrationTracking } from './events/frustration.js'
import { setupPageViewTracking } from './events/page_view.js'
import { setupScrollTracking } from './events/scroll.js'
import type { EventData, JsonValue, Transport } from './transport.js'
import { createTransport } from './transport.js'

export interface CottonConfig {
  readonly endpoint: string
  readonly projectId: string
}

let config: CottonConfig
let transport: Transport
let initialized = false

export function init(projectId: string, options: { endpoint?: string } = {}) {
  if (initialized) {
    console.warn('Cotton SDK already initialized')
    return
  }

  config = {
    projectId,
    endpoint: options.endpoint || 'http://localhost:8080',
  }

  transport = createTransport(config.endpoint)
  initialized = true

  const trackers = [
    setupPageViewTracking,
    setupClickTracking,
    setupScrollTracking,
    setupFormTracking,
    setupFrustrationTracking,
  ]

  for (const setup of trackers) {
    try {
      setup(track)
    } catch (err) {
      console.error(`[Cotton SDK] Failed to initialize tracker "${setup.name}":`, err)
    }
  }
}

export function track(eventName: string, properties: Record<string, JsonValue> = {}) {
  if (!initialized) {
    console.warn('Cotton SDK not initialized. Call init() first.')
    return
  }

  const event: EventData = {
    eventName,
    properties: {
      ...properties,
      projectId: config.projectId,
      url: window.location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
    },
    timestamp: Date.now(),
  }
  transport.send(event).catch(err => console.error(`[Cotton SDK] Failed to send event "${eventName}":`, err))
}
