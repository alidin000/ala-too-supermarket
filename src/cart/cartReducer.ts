import type { OrderItemInput, Product } from '../api/types'
import { toMinor } from '../lib/money'

/** API contract limits: at most 50 lines per order and 100 of one product. */
export const MAX_LINES = 50
export const LINE_CAP = 100

/** The product fields the cart keeps, so it can render before the refresh request returns. */
export type CartProduct = Pick<
  Product,
  | 'id'
  | 'name_ru'
  | 'name_ky'
  | 'price'
  | 'unit'
  | 'image_url'
  | 'category_slug'
  | 'in_stock'
  | 'max_quantity'
>

export interface CartLine {
  product: CartProduct
  quantity: number
  /** The product is out of stock or no longer sold; the line is kept but not ordered. */
  unavailable: boolean
  /** The quantity was lowered to the stock left; holds what the customer had chosen. */
  adjustedFrom: number | null
}

export interface CartState {
  lines: CartLine[]
}

export type CartAction =
  | { type: 'add'; product: CartProduct; quantity?: number }
  | { type: 'setQuantity'; productId: number; quantity: number }
  | { type: 'remove'; productId: number }
  | { type: 'removeUnavailable' }
  | { type: 'clear' }
  | { type: 'hydrate'; lines: CartLine[] }
  | { type: 'refresh'; products: Product[]; requestedIds: number[] }

export const emptyCart: CartState = { lines: [] }

export function toCartProduct(product: CartProduct): CartProduct {
  return {
    id: product.id,
    name_ru: product.name_ru,
    name_ky: product.name_ky,
    price: product.price,
    unit: product.unit,
    image_url: product.image_url,
    category_slug: product.category_slug,
    in_stock: product.in_stock,
    max_quantity: product.max_quantity,
  }
}

/** The most of this product one order line may hold right now. */
export function maxFor(product: CartProduct): number {
  if (!product.in_stock) return 0
  return Math.max(0, Math.min(Math.floor(product.max_quantity), LINE_CAP))
}

function replaceLine(state: CartState, productId: number, line: CartLine | null): CartState {
  const lines = state.lines.flatMap((current) =>
    current.product.id !== productId ? [current] : line ? [line] : [],
  )
  return { lines }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const product = toCartProduct(action.product)
      const max = maxFor(product)
      const wanted = Math.floor(action.quantity ?? 1)
      if (max === 0 || wanted < 1) return state
      const existing = state.lines.find((line) => line.product.id === product.id)
      if (!existing) {
        if (state.lines.length >= MAX_LINES) return state
        const line = {
          product,
          quantity: Math.min(wanted, max),
          unavailable: false,
          adjustedFrom: null,
        }
        return { lines: [...state.lines, line] }
      }
      // A line that had become unavailable starts over from the fresh product data.
      const base = existing.unavailable ? 0 : existing.quantity
      const quantity = Math.min(base + wanted, max)
      if (quantity === existing.quantity && !existing.unavailable) return state
      return replaceLine(state, product.id, {
        product,
        quantity,
        unavailable: false,
        adjustedFrom: null,
      })
    }
    case 'setQuantity': {
      const existing = state.lines.find((line) => line.product.id === action.productId)
      if (!existing) return state
      const wanted = Math.floor(action.quantity)
      if (!Number.isFinite(wanted)) return state
      if (wanted <= 0) return replaceLine(state, action.productId, null)
      // An unavailable line can only be removed, not changed.
      if (existing.unavailable) return state
      const quantity = Math.min(wanted, maxFor(existing.product))
      if (quantity === existing.quantity) return state
      return replaceLine(state, action.productId, { ...existing, quantity, adjustedFrom: null })
    }
    case 'remove':
      return replaceLine(state, action.productId, null)
    case 'removeUnavailable':
      return { lines: state.lines.filter((line) => !line.unavailable) }
    case 'clear':
      return emptyCart
    case 'hydrate':
      return { lines: action.lines }
    case 'refresh': {
      const fresh = new Map(action.products.map((product) => [product.id, product]))
      const requested = new Set(action.requestedIds)
      const lines = state.lines.map((line): CartLine => {
        const id = line.product.id
        // Lines added while the refresh was in flight keep their own data.
        if (!requested.has(id)) return line
        const product = fresh.get(id)
        if (!product) return { ...line, unavailable: true }
        const updated = toCartProduct(product)
        const max = maxFor(updated)
        if (max === 0) return { ...line, product: updated, unavailable: true }
        if (line.quantity > max) {
          return {
            product: updated,
            quantity: max,
            unavailable: false,
            adjustedFrom: line.adjustedFrom ?? line.quantity,
          }
        }
        return { ...line, product: updated, unavailable: false }
      })
      return { lines }
    }
  }
}

export const selectCount = (state: CartState) =>
  state.lines.reduce((sum, line) => sum + (line.unavailable ? 0 : line.quantity), 0)

/** Goods subtotal in tyiyn, without unavailable lines. */
export const selectSubtotal = (state: CartState) =>
  state.lines.reduce((sum, line) => {
    if (line.unavailable) return sum
    const price = toMinor(line.product.price)
    return Number.isFinite(price) ? sum + price * line.quantity : sum
  }, 0)

export const selectOrderItems = (state: CartState): OrderItemInput[] =>
  state.lines
    .filter((line) => !line.unavailable && line.quantity > 0)
    .map((line) => ({ product_id: line.product.id, quantity: line.quantity }))

export const selectHasUnavailable = (state: CartState) =>
  state.lines.some((line) => line.unavailable)

// --- Persistence -------------------------------------------------------------------------

const STORAGE_VERSION = 1

export function serializeCart(state: CartState): string {
  return JSON.stringify({ v: STORAGE_VERSION, lines: state.lines })
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

function parseProduct(value: unknown): CartProduct | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (
    !isCount(raw.id) ||
    raw.id === 0 ||
    !isString(raw.name_ru) ||
    !isString(raw.price) ||
    !Number.isFinite(toMinor(raw.price))
  ) {
    return null
  }
  return {
    id: raw.id,
    name_ru: raw.name_ru,
    name_ky: isString(raw.name_ky) ? raw.name_ky : '',
    price: raw.price,
    unit: isString(raw.unit) ? raw.unit : '',
    image_url: isString(raw.image_url) ? raw.image_url : '',
    category_slug: isString(raw.category_slug) ? raw.category_slug : '',
    in_stock: raw.in_stock !== false,
    max_quantity: isCount(raw.max_quantity) ? raw.max_quantity : LINE_CAP,
  }
}

/** Reads a saved cart defensively: anything malformed is dropped rather than crashing. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []
  const { v, lines } = data as { v?: unknown; lines?: unknown }
  if (v !== STORAGE_VERSION || !Array.isArray(lines)) return []

  const seen = new Set<number>()
  const result: CartLine[] = []
  for (const entry of lines) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const product = parseProduct(row.product)
    if (!product || seen.has(product.id) || !isCount(row.quantity) || row.quantity < 1) continue
    seen.add(product.id)
    result.push({
      product,
      quantity: Math.min(row.quantity, LINE_CAP),
      unavailable: row.unavailable === true,
      adjustedFrom: isCount(row.adjustedFrom) ? row.adjustedFrom : null,
    })
    if (result.length >= MAX_LINES) break
  }
  return result
}
