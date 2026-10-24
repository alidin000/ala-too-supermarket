import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { AnnouncerProvider } from './a11y/Announcer'
import { IS_MOCK } from './api'
import { CartProvider } from './cart/CartProvider'
import { ClosedBanner, DemoBanner } from './components/Banners'
import { CartBar } from './components/CartBar'
import { CartDialog } from './components/CartDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { StoreConfigProvider } from './config/StoreConfigProvider'
import { useI18n } from './i18n/context'
import { I18nProvider } from './i18n/I18nProvider'
import { isStaffPath, lastNavigationKind, navigate, usePathname, useRoute } from './lib/router'
import type { Route } from './lib/router'
import { CatalogPage } from './pages/CatalogPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { OrderPage } from './pages/OrderPage'
import { OrdersPage } from './pages/OrdersPage'

// The staff panel (/admin) is a separate chunk: customers never download it.
const StaffApp = lazy(() => import('./staff/StaffApp'))

export default function App() {
  const staff = isStaffPath(usePathname())
  return (
    // The staff panel is Russian-only; the customer's saved language choice is kept.
    <I18nProvider lockedLang={staff ? 'ru' : undefined}>
      <AnnouncerProvider>
        {staff ? (
          <ErrorBoundary resetKey="staff">
            <Suspense fallback={<PanelLoading />}>
              <StaffApp />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <StoreConfigProvider>
            <CartProvider>
              <Shell />
            </CartProvider>
          </StoreConfigProvider>
        )}
      </AnnouncerProvider>
    </I18nProvider>
  )
}

function PanelLoading() {
  const { t } = useI18n()
  return (
    <div className="container page" aria-busy="true">
      <span className="visually-hidden" role="status">
        {t('catalog.loadingMore')}
      </span>
      <span className="skeleton skeleton--block" />
    </div>
  )
}

/** Changes only when the page changes, not when catalogue filters change. */
function pageKey(route: Route): string {
  return route.name === 'order' ? `order:${route.token}` : route.name
}

function Shell() {
  const { t } = useI18n()
  const route = useRoute()
  const [cartOpen, setCartOpen] = useState(false)
  const key = pageKey(route)

  // On a page change, start at the top and move focus to the new page's heading, so
  // screen-reader and keyboard users know the page changed.
  useEffect(() => {
    const kind = lastNavigationKind()
    if (kind === 'initial') return
    if (kind === 'push') window.scrollTo({ top: 0 })
    document.querySelector<HTMLElement>('#main h1')?.focus({ preventScroll: kind === 'pop' })
  }, [key])

  const openCart = useCallback(() => setCartOpen(true), [])
  const closeCart = useCallback(() => setCartOpen(false), [])
  const goToCheckout = useCallback(() => {
    setCartOpen(false)
    navigate({ name: 'checkout' })
  }, [])

  const onCheckout = route.name === 'checkout'

  return (
    <>
      <div className="app" inert={cartOpen}>
        <a className="skip-link" href="#main">
          {t('app.skip')}
        </a>
        {IS_MOCK && <DemoBanner />}
        <Header cartOpen={cartOpen} onOpenCart={openCart} showCart={!onCheckout} />
        <ClosedBanner />
        <main id="main" className="main" tabIndex={-1}>
          <ErrorBoundary resetKey={key}>
            {route.name === 'catalog' && <CatalogPage category={route.category} q={route.q} />}
            {route.name === 'checkout' && <CheckoutPage />}
            {route.name === 'orders' && <OrdersPage />}
            {route.name === 'order' && <OrderPage key={route.token} token={route.token} />}
          </ErrorBoundary>
        </main>
        <Footer />
        {!onCheckout && <CartBar onOpen={openCart} cartOpen={cartOpen} />}
      </div>
      <CartDialog open={cartOpen} onClose={closeCart} onCheckout={goToCheckout} />
    </>
  )
}
