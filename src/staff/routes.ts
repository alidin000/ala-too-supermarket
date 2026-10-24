// Path-based staff routes, inside the same SPA as the storefront:
//   /admin                        orders board (?status=new&payment=pending&q=...)
//   /admin/orders/<number>        one order
//   /admin/products               stock and prices (?q=&category=&stock=low&active=1)
//   /admin/login?next=/admin/...  login; `next` is honoured only inside /admin

import { isStaffPath } from '../lib/router'
import { boardSearch, parseBoardFilters } from './boardQuery'
import type { BoardFilters } from './boardQuery'
import { parseProductFilters, productsSearch } from './productEdit'
import type { ProductFilters } from './productEdit'

export type StaffRoute =
  | { name: 'board'; filters: BoardFilters }
  | { name: 'order'; number: string }
  | { name: 'products'; filters: ProductFilters }
  | { name: 'login'; next: string }
  | { name: 'not_found' }

export const STAFF_HOME = '/admin'
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,32}$/
const MAX_NEXT_LENGTH = 512
// A throwaway base for resolving `next`: anything that escapes it is not same-origin.
const PROBE_ORIGIN = 'https://staff.invalid'

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function parseStaffRoute(pathname: string, search: string): StaffRoute {
  if (!isStaffPath(pathname)) return { name: 'not_found' }
  const segments = pathname.split('/').filter(Boolean).slice(1)

  if (segments.length === 0) return { name: 'board', filters: parseBoardFilters(search) }
  if (segments.length === 1 && segments[0] === 'products') {
    return { name: 'products', filters: parseProductFilters(search) }
  }
  if (segments.length === 1 && segments[0] === 'login') {
    return { name: 'login', next: sanitizeNext(new URLSearchParams(search).get('next')) }
  }
  if (segments.length === 2 && segments[0] === 'orders') {
    const number = safeDecode(segments[1] ?? '')
    if (number && ORDER_NUMBER.test(number)) return { name: 'order', number }
  }
  return { name: 'not_found' }
}

export function staffHref(route: StaffRoute): string {
  switch (route.name) {
    case 'board':
      return `${STAFF_HOME}${boardSearch(route.filters)}`
    case 'order':
      return `${STAFF_HOME}/orders/${encodeURIComponent(route.number)}`
    case 'products':
      return `${STAFF_HOME}/products${productsSearch(route.filters)}`
    case 'login':
      return loginHref(route.next)
    case 'not_found':
      return STAFF_HOME
  }
}

export function loginHref(next: string): string {
  const safe = sanitizeNext(next)
  return safe === STAFF_HOME
    ? `${STAFF_HOME}/login`
    : `${STAFF_HOME}/login?${new URLSearchParams({ next: safe }).toString()}`
}

/**
 * Returns `raw` when it is a same-origin path inside /admin, else "/admin". This blocks
 * open redirects such as "//evil.com", "https://evil.com", "/admin@evil", "/\evil.com" and
 * "/admin/../", and a loop back to the login page.
 */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_NEXT_LENGTH) return STAFF_HOME
  // Backslashes act as slashes in URL parsing; whitespace and control characters are
  // stripped by it. Neither belongs in a path we generate, so refuse them outright.
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return STAFF_HOME
  // "/admin" followed by the end, "/", "?" or "#". Rejects "/administrator", "/admin@x".
  if (!/^\/admin(?=$|[/?#])/.test(raw)) return STAFF_HOME
  if (raw.includes('//')) return STAFF_HOME

  let url: URL
  try {
    url = new URL(raw, PROBE_ORIGIN)
  } catch {
    return STAFF_HOME
  }
  // Dot segments (also "%2e%2e") are resolved by URL; whatever is left must still be ours.
  if (url.origin !== PROBE_ORIGIN || !isStaffPath(url.pathname)) return STAFF_HOME
  if (url.pathname === '/admin/login' || url.pathname.startsWith('/admin/login/')) {
    return STAFF_HOME
  }
  return `${url.pathname}${url.search}${url.hash}`
}

let lastBoardSearch = ''

/** The board remembers its filters, so "Все заказы" on an order page returns to them. */
export function rememberBoardSearch(search: string): void {
  lastBoardSearch = search
}

export function lastBoardHref(): string {
  return `${STAFF_HOME}${lastBoardSearch}`
}

/** A key that changes only when the page changes, not when its filters change. */
export function staffPageKey(route: StaffRoute): string {
  return route.name === 'order' ? `order:${route.number}` : route.name
}
