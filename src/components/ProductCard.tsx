import { Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAnnounce } from '../a11y/announce'
import type { Product } from '../api/types'
import { maxFor } from '../cart/cartReducer'
import { useCart } from '../cart/context'
import { useI18n } from '../i18n/context'
import { BADGE_KEYS } from '../i18n/labels'
import { ProductMedia } from './ProductMedia'
import { QuantityStepper } from './QuantityStepper'

export function ProductCard({ product }: { product: Product }) {
  const { t, name, money } = useI18n()
  const cart = useCart()
  const announce = useAnnounce()
  const quantity = cart.quantityOf(product.id)
  const max = maxFor(product)
  const title = name(product)
  const headingId = `product-${product.id}-name`

  // The add button and the stepper replace each other; keep keyboard focus on the control.
  const addRef = useRef<HTMLButtonElement>(null)
  const increaseRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<'add' | 'increase' | null>(null)
  useEffect(() => {
    const target = pendingFocus.current === 'add' ? addRef.current : increaseRef.current
    if (pendingFocus.current && target) {
      target.focus()
      pendingFocus.current = null
    }
  }, [quantity])

  return (
    <article
      className={`product-card${product.in_stock ? '' : ' product-card--out'}`}
      aria-labelledby={headingId}
    >
      <div className="product-card__media">
        <ProductMedia
          imageUrl={product.image_url}
          categorySlug={product.category_slug}
          variant="card"
        />
        {product.badge && (
          <span className={`badge badge--${product.badge}`}>{t(BADGE_KEYS[product.badge])}</span>
        )}
      </div>
      <div className="product-card__body">
        <h3 id={headingId} className="product-card__name">
          {title}
        </h3>
        <p className="product-card__unit">{product.unit}</p>
        <p className="product-card__price">{money(product.price)}</p>
        <div className="product-card__action">
          {!product.in_stock ? (
            <p className="product-card__soldout">{t('product.outOfStock')}</p>
          ) : quantity === 0 ? (
            <button
              ref={addRef}
              type="button"
              className="btn btn--soft btn--block"
              onClick={() => {
                pendingFocus.current = 'increase'
                cart.add(product)
              }}
              aria-label={t('product.addAria', { name: title })}
            >
              <Plus aria-hidden="true" />
              {t('product.add')}
            </button>
          ) : (
            <QuantityStepper
              name={title}
              quantity={quantity}
              max={max}
              increaseRef={increaseRef}
              onChange={(next) => {
                if (next <= 0) pendingFocus.current = 'add'
                cart.setQuantity(product, next)
              }}
              onMaxReached={() => announce(t('product.maxReached', { count: max }))}
            />
          )}
        </div>
      </div>
    </article>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="product-card product-card--skeleton" aria-hidden="true">
      <div className="product-card__media skeleton" />
      <div className="product-card__body">
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line skeleton--short" />
        <span className="skeleton skeleton--line skeleton--price" />
        <span className="skeleton skeleton--button" />
      </div>
    </div>
  )
}
