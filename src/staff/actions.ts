// Order action buttons are generated ONLY from what the server allows for this order
// (allowed_status_transitions, allowed_payment_transitions, can_cancel) and only for a
// user with change_orders. The UI never invents a transition.

import { ORDER_STATUSES, PAYMENT_STATUSES } from './labels'
import { S } from './strings'
import type { OrderStatus, PaymentStatus, Permissions, StaffOrderDetail } from './types'

export type OrderAction =
  | { kind: 'status'; to: OrderStatus; label: string; tone: 'primary' | 'soft' }
  | { kind: 'payment'; to: PaymentStatus; label: string; tone: 'soft' | 'outline' }
  | { kind: 'cancel'; label: string; tone: 'danger' }

export function statusActionLabel(to: OrderStatus): string {
  return S.statusAction[to]
}

export function paymentActionLabel(to: PaymentStatus): string {
  return S.paymentAction[to]
}

const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value)

type ActionSource = Pick<
  StaffOrderDetail,
  'allowed_status_transitions' | 'allowed_payment_transitions' | 'can_cancel'
>

/**
 * The buttons for one order, in the server's order. The first status step is the primary
 * button. Cancelling has its own endpoint, so a stray "cancelled" in the status list is
 * ignored; `can_cancel` decides the cancel button. Unknown values are skipped.
 */
export function orderActions(
  order: ActionSource,
  permissions: Pick<Permissions, 'change_orders'>,
): OrderAction[] {
  if (!permissions.change_orders) return []
  const actions: OrderAction[] = []
  const statuses = order.allowed_status_transitions.filter(
    (to) => isOrderStatus(to) && to !== 'cancelled',
  )
  statuses.forEach((to, index) => {
    actions.push({
      kind: 'status',
      to,
      label: statusActionLabel(to),
      tone: index === 0 ? 'primary' : 'soft',
    })
  })
  for (const to of new Set(order.allowed_payment_transitions)) {
    if (!isPaymentStatus(to)) continue
    actions.push({
      kind: 'payment',
      to,
      label: paymentActionLabel(to),
      tone: to === 'paid' ? 'soft' : 'outline',
    })
  }
  if (order.can_cancel) actions.push({ kind: 'cancel', label: S.order.cancel, tone: 'danger' })
  return actions
}

export const CANCEL_REASON_MIN = 3
export const CANCEL_REASON_MAX = 500

/** Mirrors the API rule for POST /cancel/: a reason of 3–500 characters. */
export function cancelReasonError(reason: string): string | null {
  const text = reason.trim()
  if (!text) return S.cancelDialog.reasonRequired
  if (text.length < CANCEL_REASON_MIN) return S.cancelDialog.reasonShort
  if (text.length > CANCEL_REASON_MAX) return S.cancelDialog.reasonLong
  return null
}
