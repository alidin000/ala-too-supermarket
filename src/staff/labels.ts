import type { OrderStatus, PaymentStatus } from './types'

export const ORDER_STATUSES = [
  'new',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
] as const satisfies readonly OrderStatus[]

export const PAYMENT_STATUSES = [
  'unpaid',
  'pending',
  'paid',
  'rejected',
  'refunded',
] as const satisfies readonly PaymentStatus[]
