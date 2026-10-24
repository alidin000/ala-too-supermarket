import { describe, expect, it } from 'vitest'
import { cancelReasonError, orderActions, paymentActionLabel, statusActionLabel } from './actions'
import {
  arrivedOrders,
  boardListQuery,
  buildOrderListParams,
  mergeRefreshedPage,
  parseBoardFilters,
  tabCount,
} from './boardQuery'
import type { OrderStatus, PaymentStatus, StaffOrderRow } from './types'

const CAN_CHANGE = { change_orders: true }

function source(
  statuses: string[],
  payments: string[],
  canCancel: boolean,
): Parameters<typeof orderActions>[0] {
  return {
    allowed_status_transitions: statuses as OrderStatus[],
    allowed_payment_transitions: payments as PaymentStatus[],
    can_cancel: canCancel,
  }
}

describe('transition labels', () => {
  it('names each status step in plain Russian', () => {
    expect(statusActionLabel('confirmed')).toBe('Подтвердить')
    expect(statusActionLabel('preparing')).toBe('Начать сборку')
    expect(statusActionLabel('ready')).toBe('Готов к выдаче')
    expect(statusActionLabel('out_for_delivery')).toBe('Передан курьеру')
    expect(statusActionLabel('completed')).toBe('Выполнен')
  })

  it('names each payment step', () => {
    expect(paymentActionLabel('paid')).toBe('Оплата получена')
    expect(paymentActionLabel('rejected')).toBe('Оплата не найдена')
    expect(paymentActionLabel('refunded')).toBe('Деньги возвращены')
  })
})

describe('orderActions', () => {
  it('builds buttons only from what the server allows, in its order', () => {
    const actions = orderActions(source(['preparing'], ['paid', 'rejected'], true), CAN_CHANGE)
    expect(actions.map((action) => [action.kind, action.label, action.tone])).toEqual([
      ['status', 'Начать сборку', 'primary'],
      ['payment', 'Оплата получена', 'soft'],
      ['payment', 'Оплата не найдена', 'outline'],
      ['cancel', 'Отменить заказ', 'danger'],
    ])
  })

  it('shows nothing to a user without change_orders', () => {
    expect(orderActions(source(['confirmed'], ['paid'], true), { change_orders: false })).toEqual(
      [],
    )
  })

  it('never offers cancel through the status list, only via can_cancel', () => {
    const actions = orderActions(source(['cancelled', 'completed'], [], false), CAN_CHANGE)
    expect(actions).toEqual([
      { kind: 'status', to: 'completed', label: 'Выполнен', tone: 'primary' },
    ])
  })

  it('skips values it does not know instead of inventing a button', () => {
    const actions = orderActions(
      source(['teleported', 'confirmed'], ['bitcoin'], false),
      CAN_CHANGE,
    )
    expect(actions.map((action) => action.label)).toEqual(['Подтвердить'])
  })

  it('has no buttons for a finished order', () => {
    expect(orderActions(source([], [], false), CAN_CHANGE)).toEqual([])
  })
})

describe('cancel reason', () => {
  it('requires 3 to 500 characters, ignoring surrounding spaces', () => {
    expect(cancelReasonError('   ')).toMatch(/Укажите причину/)
    expect(cancelReasonError(' ok ')).toMatch(/короткая/)
    expect(cancelReasonError('Нет')).toBeNull()
    expect(cancelReasonError('я'.repeat(500))).toBeNull()
    expect(cancelReasonError('я'.repeat(501))).toMatch(/длинная/)
  })
})

describe('order board query', () => {
  it('asks for the active tab explicitly by default', () => {
    const params = buildOrderListParams(boardListQuery(parseBoardFilters(''), 1))
    expect(params.toString()).toBe('status=active')
  })

  it('combines tab, payment chip, trimmed search and page', () => {
    const filters = parseBoardFilters('?status=new&payment=pending&q=%20%2B996%20555%20')
    const params = buildOrderListParams(boardListQuery(filters, 3))
    expect(Object.fromEntries(params)).toEqual({
      status: 'new',
      payment_status: 'pending',
      q: '+996 555',
      page: '3',
    })
  })

  it('passes "all" through and leaves out page 1 and an empty search', () => {
    const params = buildOrderListParams({ status: 'all', paymentStatus: null, q: '  ', page: 1 })
    expect(params.toString()).toBe('status=all')
  })

  it('shows counts only for tabs the summary covers', () => {
    const summary = {
      new: 3,
      confirmed: 1,
      preparing: 0,
      ready: 0,
      out_for_delivery: 2,
      active: 6,
      payment_pending: 1,
    }
    expect(tabCount('active', summary)).toBe(6)
    expect(tabCount('new', summary)).toBe(3)
    expect(tabCount('preparing', summary)).toBe(0)
    expect(tabCount('completed', summary)).toBeNull()
    expect(tabCount('all', summary)).toBeNull()
    expect(tabCount('new', null)).toBeNull()
  })
})

function row(number: string, createdAt: string): StaffOrderRow {
  return {
    number,
    status: 'new',
    payment_status: 'unpaid',
    payment_method: 'cash',
    fulfillment: 'delivery',
    customer_name: 'Тест',
    phone: '+996700000100',
    total: '100.00',
    items_count: 1,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

describe('auto-refresh merging', () => {
  it('announces only orders newer than everything already on screen', () => {
    const before = [
      row('AT-2', '2026-10-24T12:00:00+06:00'),
      row('AT-1', '2026-10-24T11:00:00+06:00'),
    ]
    const after = [
      row('AT-3', '2026-10-24T06:30:00Z'), // 12:30 in Bishkek: newer, despite the "Z" text
      row('AT-2', '2026-10-24T12:00:00+06:00'),
      row('AT-0', '2026-10-24T09:00:00+06:00'), // older order that moved into this tab
    ]
    expect(arrivedOrders(before, after).map((order) => order.number)).toEqual(['AT-3'])
  })

  it('keeps rows loaded with "load more" below a refreshed first page, without duplicates', () => {
    const current = ['A', 'B', 'C', 'D'].map((number) => row(number, '2026-10-24T10:00:00Z'))
    const fresh = ['N', 'A'].map((number) => row(number, '2026-10-24T10:00:00Z'))
    expect(mergeRefreshedPage(current, fresh, 2).map((order) => order.number)).toEqual([
      'N',
      'A',
      'C',
      'D',
    ])
    expect(mergeRefreshedPage(current.slice(0, 2), fresh, 2).map((order) => order.number)).toEqual([
      'N',
      'A',
    ])
  })
})
