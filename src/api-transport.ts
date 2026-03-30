import { type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

export const createApiTransport = (endpoint: string, token: string, opts?: { defaultTimeoutMs?: number }) => {
  const interceptors: Interceptor[] = [
    next => async req => {
      req.header.set('x-api-key', token)
      return next(req)
    },
  ]

  return createConnectTransport({
    baseUrl: endpoint,
    defaultTimeoutMs: opts?.defaultTimeoutMs,
    interceptors,
    useBinaryFormat: true,
  })
}
