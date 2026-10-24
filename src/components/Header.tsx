import { Receipt, ShoppingBasket } from 'lucide-react'
import { useCart } from '../cart/context'
import { useI18n } from '../i18n/context'
import { useRecentOrders } from '../lib/recentOrders'
import { catalogRoute } from '../lib/router'
import { BrandMark } from './BrandMark'
import { LanguageSwitch } from './LanguageSwitch'
import { Link } from './Link'

interface HeaderProps {
  cartOpen: boolean
  onOpenCart: () => void
  showCart: boolean
}

export function Header({ cartOpen, onOpenCart, showCart }: HeaderProps) {
  const { t } = useI18n()
  const { count } = useCart()
  const recentOrders = useRecentOrders()

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to={catalogRoute()} className="brand" aria-label={t('app.home')}>
          <BrandMark size={40} />
          <span className="brand__text">
            <span className="brand__name">
              Ала-Тоо <span className="brand__accent">Маркет</span>
            </span>
            <span className="brand__tagline">{t('app.tagline')}</span>
          </span>
        </Link>
        <nav className="site-header__nav" aria-label={t('app.mainNav')}>
          <LanguageSwitch />
          {recentOrders.length > 0 && (
            <Link to={{ name: 'orders' }} className="header-btn">
              <Receipt aria-hidden="true" />
              <span className="header-btn__label">{t('header.orders')}</span>
            </Link>
          )}
          {showCart && (
            <button
              type="button"
              className="header-btn header-btn--cart"
              onClick={onOpenCart}
              aria-haspopup="dialog"
              aria-expanded={cartOpen}
              aria-label={t('header.cartLabel', { count })}
            >
              <ShoppingBasket aria-hidden="true" />
              <span className="header-btn__label">{t('header.cart')}</span>
              {count > 0 && (
                <span className="header-btn__count" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}
