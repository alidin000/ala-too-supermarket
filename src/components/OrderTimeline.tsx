import { Check } from 'lucide-react'
import type { Fulfillment, OrderStatus } from '../api/types'
import { useI18n } from '../i18n/context'
import { STATUS_HINT_KEYS, STATUS_KEYS } from '../i18n/labels'

const STEPS: Record<Fulfillment, OrderStatus[]> = {
  delivery: ['new', 'confirmed', 'preparing', 'out_for_delivery', 'completed'],
  pickup: ['new', 'confirmed', 'preparing', 'ready', 'completed'],
}

/** Index of `status` in the steps; a status from the other flow maps to the same stage. */
function stepIndex(status: OrderStatus, fulfillment: Fulfillment): number {
  const steps = STEPS[fulfillment]
  const index = steps.indexOf(status)
  if (index >= 0) return index
  return status === 'ready' || status === 'out_for_delivery' ? 3 : 0
}

export function OrderTimeline({
  status,
  fulfillment,
}: {
  status: OrderStatus
  fulfillment: Fulfillment
}) {
  const { t } = useI18n()
  const steps = STEPS[fulfillment]
  const current = stepIndex(status, fulfillment)
  return (
    <ol className="timeline">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming'
        const hintKey = STATUS_HINT_KEYS[step]
        return (
          <li
            key={step}
            className={`timeline__step timeline__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="timeline__dot" aria-hidden="true">
              {state === 'done' || (state === 'current' && step === 'completed') ? <Check /> : null}
            </span>
            <span className="timeline__text">
              <span className="timeline__label">{t(STATUS_KEYS[step])}</span>
              {state === 'current' && hintKey && (
                <span className="timeline__hint">{t(hintKey)}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
