import { describe, expect, it } from 'vitest'
import type { Product } from '../api/types'
import {
  cartReducer,
  emptyCart,
  LINE_CAP,
  MAX_LINES,
  parseStoredCart,
  selectCount,
  selectOrderItems,
  selectSubtotal,
  serializeCart,
} from './cartReducer'
import type { CartState } from './cartReducer'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    sku: 'MILK-001',
    category: 1,
    category_slug: 'produkty',
    name_ru: 'Молоко 2.5%',
    name_ky: 'Сүт 2.5%',
    description: '',
    price: '85.00',
    unit: '1 л',
    image_url: '',
    in_stock: true,
    max_quantity: 40,
    badge: null,
    ...overrides,
  }
}

const add = (state: CartState, item: Product, quantity?: number) =>
  cartReducer(state, { type: 'add', product: item, quantity })

describe('cartReducer: add and clamp', () => {
  it('adds a new line and increments an existing one', () => {
    let state = add(emptyCart, product())
    state = add(state, product())
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0]?.quantity).toBe(2)
  })

  it('never goes above max_quantity', () => {
    const scarce = product({ max_quantity: 3 })
    let state = add(emptyCart, scarce, 2)
    state = add(state, scarce, 5)
    expect(state.lines[0]?.quantity).toBe(3)
  })

  it('caps a line at the per-line limit even if stock is higher', () => {
    const state = add(emptyCart, product({ max_quantity: 500 }), 1000)
    expect(state.lines[0]?.quantity).toBe(LINE_CAP)
  })

  it('refuses out-of-stock products', () => {
    const state = add(emptyCart, product({ in_stock: false, max_quantity: 0 }))
    expect(state.lines).toHaveLength(0)
  })

  it('refuses a 51st distinct product', () => {
    let state = emptyCart
    for (let id = 1; id <= MAX_LINES + 1; id += 1) state = add(state, product({ id }))
    expect(state.lines).toHaveLength(MAX_LINES)
  })

  it('setQuantity clamps to stock and removes the line at zero', () => {
    let state = add(emptyCart, product({ max_quantity: 4 }))
    state = cartReducer(state, { type: 'setQuantity', productId: 1, quantity: 9 })
    expect(state.lines[0]?.quantity).toBe(4)
    state = cartReducer(state, { type: 'setQuantity', productId: 1, quantity: 0 })
    expect(state.lines).toHaveLength(0)
  })

  it('remove drops only the given product', () => {
    let state = add(add(emptyCart, product({ id: 1 })), product({ id: 2 }))
    state = cartReducer(state, { type: 'remove', productId: 1 })
    expect(state.lines.map((line) => line.product.id)).toEqual([2])
  })
})

describe('cartReducer: refresh from the API', () => {
  const start = add(add(emptyCart, product({ id: 1 }), 10), product({ id: 2, price: '35.00' }))

  it('updates prices and lowers quantities to the stock that is left', () => {
    const state = cartReducer(start, {
      type: 'refresh',
      products: [product({ id: 1, price: '90.00', max_quantity: 4 }), product({ id: 2 })],
      requestedIds: [1, 2],
    })
    const milk = state.lines[0]
    expect(milk?.product.price).toBe('90.00')
    expect(milk?.quantity).toBe(4)
    expect(milk?.adjustedFrom).toBe(10)
  })

  it('flags lines that went out of stock or are no longer sold', () => {
    const state = cartReducer(start, {
      type: 'refresh',
      products: [product({ id: 1, in_stock: false, max_quantity: 0 })],
      requestedIds: [1, 2],
    })
    expect(state.lines.map((line) => line.unavailable)).toEqual([true, true])
    expect(selectCount(state)).toBe(0)
    expect(selectOrderItems(state)).toEqual([])
  })

  it('leaves lines added after the request was sent untouched', () => {
    const withNew = add(start, product({ id: 3 }))
    const state = cartReducer(withNew, {
      type: 'refresh',
      products: [product({ id: 1 }), product({ id: 2 })],
      requestedIds: [1, 2],
    })
    expect(state.lines.find((line) => line.product.id === 3)?.unavailable).toBe(false)
  })

  it('excludes unavailable lines from the subtotal and the order', () => {
    const state = cartReducer(start, {
      type: 'refresh',
      products: [product({ id: 1 })],
      requestedIds: [1, 2],
    })
    // 10 × 85.00 som = 850 som = 85 000 tyiyn; the unavailable bread is not counted.
    expect(selectSubtotal(state)).toBe(85_000)
    expect(selectOrderItems(state)).toEqual([{ product_id: 1, quantity: 10 }])
    const cleaned = cartReducer(state, { type: 'removeUnavailable' })
    expect(cleaned.lines.map((line) => line.product.id)).toEqual([1])
  })
})

describe('cart persistence', () => {
  it('round-trips through storage', () => {
    const state = add(add(emptyCart, product({ id: 1 }), 2), product({ id: 2 }))
    expect(parseStoredCart(serializeCart(state))).toEqual(state.lines)
  })

  it('returns an empty cart for missing, corrupt or old-format data', () => {
    expect(parseStoredCart(null)).toEqual([])
    expect(parseStoredCart('{not json')).toEqual([])
    expect(parseStoredCart(JSON.stringify({ 1: 2, 3: 1 }))).toEqual([])
    expect(parseStoredCart(JSON.stringify({ v: 99, lines: [] }))).toEqual([])
  })

  it('drops malformed lines and duplicate products but keeps the good ones', () => {
    const good = { product: product({ id: 7 }), quantity: 2 }
    const raw = JSON.stringify({
      v: 1,
      lines: [
        good,
        { product: product({ id: 7 }), quantity: 5 },
        { product: { id: 'x' }, quantity: 1 },
        { product: product({ id: 8, price: 'cheap' }), quantity: 1 },
        { product: product({ id: 9 }), quantity: -3 },
        { product: product({ id: 10 }), quantity: 1000 },
      ],
    })
    const lines = parseStoredCart(raw)
    expect(lines.map((line) => [line.product.id, line.quantity])).toEqual([
      [7, 2],
      [10, LINE_CAP],
    ])
  })
})
