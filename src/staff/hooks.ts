import { use, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import { StaffContext } from './context'
import { S } from './strings'

/** How often the board, the order page and the new-order badge refresh. */
export const REFRESH_MS = 20_000

const readClock = () => Date.now()

/**
 * Calls `callback` every `intervalMs` while the browser tab is visible. When the tab comes
 * back after being hidden for longer than the interval, it calls it at once.
 */
export function useVisibleInterval(callback: () => void, intervalMs: number, enabled = true): void {
  const run = useEffectEvent(callback)
  useEffect(() => {
    if (!enabled) return
    let last = readClock()
    const tick = () => {
      last = readClock()
      run()
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, intervalMs)
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && readClock() - last >= intervalMs) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, intervalMs])
}

/** The current time, refreshed every `intervalMs`, for "12 мин назад" labels. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(readClock)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(readClock()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/** True while the media query matches, e.g. useMediaQuery('(min-width: 900px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * Sets document.title to "<title> — Ала-Тоо", prefixed with the number of new orders inside
 * the staff shell: "(3) Заказы — Ала-Тоо".
 */
export function useStaffTitle(title: string): void {
  const staff = use(StaffContext)
  const count = staff?.user.permissions.view_orders ? (staff.summary?.new ?? 0) : 0
  useEffect(() => {
    const prefix = count > 0 ? `(${count}) ` : ''
    document.title = `${prefix}${title} — ${S.titleSuffix}`
  }, [title, count])
}
