import { ClipboardList, ExternalLink, LogOut, Package } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAnnounce } from '../../a11y/announce'
import { IS_MOCK } from '../../api'
import { DemoBanner } from '../../components/Banners'
import { BrandMark } from '../../components/BrandMark'
import { Link } from '../../components/Link'
import { staffApi } from '../client'
import { StaffContext } from '../context'
import type { StaffContextValue } from '../context'
import { REFRESH_MS, useVisibleInterval } from '../hooks'
import { S } from '../strings'
import type { OrdersSummary, StaffUser } from '../types'
import { StoreSwitch } from './StoreSwitch'

type Section = 'orders' | 'products' | null

interface StaffShellProps {
  user: StaffUser
  backofficeUrl: string | null
  section: Section
  /** The orders board announces its own arrivals; elsewhere the shell does it. */
  onBoard: boolean
  onLogout: () => Promise<void>
  children: ReactNode
}

export function StaffShell({
  user,
  backofficeUrl,
  section,
  onBoard,
  onLogout,
  children,
}: StaffShellProps) {
  const announce = useAnnounce()
  const shellRef = useRef<HTMLDivElement>(null)
  const canViewOrders = user.permissions.view_orders
  const [summary, setSummary] = useState<OrdersSummary | null>(null)
  const [summaryTick, setSummaryTick] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const lastNewCount = useRef<number | null>(null)
  const onBoardRef = useRef(onBoard)

  useEffect(() => {
    onBoardRef.current = onBoard
  }, [onBoard])

  useEffect(() => {
    if (!canViewOrders) return
    const controller = new AbortController()
    staffApi.getSummary(controller.signal).then(
      (next) => {
        const previous = lastNewCount.current
        lastNewCount.current = next.new
        if (previous !== null && next.new > previous && !onBoardRef.current) {
          announce(S.newOrdersAnnounce(next.new))
        }
        setSummary(next)
      },
      () => {
        // A failed badge refresh keeps the last counts; pages show their own errors.
      },
    )
    return () => controller.abort()
  }, [canViewOrders, summaryTick, announce])

  const refreshSummary = useCallback(() => setSummaryTick((value) => value + 1), [])
  useVisibleInterval(refreshSummary, REFRESH_MS, canViewOrders)

  const getShell = useCallback(() => shellRef.current, [])
  const context = useMemo<StaffContextValue>(
    () => ({ user, backofficeUrl, summary, refreshSummary, getShell }),
    [user, backofficeUrl, summary, refreshSummary, getShell],
  )

  const newCount = canViewOrders ? (summary?.new ?? 0) : 0
  const permissions = user.permissions

  async function logout() {
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <StaffContext value={context}>
      <div ref={shellRef} className="app staff-app">
        <a className="skip-link" href="#staff-main">
          {S.skip}
        </a>
        {IS_MOCK && <DemoBanner />}
        <header className="staff-header">
          <div className="container staff-header__inner">
            <Link to="/admin" className="brand staff-brand" aria-label={S.home}>
              <BrandMark size={40} />
              <span className="brand__text">
                <span className="brand__name">
                  {S.brand} <span className="brand__accent">{S.brandAccent}</span>
                </span>
                <span className="staff-brand__area">{S.area}</span>
              </span>
            </Link>

            <nav className="staff-nav" aria-label={S.nav.label}>
              {permissions.view_orders && (
                <Link
                  to="/admin"
                  className="staff-nav__link"
                  aria-current={section === 'orders' ? 'page' : undefined}
                >
                  <ClipboardList aria-hidden="true" />
                  <span>{S.nav.orders}</span>
                  {newCount > 0 && (
                    <span className="staff-nav__badge">
                      <span aria-hidden="true">{newCount}</span>
                      <span className="visually-hidden">, {S.nav.newOrders(newCount)}</span>
                    </span>
                  )}
                </Link>
              )}
              {permissions.view_products && (
                <Link
                  to="/admin/products"
                  className="staff-nav__link"
                  aria-current={section === 'products' ? 'page' : undefined}
                >
                  <Package aria-hidden="true" />
                  <span>{S.nav.products}</span>
                </Link>
              )}
            </nav>

            <div className="staff-user" aria-label={S.nav.userMenu} role="group">
              <span className="staff-user__name" title={S.nav.signedInAs(user.display_name)}>
                {user.display_name || user.username}
              </span>
              {user.is_superuser && backofficeUrl && (
                <a className="btn btn--ghost btn--sm staff-user__advanced" href={backofficeUrl}>
                  <ExternalLink aria-hidden="true" />
                  <span>{S.nav.advanced}</span>
                </a>
              )}
              <button
                type="button"
                className="btn btn--outline btn--sm staff-user__logout"
                onClick={logout}
                disabled={loggingOut}
              >
                <LogOut aria-hidden="true" />
                <span>{loggingOut ? S.nav.loggingOut : S.nav.logout}</span>
              </button>
            </div>
          </div>
          {permissions.pause_orders && permissions.view_orders && (
            <div className="staff-header__bar">
              <div className="container">
                <StoreSwitch />
              </div>
            </div>
          )}
        </header>
        <main id="staff-main" className="main staff-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </StaffContext>
  )
}
