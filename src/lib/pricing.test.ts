import { describe, expect, it } from 'vitest'
import type { StoreConfig } from '../api/types'
import { computeTotals, rulesFromStore } from './pricing'

function store(fulfillment: Partial<StoreConfig['fulfillment']> = {}): StoreConfig {
  return {
    name: 'Ала-Тоо Маркет',
    city: 'Кызыл-Кия',
    phone: '',
    pickup_address: '',
    opening_hours: '',
    is_accepting_orders: true,
    currency: 'KGS',
    fulfillment: {
      delivery_enabled: true,
      pickup_enabled: true,
      delivery_fee: '150.00',
      free_delivery_from: '2000.00',
      min_order_total: '300.00',
      ...fulfillment,
    },
    payment: {
      cash_enabled: true,
      mbank: { configured: false, recipient_name: '', phone: '', qr_image_url: '' },
    },
  }
}

const som = (value: number) => value * 100

describe('computeTotals', () => {
  const rules = rulesFromStore(store())

  it('charges the delivery fee below the free threshold', () => {
    const totals = computeTotals(som(1250), 'delivery', rules)
    expect(totals.deliveryFee).toBe(som(150))
    expect(totals.total).toBe(som(1400))
    expect(totals.freeDeliveryRemaining).toBe(som(750))
  })

  it('makes delivery free exactly at the threshold', () => {
    const totals = computeTotals(som(2000), 'delivery', rules)
    expect(totals.deliveryFee).toBe(0)
    expect(totals.total).toBe(som(2000))
    expect(totals.freeDeliveryRemaining).toBe(0)
  })

  it('never charges delivery for pickup', () => {
    const totals = computeTotals(som(100), 'pickup', rules)
    expect(totals.deliveryFee).toBe(0)
    expect(totals.freeDeliveryRemaining).toBeNull()
  })

  it('applies the minimum order to goods only, before the fee', () => {
    expect(computeTotals(som(180), 'delivery', rules).minOrderShortfall).toBe(som(120))
    expect(computeTotals(som(300), 'delivery', rules).minOrderShortfall).toBe(0)
  })

  it('treats free_delivery_from: null as "never free"', () => {
    const neverFree = rulesFromStore(store({ free_delivery_from: null }))
    const totals = computeTotals(som(50_000), 'delivery', neverFree)
    expect(totals.deliveryFee).toBe(som(150))
    expect(totals.freeDeliveryRemaining).toBeNull()
  })

  it('has no shortfall when there is no minimum', () => {
    const noMinimum = rulesFromStore(store({ min_order_total: '0.00' }))
    expect(computeTotals(som(1), 'pickup', noMinimum).minOrderShortfall).toBe(0)
  })
})
