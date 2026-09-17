function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local
  } catch {
    return false
  }
}

export async function loadFromChrome<T>(
  key: string,
  validate: (v: unknown) => v is T,
): Promise<T | null> {
  if (!hasChromeStorage()) return null
  return new Promise<T | null>((resolve) => {
    try {
      chrome.storage.local.get([key], (items) => {
        const value = items[key]
        resolve(validate(value) ? value : null)
      })
    } catch {
      resolve(null)
    }
  })
}

export async function saveToChrome(key: string, value: unknown): Promise<void> {
  if (!hasChromeStorage()) return
  return new Promise<void>((resolve) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => resolve())
    } catch {
      resolve()
    }
  })
}

/** 删除一个键(存 null 与"没有这个键"在语义上不是一回事,故走 remove 而不是存空值) */
export async function removeFromChrome(key: string): Promise<void> {
  if (!hasChromeStorage()) return
  return new Promise<void>((resolve) => {
    try {
      chrome.storage.local.remove(key, () => resolve())
    } catch {
      resolve()
    }
  })
}

/** Subscribe to changes for a single key. Returns a cleanup function. */
export function subscribeChromeStorage<T>(
  key: string,
  validate: (v: unknown) => v is T,
  onChange: (value: T) => void,
): () => void {
  try {
    if (!hasChromeStorage() || !chrome.storage?.onChanged) return () => undefined
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      const change = changes[key]
      if (!change) return
      const next = change.newValue as unknown
      if (validate(next)) onChange(next)
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  } catch {
    return () => undefined
  }
}
