import { Trash } from 'lucide-react'
import { useAnnounce } from '../a11y/announce'
import { maxFor } from '../cart/cartReducer'
import type { CartLine } from '../cart/cartReducer'
import { useCart } from '../cart/context'
import { useI18n } from '../i18n/context'
import { toMinor } from '../lib/money'
import { ProductMedia } from './ProductMedia'
import { QuantityStepper } from './QuantityStepper'

export function CartLineItem({ line }: { line: CartLine }) {
  const { t, name, money, som } = useI18n()
  const cart = useCart()
  const announce = useAnnounce()
  const { product, quantity, unavailable, adjustedFrom } = line
  const title = name(product)
  const max = maxFor(product)
  const lineTotal = toMinor(product.price) * quantity

  return (
    <li className={`cart-line${unavailable ? ' cart-line--unavailable' : ''}`}>
      <ProductMedia
        imageUrl={product.image_url}
        categorySlug={product.category_slug}
        variant="thumb"
      />
      <div className="cart-line__info">
        <p className="cart-line__name">{title}</p>
        <p className="cart-line__meta">
          {t('common.priceUnit', { price: money(product.price), unit: product.unit })}
        </p>
        {unavailable && <p className="cart-line__warning">{t('cart.unavailable')}</p>}
        {!unavailable && adjustedFrom !== null && (
          <p className="cart-line__warning">{t('cart.adjusted', { count: quantity })}</p>
        )}
      </div>
      <div className="cart-line__side">
        {unavailable ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => cart.remove(product)}
            aria-label={t('cart.remove', { name: title })}
          >
            <Trash aria-hidden="true" />
          </button>
        ) : (
          <>
            <p className="cart-line__total">{som(lineTotal)}</p>
            <QuantityStepper
              name={title}
              quantity={quantity}
              max={max}
              size="sm"
              onChange={(next) => cart.setQuantity(product, next)}
              onMaxReached={() => announce(t('product.maxReached', { count: max }))}
            />
          </>
        )}
      </div>
    </li>
  )
}
