export const isStorageAvailable = (storage: Storage): boolean => {
  try {
    const key = '__cotton_test__'
    storage.setItem(key, '1')
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

const UUID_DASH_POSITIONS = new Set([4, 6, 8, 10])

export const generateUUID = (): string => {
  if (crypto?.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  return [...b].map((v, i) => (UUID_DASH_POSITIONS.has(i) ? '-' : '') + v.toString(16).padStart(2, '0')).join('')
}
