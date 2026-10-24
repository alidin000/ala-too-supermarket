import { Minus, Plus, Trash } from 'lucide-react'
import type { Ref } from 'react'
import { useI18n } from '../i18n/context'

interface QuantityStepperProps {
  name: string
  quantity: number
  max: number
  onChange: (quantity: number) => void
  /** Announces why "+" does nothing at the stock limit. */
  onMaxReached: () => void
  size?: 'md' | 'sm'
  increaseRef?: Ref<HTMLButtonElement>
  decreaseRef?: Ref<HTMLButtonElement>
}

/**
 * − / count / + control. "+" at the stock limit stays focusable (aria-disabled) so a
 * keyboard user is not dropped to the top of the page, and it explains the limit instead.
 */
export function QuantityStepper({
  name,
  quantity,
  max,
  onChange,
  onMaxReached,
  size = 'md',
  increaseRef,
  decreaseRef,
}: QuantityStepperProps) {
  const { t } = useI18n()
  const atMax = quantity >= max
  const DecreaseIcon = quantity <= 1 ? Trash : Minus
  return (
    <div
      className={`stepper stepper--${size}`}
      role="group"
      aria-label={t('product.quantity', { name })}
    >
      <button
        ref={decreaseRef}
        type="button"
        className="stepper__btn"
        onClick={() => onChange(quantity - 1)}
        aria-label={t(quantity <= 1 ? 'cart.remove' : 'product.decrease', { name })}
      >
        <DecreaseIcon aria-hidden="true" />
      </button>
      <span className="stepper__value">{quantity}</span>
      <button
        ref={increaseRef}
        type="button"
        className="stepper__btn"
        aria-disabled={atMax || undefined}
        onClick={() => (atMax ? onMaxReached() : onChange(quantity + 1))}
        aria-label={t('product.increase', { name })}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  )
}
