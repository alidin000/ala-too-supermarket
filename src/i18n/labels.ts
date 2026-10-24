import type { Badge, OrderStatus, PaymentMethod } from '../api/types'
import type { MessageKey } from './messages'

export const BADGE_KEYS: Record<Badge, MessageKey> = {
  popular: 'badge.popular',
  deal: 'badge.deal',
  new: 'badge.new',
}

export const STATUS_KEYS: Record<OrderStatus, MessageKey> = {
  new: 'status.new',
  confirmed: 'status.confirmed',
  preparing: 'status.preparing',
  ready: 'status.ready',
  out_for_delivery: 'status.out_for_delivery',
  completed: 'status.completed',
  cancelled: 'status.cancelled',
}

export const STATUS_HINT_KEYS: Partial<Record<OrderStatus, MessageKey>> = {
  new: 'statusHint.new',
  confirmed: 'statusHint.confirmed',
  preparing: 'statusHint.preparing',
  ready: 'statusHint.ready',
  out_for_delivery: 'statusHint.out_for_delivery',
  completed: 'statusHint.completed',
}

export const METHOD_KEYS: Record<PaymentMethod, MessageKey> = {
  cash: 'method.cash',
  mbank_transfer: 'method.mbank_transfer',
}
