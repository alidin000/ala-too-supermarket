// Orders board: tabs, URL filters (/admin?status=new&payment=pending&q=...) and the
// matching GET /api/staff/orders/ parameters.

import type { OrderListQuery, OrderStatusFilter, OrdersSummary, StaffOrderRow } from './types'

export const BOARD_TABS = [
  'active',
  'new',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'all',
] as const satisfies readonly OrderStatusFilter[]
export type BoardTab = (typeof BOARD_TABS)[number]

export interface BoardFilters {
  tab: BoardTab
  /** The "Ожидают проверки оплаты" chip: payment_status=pending. */
  paymentPending: boolean
  q: string
}

export const DEFAULT_BOARD_FILTERS: BoardFilters = { tab: 'active', paymentPending: false, q: '' }

const MAX_QUERY_LENGTH = 100

export function isBoardTab(value: unknown): value is BoardTab {
  return typeof value === 'string' && (BOARD_TABS as readonly string[]).includes(value)
}

export function parseBoardFilters(search: string): BoardFilters {
  const params = new URLSearchParams(search)
  const status = params.get('status')
  return {
    tab: isBoardTab(status) ? status : 'active',
    paymentPending: params.get('payment') === 'pending',
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
  }
}

/** The query string for the board URL; default values are left out. */
export function boardSearch(filters: BoardFilters): string {
  const params = new URLSearchParams()
  if (filters.tab !== 'active') params.set('status', filters.tab)
  if (filters.paymentPending) params.set('payment', 'pending')
  const q = filters.q.trim()
  if (q) params.set('q', q)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function boardListQuery(filters: BoardFilters, page = 1): OrderListQuery {
  return {
    status: filters.tab,
    paymentStatus: filters.paymentPending ? 'pending' : null,
    q: filters.q,
    page,
  }
}

/** URL parameters for GET /api/staff/orders/. */
export function buildOrderListParams(query: OrderListQuery): URLSearchParams {
  const params = new URLSearchParams()
  params.set('status', query.status)
  if (query.paymentStatus) params.set('payment_status', query.paymentStatus)
  const q = query.q?.trim()
  if (q) params.set('q', q.slice(0, MAX_QUERY_LENGTH))
  if (query.page && query.page > 1) params.set('page', String(Math.floor(query.page)))
  return params
}

/** The count shown on a tab; the summary has no totals for completed, cancelled and all. */
export function tabCount(tab: BoardTab, summary: OrdersSummary | null | undefined): number | null {
  if (!summary) return null
  switch (tab) {
    case 'active':
    case 'new':
    case 'confirmed':
    case 'preparing':
    case 'ready':
    case 'out_for_delivery':
      return summary[tab]
    default:
      return null
  }
}

/**
 * Merges a refreshed first page into the rows already on screen: the fresh page wins, rows
 * loaded by "load more" stay below it, and every order appears once.
 */
export function mergeRefreshedPage(
  current: readonly StaffOrderRow[],
  firstPage: readonly StaffOrderRow[],
  pageSize: number,
): StaffOrderRow[] {
  if (current.length <= pageSize) return [...firstPage]
  const seen = new Set(firstPage.map((row) => row.number))
  return [...firstPage, ...current.slice(pageSize).filter((row) => !seen.has(row.number))]
}

/** Milliseconds since the epoch, or NaN. ISO strings with different offsets don't sort as text. */
export function timeOf(iso: string): number {
  return Date.parse(iso)
}

/**
 * Orders in `next` that were not on screen before and are newer than everything that was:
 * the ones to announce after an auto-refresh. Orders that only moved into the current tab
 * (an older order that changed status) are not "new".
 */
export function arrivedOrders(
  previous: readonly StaffOrderRow[],
  next: readonly StaffOrderRow[],
): StaffOrderRow[] {
  const known = new Set(previous.map((row) => row.number))
  const newest = previous.reduce((latest, row) => Math.max(latest, timeOf(row.created_at) || 0), 0)
  return next.filter((row) => !known.has(row.number) && timeOf(row.created_at) > newest)
}

/** True when the order arrived after the board was last viewed (`since`, epoch ms). */
export function isUnseen(row: StaffOrderRow, since: number | null): boolean {
  return since !== null && timeOf(row.created_at) > since
}
