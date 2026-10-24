import { ChevronRight, ShoppingBasket } from 'lucide-react'
import { useCart } from '../cart/context'
import { useI18n } from '../i18n/context'

/** Sticky bottom bar on phones: always one tap from the cart. */
export function CartBar({ onOpen, cartOpen }: { onOpen: () => void; cartOpen: boolean }) {
  const { t, som } = useI18n()
  const { count, subtotal } = useCart()
  if (count === 0) return null
  return (
    <div className="cart-bar">
      <button
        type="button"
        className="cart-bar__button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={cartOpen}
      >
        <span className="cart-bar__icon" aria-hidden="true">
          <ShoppingBasket />
          <span className="cart-bar__badge">{count}</span>
        </span>
        <span className="cart-bar__text">
          <span className="cart-bar__label">{t('cart.title')}</span>
          <span className="cart-bar__meta">{t('cart.count', { count })}</span>
        </span>
        <span className="cart-bar__total">{som(subtotal)}</span>
        <ChevronRight className="cart-bar__chevron" aria-hidden="true" />
      </button>
    </div>
  )
}
