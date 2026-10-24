import { FlaskConical, Store } from 'lucide-react'
import { useStoreConfig } from '../config/context'
import { useI18n } from '../i18n/context'

/** Always visible in mock mode, so a demo order is never mistaken for a real one. */
export function DemoBanner() {
  const { t } = useI18n()
  return (
    <div className="demo-banner" role="note">
      <div className="container demo-banner__inner">
        <FlaskConical className="demo-banner__icon" aria-hidden="true" />
        <p>
          <strong className="demo-banner__title">{t('demo.title')}</strong> {t('demo.text')}
        </p>
      </div>
    </div>
  )
}

export function ClosedBanner() {
  const { t } = useI18n()
  const { config } = useStoreConfig()
  if (!config || config.is_accepting_orders) return null
  return (
    <div className="closed-banner">
      <div className="container closed-banner__inner">
        <Store className="closed-banner__icon" aria-hidden="true" />
        <p>{t('closed.banner')}</p>
      </div>
    </div>
  )
}
