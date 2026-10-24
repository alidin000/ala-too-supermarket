import { ChevronRight, Receipt } from 'lucide-react'
import { Link } from '../components/Link'
import { useI18n } from '../i18n/context'
import { useRecentOrders } from '../lib/recentOrders'
import { catalogRoute } from '../lib/router'

export function OrdersPage() {
  const { t, money, dateTime } = useI18n()
  const orders = useRecentOrders()

  return (
    <div className="container page orders-page">
      <h1 id="page-title" className="page-title" tabIndex={-1}>
        {t('orders.title')}
      </h1>
      <p className="muted">{t('orders.hint')}</p>
      {orders.length === 0 ? (
        <div className="state-panel">
          <span className="empty-illustration" aria-hidden="true">
            <Receipt strokeWidth={1.5} />
          </span>
          <p className="state-panel__title">{t('orders.empty')}</p>
          <p className="muted">{t('orders.emptyHint')}</p>
          <Link to={catalogRoute()} className="btn btn--primary">
            {t('cart.toCatalog')}
          </Link>
        </div>
      ) : (
        <ul className="orders-list" role="list">
          {orders.map((order) => (
            <li key={order.token}>
              <Link to={{ name: 'order', token: order.token }} className="orders-list__item">
                <span className="orders-list__number">{order.number}</span>
                <span className="orders-list__meta">
                  {dateTime(order.createdAt)} · {money(order.total)}
                </span>
                <span className="orders-list__open">
                  {t('orders.open')}
                  <ChevronRight aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
