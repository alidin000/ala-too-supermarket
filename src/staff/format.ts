import { isStaffApiError } from './api'
import { S } from './strings'

const STORE_TIME_ZONE = 'Asia/Bishkek'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: STORE_TIME_ZONE,
})
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: STORE_TIME_ZONE,
})
const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: STORE_TIME_ZONE,
})

/** "12 мин назад", "3 ч назад", "2 дня назад"; "только что" under a minute. */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const diff = Math.max(0, now - at)
  if (diff < MINUTE) return S.time.justNow
  if (diff < HOUR) return S.time.minutesAgo(Math.floor(diff / MINUTE))
  if (diff < DAY) return S.time.hoursAgo(Math.floor(diff / HOUR))
  return S.time.daysAgo(Math.floor(diff / DAY))
}

/** Store-local (Bishkek) clock time "18:05" today, else "24 окт., 18:05". */
export function absoluteTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const sameDay = dayFormat.format(at) === dayFormat.format(now)
  return sameDay ? timeFormat.format(at) : dateTimeFormat.format(at)
}

export function clockTime(at: number): string {
  return timeFormat.format(at)
}

/** One Russian sentence for a failed staff request. */
export function errorMessage(error: unknown): string {
  if (!isStaffApiError(error)) return S.errors.generic
  switch (error.kind) {
    case 'network':
      return S.errors.network
    case 'timeout':
      return S.errors.timeout
    case 'server':
      return S.errors.server
    case 'forbidden':
      return error.detail ?? S.errors.forbidden
    case 'csrf':
      return S.errors.csrf
    case 'unauthenticated':
      return S.errors.unauthenticated
    case 'not_found':
      return error.detail ?? S.errors.notFound
    case 'throttled':
      return S.errors.throttled(error.retryAfter)
    case 'validation': {
      const messages = Object.values(error.fieldErrors).flat()
      return messages[0] ?? error.detail ?? S.errors.generic
    }
    case 'http':
      return error.detail ?? S.errors.generic
  }
}

/** Every 400 message that is not tied to one of `knownFields`. */
export function generalErrors(error: unknown, knownFields: readonly string[]): string[] {
  if (!isStaffApiError(error, 'validation')) return error ? [errorMessage(error)] : []
  const messages = Object.entries(error.fieldErrors)
    .filter(([field]) => !knownFields.includes(field))
    .flatMap(([, list]) => list)
  if (messages.length === 0 && error.detail) messages.push(error.detail)
  return messages
}
