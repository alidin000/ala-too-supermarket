import { createContext, use } from 'react'
import type { Fulfillment, PaymentMethod, StoreConfig } from '../api/types'
import type { PricingRules } from '../lib/pricing'

export interface StoreConfigState {
  config: StoreConfig | null
  rules: PricingRules | null
  error: unknown
  loading: boolean
  reload: () => void
}

export const StoreConfigContext = createContext<StoreConfigState | null>(null)

export function useStoreConfig(): StoreConfigState {
  const value = use(StoreConfigContext)
  if (!value) throw new Error('useStoreConfig must be used inside <StoreConfigProvider>')
  return value
}

export function enabledFulfillments(config: StoreConfig): Fulfillment[] {
  const options: Fulfillment[] = []
  if (config.fulfillment.delivery_enabled) options.push('delivery')
  if (config.fulfillment.pickup_enabled) options.push('pickup')
  return options
}

export function enabledPaymentMethods(config: StoreConfig): PaymentMethod[] {
  const methods: PaymentMethod[] = []
  if (config.payment.cash_enabled) methods.push('cash')
  if (config.payment.mbank.configured) methods.push('mbank_transfer')
  return methods
}

/** The fulfillment used for cart estimates before the customer picks one. */
export function defaultFulfillment(config: StoreConfig | null): Fulfillment {
  return config && !config.fulfillment.delivery_enabled ? 'pickup' : 'delivery'
}
