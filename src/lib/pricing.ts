import type { Fulfillment, StoreConfig } from '../api/types'
import { toMinor } from './money'

/** Store pricing rules in tyiyn. */
export interface PricingRules {
  deliveryFee: number
  /** null means delivery is never free. */
  freeDeliveryFrom: number | null
  minOrderTotal: number
}

export interface Totals {
  subtotal: number
  deliveryFee: number
  total: number
  /** How much more to add for free delivery; 0 once reached; null when it does not apply. */
  freeDeliveryRemaining: number | null
  /** How much is missing to reach the minimum order (goods only); 0 when met. */
  minOrderShortfall: number
}

const orZero = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)

export function rulesFromStore(config: StoreConfig): PricingRules {
  const free = config.fulfillment.free_delivery_from
  const freeMinor = free === null ? Number.NaN : toMinor(free)
  return {
    deliveryFee: orZero(toMinor(config.fulfillment.delivery_fee)),
    freeDeliveryFrom: Number.isFinite(freeMinor) ? Math.max(0, freeMinor) : null,
    minOrderTotal: orZero(toMinor(config.fulfillment.min_order_total)),
  }
}

/**
 * Estimates the order totals the way the contract describes the server rules. The server's
 * numbers on the created order are final; this only previews them.
 */
export function computeTotals(
  subtotal: number,
  fulfillment: Fulfillment,
  rules: PricingRules,
): Totals {
  const isDelivery = fulfillment === 'delivery'
  const freeFrom = rules.freeDeliveryFrom
  const reachedFree = freeFrom !== null && subtotal >= freeFrom
  const deliveryFee = isDelivery && !reachedFree ? rules.deliveryFee : 0
  const freeDeliveryRemaining =
    !isDelivery || freeFrom === null || rules.deliveryFee === 0
      ? null
      : Math.max(0, freeFrom - subtotal)
  return {
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    freeDeliveryRemaining,
    minOrderShortfall: Math.max(0, rules.minOrderTotal - subtotal),
  }
}
