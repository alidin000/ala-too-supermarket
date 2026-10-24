import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAnnounce } from '../a11y/announce'
import { api, ApiError } from '../api'
import type { MbankConfig, Order } from '../api/types'
import { useI18n } from '../i18n/context'
import { displayPhone } from '../lib/phone'
import { CopyButton } from './CopyButton'
import { Notice } from './Notice'

interface MbankPaymentProps {
  token: string
  order: Order
  mbank: MbankConfig | null
  onUpdated: (order: Order) => void
}

/**
 * Manual MBANK transfer: the real details from store config, the order number for the
 * transfer comment, and the "Я оплатил(а)" report. Shown only when MBANK is configured;
 * there is no placeholder QR anywhere.
 */
export function MbankPayment({ token, order, mbank, onUpdated }: MbankPaymentProps) {
  const { t, money } = useI18n()
  const announce = useAnnounce()
  const [reference, setReference] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const active = order.status !== 'cancelled' && order.status !== 'completed'
  const canReport =
    active && (order.payment_status === 'unpaid' || order.payment_status === 'rejected')

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const updated = await api.reportPayment(token, reference.trim())
      setSent(true)
      onUpdated(updated)
      announce(t('mbank.reported'))
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.kind === 'validation'
          ? [...Object.values(caught.fieldErrors).flat(), caught.detail ?? '']
              .filter(Boolean)
              .join(' ') || t('mbank.reportError')
          : t('mbank.reportError')
      setError(message)
    } finally {
      setSending(false)
    }
  }

  if (sent || order.payment_status === 'pending') {
    return (
      <Notice tone="success" role="status">
        <p>{sent ? t('mbank.reported') : t('mbank.pending')}</p>
      </Notice>
    )
  }
  if (!canReport) return null
  if (!mbank?.configured) {
    return (
      <Notice tone="warning">
        <p>{t('mbank.unavailable')}</p>
      </Notice>
    )
  }

  return (
    <div className="mbank">
      <h3 className="mbank__title">{t('mbank.title')}</h3>
      {order.payment_status === 'rejected' && (
        <Notice tone="warning">
          <p>{t('mbank.rejected')}</p>
        </Notice>
      )}
      <p>{t('mbank.amount', { amount: money(order.total) })}</p>
      <dl className="mbank__details">
        {mbank.recipient_name && (
          <div>
            <dt>{t('mbank.recipient')}</dt>
            <dd>{mbank.recipient_name}</dd>
          </div>
        )}
        {mbank.phone && (
          <div>
            <dt>{t('mbank.phone')}</dt>
            <dd className="mbank__copyable">
              {displayPhone(mbank.phone)}
              <CopyButton value={mbank.phone} label={t('mbank.phone')} />
            </dd>
          </div>
        )}
        <div>
          <dt>{t('mbank.comment')}</dt>
          <dd className="mbank__copyable">
            <strong className="mbank__number">{order.number}</strong>
            <CopyButton value={order.number} label={t('order.copyNumber')} />
          </dd>
        </div>
      </dl>
      {mbank.qr_image_url && (
        <img
          className="mbank__qr"
          src={mbank.qr_image_url}
          alt={t('mbank.qrAlt')}
          width={200}
          height={200}
          loading="lazy"
        />
      )}
      <p className="muted">{t('mbank.manual')}</p>

      <form className="mbank__report" onSubmit={report}>
        <p className="mbank__report-title">{t('mbank.reportTitle')}</p>
        <div className="field">
          <label htmlFor="payment-reference" className="field__label">
            {t('mbank.reference')}
            <span className="field__optional"> ({t('common.optional')})</span>
          </label>
          <input
            id="payment-reference"
            className="input"
            type="text"
            value={reference}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setReference(event.target.value)}
            aria-describedby="payment-reference-hint"
          />
          <p id="payment-reference-hint" className="field__hint">
            {t('mbank.referenceHint')}
          </p>
        </div>
        {error && (
          <Notice tone="danger" role="alert">
            <p>{error}</p>
          </Notice>
        )}
        <button type="submit" className="btn btn--primary" aria-disabled={sending || undefined}>
          {sending ? t('mbank.reporting') : t('mbank.report')}
        </button>
      </form>
    </div>
  )
}
