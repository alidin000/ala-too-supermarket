import { describe, expect, it } from 'vitest'
import {
  buildProductListParams,
  buildProductPatch,
  draftFromProduct,
  isDraftDirty,
  normalizePrice,
  stockLevel,
  validateDraft,
} from './productEdit'
import type { ProductDraft } from './productEdit'
import type { StaffProduct } from './types'

const MILK: StaffProduct = {
  id: 1,
  sku: 'MILK-001',
  name_ru: 'Молоко 2.5%',
  name_ky: 'Сүт 2.5%',
  category_slug: 'produkty',
  category_name: 'Продукты',
  price: '85.00',
  unit: '1 л',
  stock_quantity: 40,
  is_active: true,
  badge: 'popular',
  updated_at: '2026-10-24T10:00:00+06:00',
}

const draft = (patch: Partial<ProductDraft>): ProductDraft => ({
  ...draftFromProduct(MILK),
  ...patch,
})

describe('price validation', () => {
  it.each([
    ['0', 'price_positive'],
    ['0.00', 'price_positive'],
    ['-5', 'price_format'],
    ['abc', 'price_format'],
    ['1.234', 'price_format'],
    ['1e3', 'price_format'],
    ['', 'price_required'],
  ])('rejects %j', (price, code) => {
    expect(validateDraft(draft({ price })).errors.price).toBe(code)
  })

  it('accepts a comma, spaces and up to 2 decimals, and normalises them', () => {
    expect(validateDraft(draft({ price: '85,5' })).price).toBe('85.50')
    expect(validateDraft(draft({ price: '1 250' })).price).toBe('1250.00')
    expect(validateDraft(draft({ price: '0.01' })).errors).toEqual({})
    expect(normalizePrice('12.')).toBeNull()
  })
})

describe('stock validation', () => {
  it.each([
    ['-1', 'stock_range'],
    ['100001', 'stock_range'],
    ['1.5', 'stock_format'],
    ['десять', 'stock_format'],
    ['', 'stock_required'],
  ])('rejects %j', (stock, code) => {
    expect(validateDraft(draft({ stock })).errors.stock).toBe(code)
  })

  it('accepts the bounds 0 and 100000', () => {
    expect(validateDraft(draft({ stock: '0' })).stock).toBe(0)
    expect(validateDraft(draft({ stock: '100000' })).stock).toBe(100000)
  })
})

describe('building the PATCH', () => {
  it('sends only the fields that changed', () => {
    expect(buildProductPatch(MILK, draft({ stock: '12' }))).toEqual({ stock_quantity: 12 })
    expect(buildProductPatch(MILK, draft({ price: '90', isActive: false, badge: '' }))).toEqual({
      price: '90.00',
      is_active: false,
      badge: null,
    })
  })

  it('treats "85" and "85.00" as the same price', () => {
    expect(buildProductPatch(MILK, draft({ price: '85' }))).toEqual({})
  })

  it('refuses to build a PATCH from an invalid draft', () => {
    expect(buildProductPatch(MILK, draft({ price: '0' }))).toBeNull()
  })

  it('knows when a row has unsaved edits', () => {
    expect(isDraftDirty(MILK, draftFromProduct(MILK))).toBe(false)
    expect(isDraftDirty(MILK, draft({ badge: 'deal' }))).toBe(true)
  })
})

describe('stock level marks', () => {
  it('marks 0 as out and 1..threshold as low', () => {
    expect(stockLevel(0, 5)).toBe('out')
    expect(stockLevel(1, 5)).toBe('low')
    expect(stockLevel(5, 5)).toBe('low')
    expect(stockLevel(6, 5)).toBe('ok')
  })
})

describe('product list query', () => {
  it('sends only active filters', () => {
    expect(
      buildProductListParams({ q: ' сүт ', category: '', stock: 'all', active: '' }).toString(),
    ).toBe('q=%D1%81%D2%AF%D1%82')
    expect(
      Object.fromEntries(
        buildProductListParams({ q: '', category: 'produkty', stock: 'out', active: '0', page: 2 }),
      ),
    ).toEqual({ category: 'produkty', stock: 'out', active: '0', page: '2' })
  })
})
