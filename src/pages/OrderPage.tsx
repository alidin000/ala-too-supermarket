import { CircleCheck, Clock, MapPin, Phone, RefreshCw, SearchX, User } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { api, ApiError, IS_MOCK, isAbortError } from '../api'
import type { Order, PaymentStatus } from '../api/types'
import { CopyButton } from '../components/CopyButton'
import { Link } from '../components/Link'
import { MbankPayment } from '../components/MbankPayment'
import { Notice } from '../components/Notice'
import { OrderTimeline } from '../components/OrderTimeline'
import { useStoreConfig } from '../config/context'
import { useI18n } from '../i18n/context'
import { METHOD_KEYS } from '../i18n/labels'
import type { MessageKey } from '../i18n/messages'
import { displayPhone, telHref } from '../lib/phone'
import { catalogRoute } from '../lib/router'

const POLL_MS = 30_000
const MIN_REFRESH_GAP_MS = 10_000

interface LoadState {
  token: string
  attempt: number
  order?: Order
  error?: unknown
  fetchedAt?: number
}

function paymentKey(order: Order): MessageKey {
  const keys: Record<PaymentStatus, MessageKey> = {
    unpaid: 'payment.unpaid',
    pending: 'payment.pending',
    paid: 'payment.paid',
    rejected: 'payment.rejected',
    refunded: 'payment.refunded',
  }
  return keys[order.payment_status]
}

function readPlacedFlag(): boolean {
  const state: unknown = window.history.state
  return Boolean(state && typeof state === 'object' && 'placed' in state && state.placed === true)
}

export function OrderPage({ token }: { token: string }) {
  const { t, money, dateTime, time } = useI18n()
  const { config } = useStoreConfig()
  const [placed] = useState(readPlacedFlag)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.getOrder(token, controller.signal).then(
      (order) => setState({ token, attempt, order, fetchedAt: Date.now() }),
      (error: unknown) => {
        if (isAbortError(error)) return
        setState((previous) => ({
          token,
          attempt,
          // Keep showing the last good data when a background refresh fails.
          order: previous?.token === token ? previous.order : undefined,
          fetchedAt: previous?.token === token ? previous.fetchedAt : undefined,
          error,
        }))
      },
    )
    return () => controller.abort()
  }, [token, attempt])

  const current = state?.token === token ? state : null
  const order = current?.order
  const refreshing = current === null || current.attempt !== attempt
  const active = order ? order.status !== 'completed' && order.status !== 'cancelled' : false

  const refreshIfStale = useEffectEvent(() => {
    const fetchedAt = current?.fetchedAt ?? 0
    if (!refreshing && Date.now() - fetchedAt >= MIN_REFRESH_GAP_MS) {
      setAttempt((value) => value + 1)
    }
  })
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshIfStale()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfStale()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])

  const title = (
    <h1 id="page-title" className="order-head__title" tabIndex={-1}>
      <span className="order-head__label">{t('order.titleLoading')}</span>{' '}
      {order && <span className="order-head__number">{order.number}</span>}
    </h1>
  )

  if (!order) {
    const notFound = current?.error instanceof ApiError && current.error.kind === 'not_found'
    return (
      <div className="container page order-page">
        <div className="order-head">{title}</div>
        {!current?.error ? (
          <div className="order-skeleton" aria-busy="true">
            <span className="skeleton skeleton--block" />
            <span className="skeleton skeleton--block" />
          </div>
        ) : notFound ? (
          <div className="state-panel">
            <span className="empty-illustration" aria-hidden="true">
              <SearchX strokeWidth={1.5} />
            </span>
            <p className="state-panel__title">{t('order.notFound')}</p>
            <p className="muted">{t('order.notFoundHint')}</p>
            <div className="state-panel__actions">
              <Link to={{ name: 'orders' }} className="btn btn--outline">
                {t('header.orders')}
              </Link>
              <Link to={catalogRoute()} className="btn btn--primary">
                {t('common.backToShop')}
              </Link>
            </div>
          </div>
        ) : (
          <Notice
            tone="danger"
            role="alert"
            title={t('order.loadError')}
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t('common.retry')}
              </button>
            }
          >
            <p>{t('catalog.errorHint')}</p>
          </Notice>
        )}
      </div>
    )
  }

  const cancelled = order.status === 'cancelled'
  const storePhone = config?.phone.trim() ?? ''
  const pickupAddress = config?.pickup_address.trim() ?? ''
  const hours = config?.opening_hours.trim() ?? ''
  const deliveryFee = Number(order.delivery_fee)

  return (
    <div className="container page order-page">
      {placed && (
        <div className="success-banner" role="status">
          <CircleCheck className="success-banner__icon" aria-hidden="true" />
          <div>
            <p className="success-banner__title">{t('order.thanks')}</p>
            <p>{t('order.thanksHint', { phone: displayPhone(order.phone) })}</p>
          </div>
        </div>
      )}
      {IS_MOCK && (
        <Notice tone="warning">
          <p>{t('order.demoNote')}</p>
        </Notice>
      )}

      <div className="order-head">
        <p className="eyebrow">{t('order.number')}</p>
        <div className="order-head__row">
          {title}
          <CopyButton value={order.number} label={t('order.copyNumber')} />
        </div>
        <p className="muted">{t('order.placedAt', { date: dateTime(order.created_at) })}</p>
      </div>

      <div className="order-grid">
        <section className="order-card" aria-labelledby="order-status-title">
          <h2 id="order-status-title" className="order-card__title">
            {t('order.status')}
          </h2>
          {cancelled ? (
            <Notice tone="danger" title={t('order.cancelledTitle')}>
              <p>{t('order.cancelledText')}</p>
              {storePhone && (
                <p>
                  <a href={telHref(storePhone)}>{displayPhone(storePhone)}</a>
                </p>
              )}
            </Notice>
          ) : (
            <OrderTimeline status={order.status} fulfillment={order.fulfillment} />
          )}
          <div className="order-card__meta">
            <p>
              {current?.fetchedAt ? t('order.updatedAt', { time: time(current.fetchedAt) }) : null}
              {active ? ` · ${t('order.autoRefresh')}` : null}
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setAttempt((value) => value + 1)}
              aria-disabled={refreshing || undefined}
            >
              <RefreshCw className={refreshing ? 'spin' : undefined} aria-hidden="true" />
              {t('order.refresh')}
            </button>
          </div>
          {current?.error !== undefined && (
            <p className="field__error" role="alert">
              {t('order.loadError')}
            </p>
          )}
        </section>

        <section className="order-card" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title" className="order-card__title">
            {t('order.payment')}
          </h2>
          <p className="order-card__line">
            <span>{t(METHOD_KEYS[order.payment_method])}</span>
            {!(order.payment_method === 'cash' && order.payment_status === 'unpaid') && (
              <span className={`status-chip status-chip--${order.payment_status}`}>
                {t(paymentKey(order))}
              </span>
            )}
          </p>
          {order.payment_method === 'mbank_transfer' && (
            <MbankPayment
              token={token}
              order={order}
              mbank={config?.payment.mbank ?? null}
              onUpdated={(updated) =>
                setState({ token, attempt, order: updated, fetchedAt: Date.now() })
              }
            />
          )}
        </section>

        <section className="order-card" aria-labelledby="order-receiving-title">
          <h2 id="order-receiving-title" className="order-card__title">
            {t('order.receiving')}
          </h2>
          <ul className="info-list" role="list">
            {order.fulfillment === 'delivery' ? (
              <li>
                <MapPin aria-hidden="true" />
                <span>
                  <span className="info-list__label">{t('order.deliveryTo')}</span>
                  {order.address}
                </span>
              </li>
            ) : (
              <li>
                <MapPin aria-hidden="true" />
                <span>
                  <span className="info-list__label">{t('order.pickup')}</span>
                  {pickupAddress || t('checkout.pickupUnknown')}
                </span>
              </li>
            )}
            {order.fulfillment === 'pickup' && hours && (
              <li>
                <Clock aria-hidden="true" />
                <span>
                  <span className="info-list__label">{t('order.hours')}</span>
                  {hours}
                </span>
              </li>
            )}
            <li>
              <User aria-hidden="true" />
              <span>
                <span className="info-list__label">{t('order.customer')}</span>
                {order.customer_name}, {displayPhone(order.phone)}
              </span>
            </li>
            {storePhone && (
              <li>
                <Phone aria-hidden="true" />
                <span>
                  <span className="info-list__label">{t('order.storePhone')}</span>
                  <a href={telHref(storePhone)}>{displayPhone(storePhone)}</a>
                </span>
              </li>
            )}
          </ul>
          {order.customer_note && (
            <p className="order-card__note">
              <span className="info-list__label">{t('order.note')}</span>
              {order.customer_note}
            </p>
          )}
        </section>

        <section className="order-card order-card--items" aria-labelledby="order-items-title">
          <h2 id="order-items-title" className="order-card__title">
            {t('order.items')}
          </h2>
          <ul className="summary-lines" role="list">
            {order.items.map((item, index) => (
              <li key={`${item.sku}-${index}`}>
                <span className="summary-lines__name">
                  {item.product_name}
                  <span className="summary-lines__qty">
                    {' '}
                    × {item.quantity} · {money(item.unit_price)}
                  </span>
                </span>
                <span className="summary-lines__total">{money(item.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="totals">
            <div className="totals__row">
              <dt>{t('cart.subtotal')}</dt>
              <dd>{money(order.subtotal)}</dd>
            </div>
            {order.fulfillment === 'delivery' && (
              <div className="totals__row">
                <dt>{t('cart.delivery')}</dt>
                <dd>{deliveryFee === 0 ? t('common.free') : money(order.delivery_fee)}</dd>
              </div>
            )}
            <div className="totals__row totals__row--grand">
              <dt>{t('cart.total')}</dt>
              <dd>{money(order.total)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <p className="order-page__back">
        <Link to={catalogRoute()} className="btn btn--outline">
          {t('common.backToShop')}
        </Link>
      </p>
    </div>
  )
}
