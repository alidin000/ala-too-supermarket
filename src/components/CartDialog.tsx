import { ShoppingBasket, X } from 'lucide-react'
import { useCart } from '../cart/context'
import { defaultFulfillment, useStoreConfig } from '../config/context'
import { useI18n } from '../i18n/context'
import { computeTotals } from '../lib/pricing'
import { CartLineItem } from './CartLineItem'
import { DeliveryProgress } from './DeliveryProgress'
import { Dialog } from './Dialog'
import { Notice } from './Notice'

interface CartDialogProps {
  open: boolean
  onClose: () => void
  onCheckout: () => void
}

export function CartDialog({ open, onClose, onCheckout }: CartDialogProps) {
  const { t, som } = useI18n()
  const cart = useCart()
  const { config, rules } = useStoreConfig()
  const isEmpty = cart.lines.length === 0
  const fulfillment = defaultFulfillment(config)
  const totals = rules ? computeTotals(cart.subtotal, fulfillment, rules) : null
  const closed = config !== null && !config.is_accepting_orders
  const blocked = closed || cart.count === 0 || (totals !== null && totals.minOrderShortfall > 0)

  return (
    <Dialog open={open} onClose={onClose} labelledBy="cart-title" className="cart-dialog">
      <div className="cart-dialog__header">
        <h2 id="cart-title" className="cart-dialog__title">
          {t('cart.title')}
          {cart.count > 0 && (
            <span className="cart-dialog__count">{t('cart.count', { count: cart.count })}</span>
          )}
        </h2>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label={t('cart.close')}
          data-autofocus
        >
          <X aria-hidden="true" />
        </button>
      </div>

      {isEmpty ? (
        <div className="cart-dialog__empty">
          <span className="empty-illustration" aria-hidden="true">
            <ShoppingBasket strokeWidth={1.5} />
          </span>
          <p className="cart-dialog__empty-title">{t('cart.empty')}</p>
          <p className="muted">{t('cart.emptyHint')}</p>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('cart.toCatalog')}
          </button>
        </div>
      ) : (
        <>
          <div className="cart-dialog__body">
            {cart.hasUnavailable && (
              <Notice
                tone="warning"
                action={
                  <button
                    type="button"
                    className="btn btn--sm btn--outline"
                    onClick={cart.removeUnavailable}
                  >
                    {t('cart.removeUnavailable')}
                  </button>
                }
              >
                <p>{t('cart.unavailableNotice')}</p>
              </Notice>
            )}
            <ul className="cart-lines" role="list">
              {cart.lines.map((line) => (
                <CartLineItem key={line.product.id} line={line} />
              ))}
            </ul>
          </div>

          <div className="cart-dialog__footer">
            {rules && fulfillment === 'delivery' && (
              <DeliveryProgress subtotal={cart.subtotal} rules={rules} />
            )}
            {totals && totals.minOrderShortfall > 0 && (
              <Notice tone="info">
                <p>
                  {t('cart.minOrder', {
                    amount: som(rules?.minOrderTotal ?? 0),
                    left: som(totals.minOrderShortfall),
                  })}
                </p>
              </Notice>
            )}
            {closed && (
              <Notice tone="warning">
                <p>{t('cart.closed')}</p>
              </Notice>
            )}
            <dl className="totals">
              <div className="totals__row totals__row--grand">
                <dt>{t('cart.subtotal')}</dt>
                <dd>{som(cart.subtotal)}</dd>
              </div>
            </dl>
            {rules && config?.fulfillment.delivery_enabled && rules.deliveryFee > 0 && (
              <p className="totals__note">
                {rules.freeDeliveryFrom !== null
                  ? t('cart.deliveryRule', {
                      fee: som(rules.deliveryFee),
                      amount: som(rules.freeDeliveryFrom),
                    })
                  : t('cart.deliveryFlat', { fee: som(rules.deliveryFee) })}
              </p>
            )}
            <button
              type="button"
              className="btn btn--primary btn--lg btn--block"
              onClick={onCheckout}
              disabled={blocked}
            >
              {t('cart.checkout')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
