import { describe, expect, it } from 'vitest'
import { StaffApiError } from './api'
import { absoluteTime, errorMessage, relativeTime } from './format'
import { S, waitPhrase } from './strings'

describe('lockout and throttle waits', () => {
  it('rounds up to whole minutes with the right Russian form', () => {
    expect(waitPhrase(900)).toBe('через 15 минут')
    expect(waitPhrase(60)).toBe('через 1 минуту')
    expect(waitPhrase(61)).toBe('через 2 минуты')
    expect(waitPhrase(21 * 60)).toBe('через 21 минуту')
    expect(waitPhrase(30)).toBe('через 30 секунд')
    expect(waitPhrase(0.2)).toBe('через 1 секунду')
  })

  it('tells a locked-out user how long to wait', () => {
    expect(S.login.locked(900)).toBe('Слишком много попыток входа. Попробуйте через 15 минут.')
    expect(errorMessage(new StaffApiError('throttled', 429, { retryAfter: 45 }))).toBe(
      'Слишком много запросов. Повторите через 45 секунд.',
    )
  })
})

describe('order times', () => {
  const now = Date.parse('2026-10-24T12:00:00Z') // 18:00 in Bishkek

  it('says how long ago an order came in', () => {
    expect(relativeTime('2026-10-24T11:59:30Z', now)).toBe('только что')
    expect(relativeTime('2026-10-24T11:48:00Z', now)).toBe('12 мин назад')
    expect(relativeTime('2026-10-24T09:00:00Z', now)).toBe('3 ч назад')
    expect(relativeTime('2026-10-22T12:00:00Z', now)).toBe('2 дня назад')
    expect(relativeTime('garbage', now)).toBe('')
  })

  it('shows store-local clock time today and the date otherwise', () => {
    expect(absoluteTime('2026-10-24T11:48:00Z', now)).toBe('17:48')
    expect(absoluteTime('2026-10-23T11:48:00Z', now)).toMatch(/23 окт.*17:48/)
  })
})

describe('error messages', () => {
  it('prefers the first server message for a 400', () => {
    const error = new StaffApiError('validation', 400, {
      fieldErrors: { status: ['Нельзя перевести заказ из «Новый» в «Выполнен».'] },
    })
    expect(errorMessage(error)).toBe('Нельзя перевести заказ из «Новый» в «Выполнен».')
  })

  it('explains a lost connection and a missing permission', () => {
    expect(errorMessage(new StaffApiError('network', 0))).toMatch(/Нет связи/)
    expect(errorMessage(new StaffApiError('forbidden', 403))).toBe('Недостаточно прав.')
  })
})
