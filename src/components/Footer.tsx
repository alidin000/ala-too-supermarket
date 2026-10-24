import { Clock, MapPin, Phone } from 'lucide-react'
import { IS_MOCK } from '../api'
import { useStoreConfig } from '../config/context'
import { useI18n } from '../i18n/context'
import { displayPhone, telHref } from '../lib/phone'
import { catalogRoute } from '../lib/router'
import { BrandMark } from './BrandMark'
import { Link } from './Link'

export function Footer() {
  const { t } = useI18n()
  const { config } = useStoreConfig()
  const phone = config?.phone.trim() ?? ''
  const address = config?.pickup_address.trim() ?? ''
  const hours = config?.opening_hours.trim() ?? ''
  const hasContacts = Boolean(phone || address || hours)

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <BrandMark size={36} />
          <div>
            <p className="site-footer__name">{config?.name || t('app.name')}</p>
            <p className="site-footer__tagline">
              {t('app.tagline')}
              {config?.city ? ` · ${config.city}` : ''}
            </p>
          </div>
        </div>

        <section className="site-footer__section" aria-labelledby="footer-contacts">
          <h2 id="footer-contacts" className="site-footer__heading">
            {t('footer.contacts')}
          </h2>
          {hasContacts ? (
            <ul className="site-footer__list" role="list">
              {phone && (
                <li>
                  <Phone aria-hidden="true" />
                  <span className="visually-hidden">{t('footer.phone')}: </span>
                  <a href={telHref(phone)}>{displayPhone(phone)}</a>
                </li>
              )}
              {address && (
                <li>
                  <MapPin aria-hidden="true" />
                  <span className="visually-hidden">{t('footer.address')}: </span>
                  {address}
                </li>
              )}
              {hours && (
                <li>
                  <Clock aria-hidden="true" />
                  <span className="visually-hidden">{t('footer.hours')}: </span>
                  {hours}
                </li>
              )}
            </ul>
          ) : (
            <p className="site-footer__muted">{t('footer.ask')}</p>
          )}
        </section>

        <nav className="site-footer__section" aria-labelledby="footer-links">
          <h2 id="footer-links" className="site-footer__heading">
            {t('footer.links')}
          </h2>
          <ul className="site-footer__list" role="list">
            <li>
              <Link to={catalogRoute()}>{t('footer.catalog')}</Link>
            </li>
            <li>
              <Link to={{ name: 'orders' }}>{t('header.orders')}</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="container site-footer__bottom">
        <p>© {config?.name || t('app.name')}</p>
        {IS_MOCK && <p>{t('footer.demo')}</p>}
      </div>
    </footer>
  )
}
