const PREFIX = '[Cotton SDK]'

let debugEnabled = false

export const setDebug = (enabled: boolean): void => {
  debugEnabled = enabled
}

export const log = {
  warn: (msg: string, ...args: unknown[]): void => {
    console.warn(`${PREFIX} ${msg}`, ...args)
  },
  error: (msg: string, ...args: unknown[]): void => {
    console.error(`${PREFIX} ${msg}`, ...args)
  },
  debug: (msg: string, ...args: unknown[]): void => {
    if (!debugEnabled) return
    console.debug(`${PREFIX} ${msg}`, ...args)
  },
}
