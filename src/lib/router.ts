import { useMemo, useSyncExternalStore } from 'react'

// URL state instead of a router dependency.
//
// Customer routes are query-based and ignore the path:
//   /                          catalogue (optional ?category=<slug>&q=<text>)
//   /?view=checkout            checkout
//   /?view=orders              "Мои заказы", the orders saved on this device
//   /?order=<token>            one order, read by its secret token
//
// Staff routes are path-based and live under /admin (src/staff/routes.ts). Only the path
// check lives here, so the customer bundle can pick which app to render without loading
// any staff code.

export type Route =
  | { name: 'catalog'; category: string; q: string }
  | { name: 'checkout' }
  | { name: 'orders' }
  | { name: 'order'; token: string }

export type NavigationKind = 'initial' | 'push' | 'pop'

const NAVIGATE_EVENT = 'ala-too:navigate'
let lastNavigation: NavigationKind = 'initial'

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search)
  const token = params.get('order')?.trim()
  if (token) return { name: 'order', token: token.slice(0, 200) }
  const view = params.get('view')
  if (view === 'checkout') return { name: 'checkout' }
  if (view === 'orders') return { name: 'orders' }
  return {
    name: 'catalog',
    category: params.get('category')?.trim() ?? '',
    q: params.get('q')?.trim() ?? '',
  }
}

export function routeSearch(route: Route): string {
  const params = new URLSearchParams()
  switch (route.name) {
    case 'order':
      params.set('order', route.token)
      break
    case 'checkout':
    case 'orders':
      params.set('view', route.name)
      break
    case 'catalog':
      if (route.category) params.set('category', route.category)
      if (route.q) params.set('q', route.q)
      break
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function routeHref(route: Route): string {
  return `${import.meta.env.BASE_URL}${routeSearch(route)}`
}

export const catalogRoute = (category = '', q = ''): Route => ({ name: 'catalog', category, q })

/** True for /admin and everything below it: the staff panel, a separate lazy-loaded app. */
export function isStaffPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

/** Navigates in place to a same-origin href such as "/admin/orders/AT-1" or "/?view=orders". */
export function navigateTo(
  href: string,
  options: { replace?: boolean; state?: unknown } = {},
): void {
  if (options.replace) {
    window.history.replaceState(options.state ?? null, '', href)
  } else {
    lastNavigation = 'push'
    window.history.pushState(options.state ?? null, '', href)
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

export function navigate(route: Route, options: { replace?: boolean; state?: unknown } = {}): void {
  navigateTo(routeHref(route), options)
}

/** How the current page was reached, so the app can manage scroll and focus. */
export function lastNavigationKind(): NavigationKind {
  return lastNavigation
}

function subscribe(onChange: () => void): () => void {
  const onPop = () => {
    lastNavigation = 'pop'
    onChange()
  }
  window.addEventListener('popstate', onPop)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onPop)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

const getSearch = () => window.location.search
const getPathname = () => window.location.pathname
const getPathAndSearch = () => `${window.location.pathname}${window.location.search}`

export function useRoute(): Route {
  const search = useSyncExternalStore(subscribe, getSearch, () => '')
  return useMemo(() => parseRoute(search), [search])
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname, () => '/')
}

export interface LocationState {
  pathname: string
  search: string
}

/** The current path and query string; re-renders on navigation and back/forward. */
export function useLocation(): LocationState {
  const value = useSyncExternalStore(subscribe, getPathAndSearch, () => '/')
  return useMemo(() => {
    const index = value.indexOf('?')
    return index < 0
      ? { pathname: value, search: '' }
      : { pathname: value.slice(0, index), search: value.slice(index) }
  }, [value])
}
