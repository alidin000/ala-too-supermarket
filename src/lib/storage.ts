// Browser storage can throw (Safari private mode, blocked cookies, full quota) or be
// missing entirely (tests). Every access goes through these helpers.

type Area = 'local' | 'session'

function area(which: Area): Storage | null {
  try {
    return which === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readStorage(key: string, which: Area = 'local'): string | null {
  try {
    return area(which)?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null, which: Area = 'local'): void {
  try {
    const storage = area(which)
    if (!storage) return
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, value)
  } catch {
    // Ignore: the shop keeps working, it just will not remember this value.
  }
}

export function readJson(key: string, which: Area = 'local'): unknown {
  const raw = readStorage(key, which)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
