import { Apple, Banknote, Croissant, Gift, Milk, Store, Truck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStoreConfig } from '../config/context'
import { useI18n } from '../i18n/context'

export function Hero() {
  const { t } = useI18n()
  const { config } = useStoreConfig()
  return (
    <section className="hero container" aria-labelledby="page-title">
      <div className="hero__inner">
        <div className="hero__copy">
          <p className="hero__eyebrow">
            {t('hero.eyebrow', { city: config?.city || 'Кызыл-Кия' })}
          </p>
          <h1 id="page-title" className="hero__title" tabIndex={-1}>
            {t('hero.title1')} <em>{t('hero.title2')}</em>
          </h1>
          <p className="hero__text">{t('hero.text')}</p>
          <a href="#catalog" className="btn btn--primary hero__cta">
            {t('hero.cta')}
          </a>
          <Perks />
        </div>
        <HeroArt />
      </div>
    </section>
  )
}

function Perks() {
  const { t, som } = useI18n()
  const { config, rules } = useStoreConfig()
  if (!config || !rules) return <div className="perks perks--placeholder" aria-hidden="true" />

  const perks: { key: string; Icon: LucideIcon; text: string }[] = []
  if (config.fulfillment.delivery_enabled) {
    const fee = rules.deliveryFee === 0 ? t('common.free').toLowerCase() : som(rules.deliveryFee)
    perks.push({ key: 'delivery', Icon: Truck, text: t('perk.delivery', { fee }) })
    if (rules.freeDeliveryFrom !== null && rules.deliveryFee > 0) {
      const amount = som(rules.freeDeliveryFrom)
      perks.push({ key: 'free', Icon: Gift, text: t('perk.deliveryFree', { amount }) })
    }
  }
  if (config.fulfillment.pickup_enabled) {
    perks.push({ key: 'pickup', Icon: Store, text: t('perk.pickup') })
  }
  if (config.payment.cash_enabled) {
    perks.push({ key: 'cash', Icon: Banknote, text: t('perk.cash') })
  }

  return (
    <ul className="perks" role="list" aria-label={t('perk.label')}>
      {perks.map(({ key, Icon, text }) => (
        <li key={key} className="perks__item">
          <Icon aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  )
}

/** Ала-Тоо: snowy peaks, green foothills and a morning sun, with a few groceries. */
function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg className="hero-art__scene" viewBox="0 0 480 320" preserveAspectRatio="xMidYMax slice">
        <circle cx="352" cy="96" r="52" fill="var(--c-sun)" />
        <path
          d="M0 236 72 150l40 44 76-118 62 98 46-60 70 92 44-50 70 74v90H0Z"
          fill="var(--c-hill-far)"
        />
        <path d="m188 76-22 34 13-6 9 12 10-14 13 8Zm108 64-16 21 10-4 6 8 8-9 10 4Z" fill="#fff" />
        <path d="M0 262c84-40 160-32 240 0s160 26 240-18v76H0Z" fill="var(--c-hill-mid)" />
        <path d="M0 292c96-30 196-24 286 4 76 22 136 12 194-12v36H0Z" fill="var(--c-hill-near)" />
      </svg>
      <span className="hero-art__tile hero-art__tile--1">
        <Milk strokeWidth={1.6} />
      </span>
      <span className="hero-art__tile hero-art__tile--2">
        <Apple strokeWidth={1.6} />
      </span>
      <span className="hero-art__tile hero-art__tile--3">
        <Croissant strokeWidth={1.6} />
      </span>
    </div>
  )
}
