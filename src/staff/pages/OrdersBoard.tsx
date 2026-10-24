import { Bike, Inbox, Phone, RefreshCw, Store } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAnnounce } from '../../a11y/announce'
import { isAbortError } from '../../api/errors'
import { Link } from '../../components/Link'
import { formatMoney } from '../../lib/money'
import { displayPhone, telHref } from '../../lib/phone'
import { navigateTo } from '../../lib/router'
import { readStorage, writeStorage } from '../../lib/storage'
import { isStaffApiError } from '../api'
import {
  arrivedOrders,
  BOARD_TABS,
  boardListQuery,
  boardSearch,
  DEFAULT_BOARD_FILTERS,
  isUnseen,
  mergeRefreshedPage,
  parseBoardFilters,
  tabCount,
  timeOf,
} from '../boardQuery'
import type { BoardFilters, BoardTab } from '../boardQuery'
import { staffApi } from '../client'
import { PaymentBadge, StatusBadge } from '../components/Badges'
import { SearchField } from '../components/SearchField'
import { Forbidden, LoadError } from '../components/StatePanels'
import { useStaff } from '../context'
import { absoluteTime, clockTime, relativeTime } from '../format'
import { REFRESH_MS, useMediaQuery, useNow, useStaffTitle, useVisibleInterval } from '../hooks'
import { rememberBoardSearch, staffHref } from '../routes'
import { S } from '../strings'
import type { StaffOrderRow } from '../types'

const PAGE_SIZE = 25
// Not a credential: the newest order time this browser has shown, for "new since last view".
const SEEN_KEY = 'ala-too:staff:orders-seen-until'

function readSeen(): number | null {
  const value = Number(readStorage(SEEN_KEY))
  return Number.isFinite(value) && value > 0 ? value : null
}

function newestTime(rows: readonly StaffOrderRow[]): number | null {
  const times = rows.map((row) => timeOf(row.created_at)).filter(Number.isFinite)
  return times.length > 0 ? Math.max(...times) : null
}

interface BoardData {
  key: string
  rows: StaffOrderRow[]
  count: number
  /** Pages loaded so far with "load more". */
  pages: number
  loadedAt: number
  /** The last auto-refresh failed; the rows are from an earlier load. */
  stale: boolean
}

export function OrdersBoard({ filters }: { filters: BoardFilters }) {
  useStaffTitle(S.board.title)
  const { user, summary, refreshSummary } = useStaff()
  const announce = useAnnounce()
  const canView = user.permissions.view_orders
  const key = boardSearch(filters)
  const wide = useMediaQuery('(min-width: 900px)')
  const now = useNow()

  const [tick, setTick] = useState(0)
  const [data, setData] = useState<BoardData | null>(null)
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null)
  const [more, setMore] = useState({ loading: false, failed: false })
  const [since, setSince] = useState<number | null>(readSeen)
  const latest = useRef<BoardData | null>(null)

  useEffect(() => {
    latest.current = data
  }, [data])

  useEffect(() => {
    rememberBoardSearch(key)
  }, [key])

  useEffect(() => {
    if (!canView) return
    const controller = new AbortController()
    staffApi.listOrders(boardListQuery(parseBoardFilters(key), 1), controller.signal).then(
      (page) => {
        const previous = latest.current
        const sameView = previous?.key === key
        const rows = sameView
          ? mergeRefreshedPage(previous.rows, page.results, PAGE_SIZE)
          : page.results
        if (sameView) {
          const arrived = arrivedOrders(previous.rows, page.results)
          if (arrived.length > 0) {
            announce(S.board.arrived(arrived.length, arrived.map((row) => row.number).join(', ')))
          }
        }
        setData({
          key,
          rows,
          count: page.count,
          pages: sameView ? previous.pages : 1,
          loadedAt: Date.now(),
          stale: false,
        })
        setFailure(null)
        const newest = newestTime(rows)
        // First visit on this browser: everything on screen now counts as seen.
        setSince((current) => current ?? newest ?? Date.now())
        if (newest !== null) writeStorage(SEEN_KEY, String(Math.max(newest, readSeen() ?? 0)))
      },
      (error: unknown) => {
        if (isAbortError(error)) return
        const previous = latest.current
        if (previous?.key === key) setData({ ...previous, stale: true })
        else setFailure({ key, error })
      },
    )
    return () => controller.abort()
  }, [key, tick, canView, announce])

  const refresh = useCallback(() => setTick((value) => value + 1), [])
  useVisibleInterval(refresh, REFRESH_MS, canView)

  const setFilters = (next: BoardFilters) =>
    navigateTo(staffHref({ name: 'board', filters: next }), { replace: true })
  const onSearch = useCallback(
    (q: string) =>
      navigateTo(staffHref({ name: 'board', filters: { ...filters, q } }), { replace: true }),
    [filters],
  )

  async function loadMore() {
    const current = data
    if (!current || more.loading) return
    setMore({ loading: true, failed: false })
    try {
      const page = await staffApi.listOrders(boardListQuery(filters, current.pages + 1))
      setData((previous) => {
        if (!previous || previous.key !== current.key) return previous
        const known = new Set(previous.rows.map((row) => row.number))
        const added = page.results.filter((row) => !known.has(row.number))
        return {
          ...previous,
          rows: [...previous.rows, ...added],
          count: page.count,
          pages: current.pages + 1,
        }
      })
      setMore({ loading: false, failed: false })
      announce(S.board.shown(current.rows.length + page.results.length, page.count))
    } catch (error) {
      // DRF answers 404 for a page past the end: the list just got shorter meanwhile.
      if (isStaffApiError(error, 'not_found')) {
        setData((previous) => (previous ? { ...previous, count: previous.rows.length } : previous))
        setMore({ loading: false, failed: false })
      } else {
        setMore({ loading: false, failed: true })
      }
    }
  }

  const current = data?.key === key ? data : null
  const currentFailure = failure?.key === key ? failure.error : null
  const filtered =
    filters.tab !== DEFAULT_BOARD_FILTERS.tab || filters.paymentPending || filters.q !== ''

  let body: ReactNode
  if (!canView || isStaffApiError(currentFailure, 'forbidden')) {
    body = <Forbidden />
  } else if (!current && currentFailure) {
    body = <LoadError title={S.board.loadError} error={currentFailure} onRetry={refresh} />
  } else if (!current) {
    body = (
      <div className="staff-skeleton" aria-busy="true">
        <span className="visually-hidden">{S.loading}</span>
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} className="skeleton staff-skeleton__row" />
        ))}
      </div>
    )
  } else if (current.rows.length === 0) {
    body = (
      <div className="state-panel">
        <span className="empty-illustration" aria-hidden="true">
          <Inbox strokeWidth={1.5} />
        </span>
        <p className="state-panel__title">{S.board.emptyTitle}</p>
        <p className="muted">{filtered ? S.board.emptyFiltered : S.board.emptyActive}</p>
        {filtered && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => setFilters(DEFAULT_BOARD_FILTERS)}
          >
            {S.board.resetFilters}
          </button>
        )}
      </div>
    )
  } else {
    const rowProps = { since, now }
    body = (
      <>
        {current.rows.some((row) => isUnseen(row, since)) && (
          <p className="staff-legend">
            <span className="staff-unseen__dot" aria-hidden="true" /> {S.board.unseen}
          </p>
        )}
        {wide ? (
          <OrdersTable rows={current.rows} {...rowProps} />
        ) : (
          <ul className="staff-order-cards" role="list">
            {current.rows.map((row) => (
              <OrderCard key={row.number} row={row} {...rowProps} />
            ))}
          </ul>
        )}
        <div className="load-more">
          <p className="load-more__count">{S.board.shown(current.rows.length, current.count)}</p>
          {more.failed && (
            <p className="load-more__error" role="alert">
              {S.board.loadMoreError}
            </p>
          )}
          {current.rows.length < current.count && (
            <button
              type="button"
              className="btn btn--outline"
              onClick={loadMore}
              aria-disabled={more.loading || undefined}
            >
              {more.loading ? S.board.loadingMore : S.board.loadMore}
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="container page staff-page">
      <div className="staff-page__head">
        <h1 className="page-title staff-page__title" tabIndex={-1}>
          {S.board.title}
        </h1>
        {canView && (
          <div className="staff-refresh">
            {current && (
              <span className="staff-refresh__time muted">
                {S.board.updatedAt(clockTime(current.loadedAt))}
              </span>
            )}
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => {
                refresh()
                refreshSummary()
              }}
            >
              <RefreshCw aria-hidden="true" />
              {S.board.refresh}
            </button>
          </div>
        )}
      </div>

      {canView && (
        <div className="staff-filters">
          <ul className="chips staff-tabs" role="list" aria-label={S.board.tabsLabel}>
            {BOARD_TABS.map((tab) => (
              <li key={tab}>
                <TabChip
                  tab={tab}
                  count={tabCount(tab, summary)}
                  pressed={filters.tab === tab}
                  onSelect={() => setFilters({ ...filters, tab })}
                />
              </li>
            ))}
          </ul>
          <div className="staff-filters__row">
            <button
              type="button"
              className="chip staff-chip--payment"
              aria-pressed={filters.paymentPending}
              onClick={() => setFilters({ ...filters, paymentPending: !filters.paymentPending })}
            >
              {S.board.paymentChip}
              {summary && summary.payment_pending > 0 && (
                <span className="staff-chip__count">{summary.payment_pending}</span>
              )}
            </button>
            <SearchField
              id="board-search"
              label={S.board.searchLabel}
              placeholder={S.board.searchPlaceholder}
              clearLabel={S.board.clearSearch}
              value={filters.q}
              onSearch={onSearch}
            />
          </div>
          <p className="staff-hint muted">{S.board.autoRefresh}</p>
          {current?.stale && (
            <p className="staff-stale" role="status">
              {S.board.refreshError}
            </p>
          )}
        </div>
      )}

      {body}
    </div>
  )
}

function TabChip({
  tab,
  count,
  pressed,
  onSelect,
}: {
  tab: BoardTab
  count: number | null
  pressed: boolean
  onSelect: () => void
}) {
  const label = S.board.tabs[tab]
  return (
    <button
      type="button"
      className="chip staff-tab"
      aria-pressed={pressed}
      aria-label={count === null ? undefined : S.board.tabWithCount(label, count)}
      onClick={onSelect}
    >
      {label}
      {count !== null && (
        <span className={`staff-chip__count${count === 0 ? ' staff-chip__count--zero' : ''}`}>
          {count}
        </span>
      )}
    </button>
  )
}

interface RowProps {
  row: StaffOrderRow
  since: number | null
  now: number
}

function FulfillmentText({ row }: { row: StaffOrderRow }) {
  const Icon = row.fulfillment === 'delivery' ? Bike : Store
  return (
    <span className="staff-fulfillment">
      <Icon aria-hidden="true" />
      {S.fulfillment[row.fulfillment]} · {S.board.itemsCount(row.items_count)}
    </span>
  )
}

function PhoneLink({ phone }: { phone: string }) {
  if (!phone) return null
  const shown = displayPhone(phone)
  return (
    <a className="staff-tel" href={telHref(phone)} aria-label={S.board.call(shown)}>
      <Phone aria-hidden="true" />
      <span>{shown}</span>
    </a>
  )
}

/** The order number, with a dot for "new since the last view" read after the number. */
function OrderNumber({ number, unseen }: { number: string; unseen: boolean }) {
  return (
    <>
      {unseen && (
        <span className="staff-unseen" title={S.board.unseen} aria-hidden="true">
          <span className="staff-unseen__dot" />
        </span>
      )}
      {number}
      {unseen && <span className="visually-hidden">, {S.board.unseen.toLowerCase()}</span>}
    </>
  )
}

function OrderTime({ iso, now }: { iso: string; now: number }) {
  return (
    <time dateTime={iso} className="staff-time">
      <span className="staff-time__relative">{relativeTime(iso, now)}</span>
      <span className="staff-time__absolute">{absoluteTime(iso, now)}</span>
    </time>
  )
}

function OrderCard({ row, since, now }: RowProps) {
  const unseen = isUnseen(row, since)
  return (
    <li className={`staff-order-card${unseen ? ' is-unseen' : ''}`}>
      <div className="staff-order-card__top">
        <Link
          to={staffHref({ name: 'order', number: row.number })}
          className="staff-order-card__number"
        >
          <OrderNumber number={row.number} unseen={unseen} />
        </Link>
        <span className="staff-order-card__total">{formatMoney(row.total)}</span>
      </div>
      <div className="staff-order-card__badges">
        <StatusBadge status={row.status} />
        <PaymentBadge status={row.payment_status} method={row.payment_method} />
      </div>
      <OrderTime iso={row.created_at} now={now} />
      <p className="staff-order-card__customer">{row.customer_name}</p>
      <div className="staff-order-card__meta">
        <PhoneLink phone={row.phone} />
        <FulfillmentText row={row} />
      </div>
    </li>
  )
}

function OrdersTable({ rows, since, now }: Omit<RowProps, 'row'> & { rows: StaffOrderRow[] }) {
  const c = S.board.columns
  return (
    <div className="staff-table-wrap">
      <table className="staff-table">
        <caption className="visually-hidden">{S.board.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{c.number}</th>
            <th scope="col">{c.time}</th>
            <th scope="col">{c.customer}</th>
            <th scope="col">{c.phone}</th>
            <th scope="col">{c.fulfillment}</th>
            <th scope="col" className="staff-table__num">
              {c.total}
            </th>
            <th scope="col">{c.status}</th>
            <th scope="col">{c.payment}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const unseen = isUnseen(row, since)
            return (
              <tr key={row.number} className={unseen ? 'is-unseen' : undefined}>
                <th scope="row">
                  <Link
                    to={staffHref({ name: 'order', number: row.number })}
                    className="staff-table__order"
                  >
                    <OrderNumber number={row.number} unseen={unseen} />
                  </Link>
                </th>
                <td>
                  <OrderTime iso={row.created_at} now={now} />
                </td>
                <td className="staff-table__name">{row.customer_name}</td>
                <td>
                  <PhoneLink phone={row.phone} />
                </td>
                <td>
                  <FulfillmentText row={row} />
                </td>
                <td className="staff-table__num">{formatMoney(row.total)}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>
                  <PaymentBadge status={row.payment_status} method={row.payment_method} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
