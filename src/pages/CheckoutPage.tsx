import {
  ArrowLeft,
  Banknote,
  CircleAlert,
  Clock,
  LoaderCircle,
  MapPin,
  ShoppingBasket,
  Smartphone,
  Store,
  Truck,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAnnounce } from '../a11y/announce'
import { api, ApiError } from '../api'
import type { Fulfillment, PaymentMethod } from '../api/types'
import { selectOrderItems } from '../cart/cartReducer'
import { useCart } from '../cart/context'
import { DeliveryProgress } from '../components/DeliveryProgress'
import { Link } from '../components/Link'
import { Notice } from '../components/Notice'
import { enabledFulfillments, enabledPaymentMethods, useStoreConfig } from '../config/context'
import { useI18n } from '../i18n/context'
import { uuid4 } from '../lib/id'
import { toMinor } from '../lib/money'
import { displayPhone, formatKgPhone, normalizeKgPhone, telHref } from '../lib/phone'
import { computeTotals } from '../lib/pricing'
import { saveRecentOrder } from '../lib/recentOrders'
import { catalogRoute, navigate } from '../lib/router'
import { readJson, readStorage, writeStorage } from '../lib/storage'
import { CHECKOUT_FIELDS, LIMITS, mapServerErrors, validateCheckout } from './checkoutForm'
import type { CheckoutField, CheckoutForm } from './checkoutForm'

const CONTACT_KEY = 'ala-too:checkout-contact:v1'
const ATTEMPT_KEY = 'ala-too:checkout-attempt'

const FIELD_IDS: Record<CheckoutField, string> = {
  customer_name: 'checkout-name',
  phone: 'checkout-phone',
  address: 'checkout-address',
  customer_note: 'checkout-note',
}

function loadContact(): CheckoutForm {
  const saved = readJson(CONTACT_KEY) as Partial<CheckoutForm> | null
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    name: text(saved?.name),
    phone: text(saved?.phone),
    address: text(saved?.address),
    note: '',
  }
}

/** One idempotency key per checkout attempt, reused for every retry until an order exists. */
function attemptKey(): string {
  const existing = readStorage(ATTEMPT_KEY, 'session')
  if (existing) return existing
  const key = uuid4()
  writeStorage(ATTEMPT_KEY, key, 'session')
  return key
}

export function CheckoutPage() {
  const { t, lang, som, name } = useI18n()
  const announce = useAnnounce()
  const cart = useCart()
  const store = useStoreConfig()
  const { config, rules } = store

  const [form, setForm] = useState<CheckoutForm>(loadContact)
  const [fulfillmentChoice, setFulfillmentChoice] = useState<Fulfillment | null>(null)
  const [paymentChoice, setPaymentChoice] = useState<PaymentMethod | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CheckoutField, string>>>({})
  const [generalErrors, setGeneralErrors] = useState<string[]>([])
  const [requestError, setRequestError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const summaryRef = useRef<HTMLDivElement>(null)

  // Prices and stock may have changed since the items went into the cart.
  const refreshOnEnter = useEffectEvent(() => {
    void cart.refresh()
  })
  useEffect(() => {
    refreshOnEnter()
  }, [])

  const header = (
    <>
      <Link to={catalogRoute()} className="back-link">
        <ArrowLeft aria-hidden="true" />
        {t('common.backToShop')}
      </Link>
      <h1 id="page-title" className="page-title" tabIndex={-1}>
        {t('checkout.title')}
      </h1>
    </>
  )

  if (!config || !rules) {
    return (
      <div className="container page">
        {header}
        {store.error ? (
          <Notice
            tone="danger"
            role="alert"
            title={t('catalog.errorHint')}
            action={
              <button type="button" className="btn btn--primary" onClick={store.reload}>
                {t('common.retry')}
              </button>
            }
          />
        ) : (
          <div className="checkout-skeleton" aria-busy="true">
            <span className="skeleton skeleton--block" />
            <span className="skeleton skeleton--block" />
          </div>
        )}
      </div>
    )
  }

  const fulfillmentOptions = enabledFulfillments(config)
  const paymentOptions = enabledPaymentMethods(config)
  const fulfillment: Fulfillment =
    fulfillmentChoice && fulfillmentOptions.includes(fulfillmentChoice)
      ? fulfillmentChoice
      : (fulfillmentOptions[0] ?? 'delivery')
  const payment: PaymentMethod =
    paymentChoice && paymentOptions.includes(paymentChoice)
      ? paymentChoice
      : (paymentOptions[0] ?? 'cash')

  const storePhone = config.phone.trim()
  const closedReason =
    !config.is_accepting_orders || fulfillmentOptions.length === 0
      ? t('checkout.closedText')
      : paymentOptions.length === 0
        ? t('checkout.noPayment')
        : null

  if (closedReason) {
    return (
      <div className="container page">
        {header}
        <div className="state-panel">
          <span className="empty-illustration" aria-hidden="true">
            <Store strokeWidth={1.5} />
          </span>
          <p className="state-panel__title">{t('checkout.closedTitle')}</p>
          <p className="muted">{closedReason}</p>
          {storePhone && (
            <p>
              <a href={telHref(storePhone)}>
                {t('checkout.storePhone', { phone: displayPhone(storePhone) })}
              </a>
            </p>
          )}
        </div>
      </div>
    )
  }

  const orderLines = cart.lines.filter((line) => !line.unavailable)
  if (orderLines.length === 0) {
    return (
      <div className="container page">
        {header}
        <div className="state-panel">
          <span className="empty-illustration" aria-hidden="true">
            <ShoppingBasket strokeWidth={1.5} />
          </span>
          <p className="state-panel__title">{t('checkout.emptyTitle')}</p>
          <Link to={catalogRoute()} className="btn btn--primary">
            {t('cart.toCatalog')}
          </Link>
        </div>
      </div>
    )
  }

  const totals = computeTotals(cart.subtotal, fulfillment, rules)
  const deliveryFee = computeTotals(cart.subtotal, 'delivery', rules).deliveryFee
  const belowMinimum = totals.minOrderShortfall > 0

  const update = (field: keyof CheckoutForm, apiField: CheckoutField) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }))
    if (fieldErrors[apiField]) {
      setFieldErrors((previous) => ({ ...previous, [apiField]: undefined }))
    }
  }

  const onPhoneBlur = () => {
    const normalized = normalizeKgPhone(form.phone)
    if (normalized) {
      setForm((previous) => ({ ...previous, phone: formatKgPhone(normalized) }))
    } else if (form.phone.trim()) {
      setFieldErrors((previous) => ({ ...previous, phone: t('validation.phoneInvalid') }))
    }
  }

  const focusField = (field: CheckoutField) => {
    document.getElementById(FIELD_IDS[field])?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || belowMinimum) return

    const clientErrors = validateCheckout(form, fulfillment)
    const invalid = CHECKOUT_FIELDS.filter((field) => clientErrors[field])
    if (invalid.length > 0) {
      const translated: Partial<Record<CheckoutField, string>> = {}
      for (const field of invalid) {
        const key = clientErrors[field]
        if (key) translated[field] = t(key)
      }
      setFieldErrors(translated)
      setGeneralErrors([])
      setRequestError(null)
      announce(t('checkout.errorsTitle'))
      if (invalid[0]) focusField(invalid[0])
      return
    }

    inFlight.current = true
    setSubmitting(true)
    setRequestError(null)
    setGeneralErrors([])
    setFieldErrors({})
    try {
      const { order } = await api.createOrder({
        customer_name: form.name.trim(),
        phone: normalizeKgPhone(form.phone) ?? form.phone.trim(),
        fulfillment,
        address: fulfillment === 'delivery' ? form.address.trim() : '',
        customer_note: form.note.trim(),
        payment_method: payment,
        items: selectOrderItems(cart.state),
        idempotency_key: attemptKey(),
      })
      writeStorage(ATTEMPT_KEY, null, 'session')
      writeStorage(
        CONTACT_KEY,
        JSON.stringify({ name: form.name.trim(), phone: form.phone, address: form.address.trim() }),
      )
      saveRecentOrder({
        number: order.number,
        token: order.token,
        createdAt: order.created_at,
        total: order.total,
      })
      cart.clear()
      navigate({ name: 'order', token: order.token }, { state: { placed: true } })
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'validation') {
        const mapped = mapServerErrors(error.fieldErrors, lang, t)
        setFieldErrors(mapped.fields)
        const general = error.detail ? [...mapped.general, error.detail] : mapped.general
        setGeneralErrors(general.length > 0 ? general : [t('checkout.errorUnknown')])
        if (mapped.itemsRejected) void cart.refresh()
        announce(t('checkout.errorsTitle'))
        window.requestAnimationFrame(() => summaryRef.current?.focus())
      } else {
        const message =
          error instanceof ApiError && error.kind === 'throttled'
            ? t('checkout.errorThrottled')
            : error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')
              ? t('checkout.errorNetwork')
              : error instanceof ApiError && error.kind === 'server'
                ? t('checkout.errorServer')
                : t('checkout.errorUnknown')
        setRequestError(message)
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const describedBy = (field: CheckoutField, hasHint: boolean) =>
    [
      hasHint ? `${FIELD_IDS[field]}-hint` : '',
      fieldErrors[field] ? `${FIELD_IDS[field]}-error` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined

  const errorLinks = CHECKOUT_FIELDS.filter((field) => fieldErrors[field])
  const showSummary = errorLinks.length > 0 || generalErrors.length > 0
  const pickupAddress = config.pickup_address.trim()
  const hours = config.opening_hours.trim()

  return (
    <div className="container page">
      {header}
      <form className="checkout" noValidate onSubmit={submit}>
        <div className="checkout__main">
          {showSummary && (
            <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1}>
              <p className="error-summary__title">
                <CircleAlert aria-hidden="true" />
                {t('checkout.errorsTitle')}
              </p>
              <ul>
                {generalErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
                {errorLinks.map((field) => (
                  <li key={field}>
                    <a
                      href={`#${FIELD_IDS[field]}`}
                      onClick={(event) => {
                        event.preventDefault()
                        focusField(field)
                      }}
                    >
                      {fieldErrors[field]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className="form-card">
            <legend className="form-card__title">{t('checkout.fulfillment')}</legend>
            <div className="choice-grid">
              {fulfillmentOptions.map((option) => (
                <Choice
                  key={option}
                  name="fulfillment"
                  value={option}
                  checked={fulfillment === option}
                  onChange={() => setFulfillmentChoice(option)}
                  icon={option === 'delivery' ? <Truck /> : <Store />}
                  title={t(option === 'delivery' ? 'checkout.delivery' : 'checkout.pickup')}
                  hint={
                    option === 'delivery'
                      ? deliveryFee === 0
                        ? `${t('checkout.deliveryHint')} · ${t('common.free')}`
                        : `${t('checkout.deliveryHint')} · ${som(deliveryFee)}`
                      : t('checkout.pickupHint')
                  }
                />
              ))}
            </div>
            {fulfillment === 'pickup' && (
              <div className="pickup-info">
                <p className="pickup-info__title">{t('checkout.pickupFrom')}</p>
                {pickupAddress || hours ? (
                  <ul role="list">
                    {pickupAddress && (
                      <li>
                        <MapPin aria-hidden="true" />
                        {pickupAddress}
                      </li>
                    )}
                    {hours && (
                      <li>
                        <Clock aria-hidden="true" />
                        {hours}
                      </li>
                    )}
                  </ul>
                ) : null}
                {!pickupAddress && <p className="muted">{t('checkout.pickupUnknown')}</p>}
              </div>
            )}
          </fieldset>

          <fieldset className="form-card">
            <legend className="form-card__title">{t('checkout.contacts')}</legend>
            <Field
              id={FIELD_IDS.customer_name}
              label={t('checkout.name')}
              error={fieldErrors.customer_name}
            >
              <input
                id={FIELD_IDS.customer_name}
                className="input"
                type="text"
                name="name"
                autoComplete="name"
                value={form.name}
                maxLength={LIMITS.name}
                onChange={(event) => update('name', 'customer_name')(event.target.value)}
                aria-invalid={Boolean(fieldErrors.customer_name) || undefined}
                aria-describedby={describedBy('customer_name', false)}
                required
              />
            </Field>
            <Field
              id={FIELD_IDS.phone}
              label={t('checkout.phone')}
              hint={t('checkout.phoneHint')}
              error={fieldErrors.phone}
            >
              <input
                id={FIELD_IDS.phone}
                className="input"
                type="tel"
                name="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+996 555 123 456"
                value={form.phone}
                maxLength={24}
                onChange={(event) => update('phone', 'phone')(event.target.value)}
                onBlur={onPhoneBlur}
                aria-invalid={Boolean(fieldErrors.phone) || undefined}
                aria-describedby={describedBy('phone', true)}
                required
              />
            </Field>
            {fulfillment === 'delivery' && (
              <Field
                id={FIELD_IDS.address}
                label={t('checkout.address')}
                hint={t('checkout.addressHint')}
                error={fieldErrors.address}
              >
                <textarea
                  id={FIELD_IDS.address}
                  className="input input--area"
                  name="street-address"
                  autoComplete="street-address"
                  rows={2}
                  value={form.address}
                  maxLength={LIMITS.address}
                  onChange={(event) => update('address', 'address')(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.address) || undefined}
                  aria-describedby={describedBy('address', true)}
                  required
                />
              </Field>
            )}
            <Field
              id={FIELD_IDS.customer_note}
              label={t('checkout.note')}
              optional={t('common.optional')}
              error={fieldErrors.customer_note}
            >
              <textarea
                id={FIELD_IDS.customer_note}
                className="input input--area"
                name="note"
                rows={2}
                value={form.note}
                maxLength={LIMITS.note}
                placeholder={t('checkout.notePlaceholder')}
                onChange={(event) => update('note', 'customer_note')(event.target.value)}
                aria-invalid={Boolean(fieldErrors.customer_note) || undefined}
                aria-describedby={describedBy('customer_note', false)}
              />
            </Field>
          </fieldset>

          <fieldset className="form-card">
            <legend className="form-card__title">{t('checkout.payment')}</legend>
            <div className="choice-grid">
              {config.payment.cash_enabled && (
                <Choice
                  name="payment"
                  value="cash"
                  checked={payment === 'cash'}
                  onChange={() => setPaymentChoice('cash')}
                  icon={<Banknote />}
                  title={t('checkout.cash')}
                  hint={t('checkout.cashHint')}
                />
              )}
              <Choice
                name="payment"
                value="mbank_transfer"
                checked={payment === 'mbank_transfer'}
                disabled={!config.payment.mbank.configured}
                onChange={() => setPaymentChoice('mbank_transfer')}
                icon={<Smartphone />}
                title={t('checkout.mbank')}
                hint={
                  config.payment.mbank.configured
                    ? t('checkout.mbankHint')
                    : t('checkout.mbankSoonHint')
                }
                tag={config.payment.mbank.configured ? undefined : t('checkout.mbankSoon')}
              />
            </div>
          </fieldset>
        </div>

        <aside className="checkout__aside" aria-labelledby="summary-title">
          <div className="summary-card">
            <h2 id="summary-title" className="summary-card__title">
              {t('checkout.summary')}
            </h2>
            {cart.hasUnavailable && (
              <Notice
                tone="warning"
                action={
                  <button
                    type="button"
                    className="btn btn--sm btn--outline"
                    onClick={cart.removeUnavailable}
                  >
                    {t('cart.removeUnavailable')}
                  </button>
                }
              >
                <p>{t('cart.unavailableNotice')}</p>
              </Notice>
            )}
            <ul className="summary-lines" role="list" aria-label={t('checkout.items')}>
              {orderLines.map((line) => (
                <li key={line.product.id}>
                  <span className="summary-lines__name">
                    {name(line.product)}
                    <span className="summary-lines__qty"> × {line.quantity}</span>
                  </span>
                  <span className="summary-lines__total">
                    {som(toMinor(line.product.price) * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="totals">
              <div className="totals__row">
                <dt>{t('cart.subtotal')}</dt>
                <dd>{som(totals.subtotal)}</dd>
              </div>
              {fulfillment === 'delivery' && (
                <div className="totals__row">
                  <dt>{t('cart.delivery')}</dt>
                  <dd>{totals.deliveryFee === 0 ? t('common.free') : som(totals.deliveryFee)}</dd>
                </div>
              )}
              <div className="totals__row totals__row--grand">
                <dt>{t('cart.total')}</dt>
                <dd>{som(totals.total)}</dd>
              </div>
            </dl>
            {fulfillment === 'delivery' && (
              <DeliveryProgress subtotal={cart.subtotal} rules={rules} />
            )}
            {belowMinimum && (
              <Notice tone="info">
                <p>
                  {t('cart.minOrder', {
                    amount: som(rules.minOrderTotal),
                    left: som(totals.minOrderShortfall),
                  })}
                </p>
              </Notice>
            )}
            <p className="totals__note">{t('checkout.serverTotal')}</p>
            {requestError && (
              <Notice tone="danger" role="alert">
                <p>{requestError}</p>
              </Notice>
            )}
            <button
              type="submit"
              className="btn btn--primary btn--lg btn--block"
              disabled={belowMinimum}
              aria-disabled={submitting || undefined}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="spin" aria-hidden="true" />
                  {t('checkout.submitting')}
                </>
              ) : (
                t('checkout.submit')
              )}
            </button>
          </div>
        </aside>
      </form>
    </div>
  )
}

interface FieldProps {
  id: string
  label: string
  hint?: string
  optional?: string
  error?: string
  children: ReactNode
}

function Field({ id, label, hint, optional, error, children }: FieldProps) {
  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={id} className="field__label">
        {label}
        {optional && <span className="field__optional"> ({optional})</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field__error">
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

interface ChoiceProps {
  name: string
  value: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  icon: ReactNode
  title: string
  hint: string
  tag?: string
}

function Choice({ name, value, checked, disabled, onChange, icon, title, hint, tag }: ChoiceProps) {
  const id = `choice-${name}-${value}`
  return (
    <div className={`choice${disabled ? ' choice--disabled' : ''}`}>
      <input
        id={id}
        className="choice__input"
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={`${id}-hint`}
      />
      <label htmlFor={id} className="choice__label">
        <span className="choice__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="choice__text">
          <span className="choice__title">
            {title}
            {tag && <span className="tag">{tag}</span>}
          </span>
          <span id={`${id}-hint`} className="choice__hint">
            {hint}
          </span>
        </span>
      </label>
    </div>
  )
}
