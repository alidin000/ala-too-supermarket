import { S } from '../strings'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '../types'

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`status-chip staff-status staff-status--${status}`}>{S.status[status]}</span>
  )
}

/** Payment status; for an unpaid cash order that is normal, so it is shown quietly. */
export function PaymentBadge({
  status,
  method,
}: {
  status: PaymentStatus
  method?: PaymentMethod
}) {
  const quiet = status === 'unpaid' && method === 'cash'
  const tone = quiet ? 'quiet' : status
  return (
    <span className={`status-chip staff-pay staff-pay--${tone}`}>
      {quiet ? `${S.method.cash} · ${S.payment.unpaid.toLowerCase()}` : S.payment[status]}
    </span>
  )
}
