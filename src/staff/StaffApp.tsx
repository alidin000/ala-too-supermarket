import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAnnounce } from '../a11y/announce'
import { isAbortError } from '../api/errors'
import { lastNavigationKind, navigateTo, useLocation } from '../lib/router'
import { isStaffApiError } from './api'
import { staffApi } from './client'
import { LoadError, StaffNotFound } from './components/StatePanels'
import { StaffShell } from './components/StaffShell'
import { errorMessage } from './format'
import { useStaffTitle } from './hooks'
import { LoginPage } from './pages/LoginPage'
import { OrderDetail } from './pages/OrderDetail'
import { OrdersBoard } from './pages/OrdersBoard'
import { ProductsPage } from './pages/ProductsPage'
import { loginHref, parseStaffRoute, STAFF_HOME, staffPageKey } from './routes'
import type { StaffRoute } from './routes'
import { S } from './strings'
import type { StaffSession, StaffUser } from './types'
import './staff.css'

type SessionState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: StaffUser; backofficeUrl: string | null }

function toState(session: StaffSession): SessionState {
  return session.authenticated
    ? { status: 'authenticated', user: session.user, backofficeUrl: session.backofficeUrl }
    : { status: 'anonymous' }
}

const currentHref = () => `${window.location.pathname}${window.location.search}`
// The storefront title, read when this chunk first loads (before any staff page renames it).
const STOREFRONT_TITLE = document.title

/**
 * The staff panel at /admin: its own shell, Russian only, lazy-loaded so customers never
 * download it. The server is the real gate; this only decides what to show.
 */
export default function StaffApp() {
  const location = useLocation()
  const route = useMemo(
    () => parseStaffRoute(location.pathname, location.search),
    [location.pathname, location.search],
  )
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const announce = useAnnounce()

  useNoindexAndTitleRestore()

  useEffect(() => {
    const controller = new AbortController()
    staffApi.getSession(controller.signal).then(
      (next) => setSession(toState(next)),
      (error: unknown) => {
        if (!isAbortError(error)) setSession({ status: 'error', error })
      },
    )
    return () => controller.abort()
  }, [attempt])

  // Any 401 (session expired, logged out in another tab) leads to the login page.
  useEffect(() => {
    staffApi.setUnauthenticatedHandler(() => setSession({ status: 'anonymous' }))
    return () => staffApi.setUnauthenticatedHandler(null)
  }, [])

  // Not logged in on a protected page: go to login, then come back here.
  // Logged in on the login page: skip it.
  useEffect(() => {
    if (session.status === 'anonymous' && route.name !== 'login') {
      navigateTo(loginHref(currentHref()), { replace: true })
    } else if (session.status === 'authenticated' && route.name === 'login') {
      navigateTo(route.next, { replace: true })
    }
  }, [session.status, route])

  usePageFocus(route)

  const onLoggedIn = useCallback((next: StaffSession) => setSession(toState(next)), [])

  const onLogout = useCallback(async () => {
    try {
      await staffApi.logout()
    } catch (error) {
      // Already logged out (401) is fine; anything else keeps the session as it is.
      if (!isStaffApiError(error, 'unauthenticated')) {
        announce(errorMessage(error))
        return
      }
    }
    navigateTo(`${STAFF_HOME}/login`)
    setSession({ status: 'anonymous' })
  }, [announce])

  if (session.status === 'loading') return <StaffLoading />
  if (session.status === 'error') {
    return (
      <div className="app staff-login">
        <main id="staff-main" className="main staff-login__main">
          <div className="staff-login__card">
            <h1 className="staff-login__title" tabIndex={-1}>
              {S.login.title}
            </h1>
            <LoadError
              title={S.errors.sessionCheck}
              error={session.error}
              onRetry={() => {
                setSession({ status: 'loading' })
                setAttempt((value) => value + 1)
              }}
            />
          </div>
        </main>
      </div>
    )
  }
  if (session.status === 'anonymous') {
    return route.name === 'login' ? <LoginPage onLoggedIn={onLoggedIn} /> : <StaffLoading />
  }
  if (route.name === 'login') return <StaffLoading />

  return (
    <StaffShell
      user={session.user}
      backofficeUrl={session.backofficeUrl}
      section={
        route.name === 'products' ? 'products' : route.name === 'not_found' ? null : 'orders'
      }
      onBoard={route.name === 'board'}
      onLogout={onLogout}
    >
      <StaffPage route={route} />
    </StaffShell>
  )
}

function StaffPage({ route }: { route: Exclude<StaffRoute, { name: 'login' }> }) {
  switch (route.name) {
    case 'board':
      return <OrdersBoard filters={route.filters} />
    case 'order':
      return <OrderDetail key={route.number} number={route.number} />
    case 'products':
      return <ProductsPage filters={route.filters} />
    case 'not_found':
      return <NotFoundPage />
  }
}

function NotFoundPage() {
  useStaffTitle(S.notFound.title)
  return (
    <div className="container page staff-page">
      <h1 className="page-title staff-page__title" tabIndex={-1}>
        {S.notFound.title}
      </h1>
      <StaffNotFound title={S.notFound.title} text={S.notFound.text} />
    </div>
  )
}

function StaffLoading() {
  return (
    <div className="staff-boot" aria-busy="true">
      <span className="visually-hidden" role="status">
        {S.loading}
      </span>
      <span className="skeleton staff-boot__bar" />
    </div>
  )
}

/** Adds <meta name="robots" content="noindex"> while on /admin, and restores the title after. */
function useNoindexAndTitleRestore() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.append(meta)
    return () => {
      meta.remove()
      document.title = STOREFRONT_TITLE
    }
  }, [])
}

/**
 * On a page change, start at the top and move focus to the new page's heading, so
 * screen-reader and keyboard users know the page changed. Not on the first page load.
 */
function usePageFocus(route: StaffRoute) {
  const key = staffPageKey(route)
  const firstKey = useRef(key)
  useEffect(() => {
    if (key === firstKey.current) return
    firstKey.current = ''
    const kind = lastNavigationKind()
    if (kind === 'push') window.scrollTo({ top: 0 })
    // The page renders its heading at once, even while its data loads.
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('#staff-main h1')
        ?.focus({ preventScroll: kind === 'pop' })
    })
  }, [key])
}
