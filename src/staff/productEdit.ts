// Products page: inline-edit drafts, client-side validation that mirrors the API rules
// (price above 0 with at most 2 decimals, stock 0..100000), PATCH building, and the list
// filters (/admin/products?q=&category=&stock=low&active=1).

import { toMinor } from '../lib/money'
import type {
  ActiveFilter,
  Badge,
  ProductListQuery,
  ProductPatch,
  StaffProduct,
  StockFilter,
} from './types'

export const MAX_STOCK = 100_000
export const BADGES: readonly Badge[] = ['popular', 'deal', 'new']

export interface ProductDraft {
  price: string
  stock: string
  isActive: boolean
  /** "" means no badge. */
  badge: Badge | ''
}

export type DraftField = 'price' | 'stock'
export type DraftErrorCode =
  | 'price_required'
  | 'price_format'
  | 'price_positive'
  | 'stock_required'
  | 'stock_format'
  | 'stock_range'
export type DraftErrors = Partial<Record<DraftField, DraftErrorCode>>

export function draftFromProduct(product: StaffProduct): ProductDraft {
  return {
    price: product.price,
    stock: String(product.stock_quantity),
    isActive: product.is_active,
    badge: product.badge ?? '',
  }
}

/** "1 250,5" -> "1250.50"; returns null when the text is not a price with ≤ 2 decimals. */
export function normalizePrice(input: string): string | null {
  const compact = input.replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(compact)) return null
  const minor = toMinor(compact)
  return Number.isFinite(minor) ? (minor / 100).toFixed(2) : null
}

export interface DraftCheck {
  errors: DraftErrors
  price: string | null
  stock: number | null
}

export function validateDraft(draft: ProductDraft): DraftCheck {
  const errors: DraftErrors = {}
  let price: string | null = null
  let stock: number | null = null

  const priceText = draft.price.trim()
  if (!priceText) {
    errors.price = 'price_required'
  } else {
    price = normalizePrice(priceText)
    if (price === null) errors.price = 'price_format'
    else if (toMinor(price) <= 0) errors.price = 'price_positive'
    if (errors.price) price = null
  }

  const stockText = draft.stock.trim()
  if (!stockText) {
    errors.stock = 'stock_required'
  } else if (!/^\d+$/.test(stockText)) {
    errors.stock = /^-\d+$/.test(stockText) ? 'stock_range' : 'stock_format'
  } else {
    const value = Number(stockText)
    if (value > MAX_STOCK) errors.stock = 'stock_range'
    else stock = value
  }
  return { errors, price, stock }
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0
}

/** Only the fields that differ from the saved product; null when the draft is invalid. */
export function buildProductPatch(product: StaffProduct, draft: ProductDraft): ProductPatch | null {
  const { errors, price, stock } = validateDraft(draft)
  if (hasErrors(errors) || price === null || stock === null) return null
  const patch: ProductPatch = {}
  if (toMinor(price) !== toMinor(product.price)) patch.price = price
  if (stock !== product.stock_quantity) patch.stock_quantity = stock
  if (draft.isActive !== product.is_active) patch.is_active = draft.isActive
  const badge = draft.badge === '' ? null : draft.badge
  if (badge !== product.badge) patch.badge = badge
  return patch
}

export function isDraftDirty(product: StaffProduct, draft: ProductDraft): boolean {
  const saved = draftFromProduct(product)
  return (
    draft.price.trim() !== saved.price ||
    draft.stock.trim() !== saved.stock ||
    draft.isActive !== saved.isActive ||
    draft.badge !== saved.badge
  )
}

/** The product as it will look after `patch`, shown while the save is in flight. */
export function applyPatch(product: StaffProduct, patch: ProductPatch): StaffProduct {
  return { ...product, ...patch }
}

export type StockLevel = 'out' | 'low' | 'ok'

export function stockLevel(quantity: number, lowThreshold: number): StockLevel {
  if (quantity <= 0) return 'out'
  if (quantity <= lowThreshold) return 'low'
  return 'ok'
}

// --- Filters ---------------------------------------------------------------------------

export interface ProductFilters {
  q: string
  category: string
  stock: StockFilter
  active: ActiveFilter
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  q: '',
  category: '',
  stock: 'all',
  active: '',
}

const STOCK_FILTERS: readonly StockFilter[] = ['all', 'low', 'out']

export function parseProductFilters(search: string): ProductFilters {
  const params = new URLSearchParams(search)
  const stock = params.get('stock')
  const active = params.get('active')
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    category: (params.get('category') ?? '').trim().slice(0, 100),
    stock: STOCK_FILTERS.includes(stock as StockFilter) ? (stock as StockFilter) : 'all',
    active: active === '1' || active === '0' ? active : '',
  }
}

export function productsSearch(filters: ProductFilters): string {
  const params = new URLSearchParams()
  const q = filters.q.trim()
  if (q) params.set('q', q)
  if (filters.category) params.set('category', filters.category)
  if (filters.stock !== 'all') params.set('stock', filters.stock)
  if (filters.active) params.set('active', filters.active)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** URL parameters for GET /api/staff/products/. */
export function buildProductListParams(query: ProductListQuery): URLSearchParams {
  const params = new URLSearchParams()
  const q = query.q?.trim()
  if (q) params.set('q', q)
  if (query.category) params.set('category', query.category)
  if (query.stock && query.stock !== 'all') params.set('stock', query.stock)
  if (query.active) params.set('active', query.active)
  if (query.page && query.page > 1) params.set('page', String(Math.floor(query.page)))
  return params
}
