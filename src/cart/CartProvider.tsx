import { useCallback, useEffect, useEffectEvent, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { useAnnounce } from '../a11y/announce'
import { api } from '../api'
import { useI18n } from '../i18n/context'
import { readStorage, writeStorage } from '../lib/storage'
import {
  cartReducer,
  maxFor,
  parseStoredCart,
  selectCount,
  selectHasUnavailable,
  selectSubtotal,
  serializeCart,
} from './cartReducer'
import type { CartProduct, CartState } from './cartReducer'
import { CartContext } from './context'
import type { Cart } from './context'

const STORAGE_KEY = 'ala-too:cart:v1'

function loadCart(): CartState {
  return { lines: parseStoredCart(readStorage(STORAGE_KEY)) }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, loadCart)
  const { t, name } = useI18n()
  const announce = useAnnounce()

  useEffect(() => {
    writeStorage(STORAGE_KEY, state.lines.length > 0 ? serializeCart(state) : null)
  }, [state])

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        dispatch({ type: 'hydrate', lines: parseStoredCart(event.newValue) })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const refresh = useCallback(async () => {
    const ids = state.lines.map((line) => line.product.id)
    if (ids.length === 0) return
    try {
      const page = await api.getProducts({ ids, pageSize: 100 })
      dispatch({ type: 'refresh', products: page.results, requestedIds: ids })
    } catch {
      // Keep the saved data; the server re-checks prices and stock when the order is placed.
    }
  }, [state.lines])

  // A saved cart may be days old: refresh prices and stock once on load.
  const refreshOnLoad = useEffectEvent(() => {
    void refresh()
  })
  useEffect(() => {
    refreshOnLoad()
  }, [])

  const quantityOf = useCallback(
    (productId: number) =>
      state.lines.find((line) => line.product.id === productId && !line.unavailable)?.quantity ?? 0,
    [state.lines],
  )

  const add = useCallback(
    (product: CartProduct) => {
      const max = maxFor(product)
      const current = quantityOf(product.id)
      if (max === 0) return
      if (current >= max) {
        announce(t('product.maxReached', { count: max }))
        return
      }
      dispatch({ type: 'add', product })
      announce(t('cart.added', { name: name(product), count: current + 1 }))
    },
    [announce, name, quantityOf, t],
  )

  const setQuantity = useCallback(
    (product: CartProduct, quantity: number) => {
      const clamped = Math.min(quantity, maxFor(product))
      dispatch({ type: 'setQuantity', productId: product.id, quantity: clamped })
      if (clamped <= 0) announce(t('cart.removed', { name: name(product) }))
      else announce(t('cart.added', { name: name(product), count: clamped }))
    },
    [announce, name, t],
  )

  const remove = useCallback(
    (product: CartProduct) => {
      dispatch({ type: 'remove', productId: product.id })
      announce(t('cart.removed', { name: name(product) }))
    },
    [announce, name, t],
  )

  const removeUnavailable = useCallback(() => dispatch({ type: 'removeUnavailable' }), [])
  const clear = useCallback(() => dispatch({ type: 'clear' }), [])

  const value = useMemo<Cart>(
    () => ({
      state,
      lines: state.lines,
      count: selectCount(state),
      subtotal: selectSubtotal(state),
      hasUnavailable: selectHasUnavailable(state),
      quantityOf,
      add,
      setQuantity,
      remove,
      removeUnavailable,
      clear,
      refresh,
    }),
    [state, quantityOf, add, setQuantity, remove, removeUnavailable, clear, refresh],
  )

  return <CartContext value={value}>{children}</CartContext>
}
