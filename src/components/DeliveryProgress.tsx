import { CircleCheck, Truck } from 'lucide-react'
import { useI18n } from '../i18n/context'
import type { PricingRules } from '../lib/pricing'

/** "Ещё 750 сом до бесплатной доставки" with a progress bar. */
export function DeliveryProgress({ subtotal, rules }: { subtotal: number; rules: PricingRules }) {
  const { t, som } = useI18n()
  const freeFrom = rules.freeDeliveryFrom
  if (freeFrom === null || rules.deliveryFee === 0 || freeFrom <= 0) return null
  const left = Math.max(0, freeFrom - subtotal)
  const percent = Math.min(100, Math.round((subtotal / freeFrom) * 100))
  const reached = left === 0
  return (
    <div className={`delivery-progress${reached ? ' delivery-progress--done' : ''}`}>
      <p className="delivery-progress__text">
        {reached ? <CircleCheck aria-hidden="true" /> : <Truck aria-hidden="true" />}
        {reached ? t('cart.freeReached') : t('cart.freeLeft', { amount: som(left) })}
      </p>
      <div className="delivery-progress__track" aria-hidden="true">
        <span className="delivery-progress__bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
