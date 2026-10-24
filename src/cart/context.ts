import { createContext, use } from 'react'
import type { CartLine, CartProduct, CartState } from './cartReducer'

export interface Cart {
  state: CartState
  lines: CartLine[]
  /** Units in the cart, without unavailable lines. */
  count: number
  /** Goods subtotal in tyiyn, without unavailable lines. */
  subtotal: number
  hasUnavailable: boolean
  quantityOf: (productId: number) => number
  add: (product: CartProduct) => void
  setQuantity: (product: CartProduct, quantity: number) => void
  remove: (product: CartProduct) => void
  removeUnavailable: () => void
  clear: () => void
  /** Re-reads prices and stock for every line from the API. */
  refresh: () => Promise<void>
}

export const CartContext = createContext<Cart | null>(null)

export function useCart(): Cart {
  const value = use(CartContext)
  if (!value) throw new Error('useCart must be used inside <CartProvider>')
  return value
}
