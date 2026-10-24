import { useI18n } from '../i18n/context'
import { LANGS } from '../i18n/messages'
import type { Lang } from '../i18n/messages'

// Each option is labelled in its own language, so a speaker finds it whatever is active.
const OPTIONS: Record<Lang, { short: string; full: string }> = {
  ru: { short: 'Рус', full: 'Русский' },
  ky: { short: 'Кыр', full: 'Кыргызча' },
}

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          className="lang-switch__option"
          aria-pressed={lang === code}
          aria-label={OPTIONS[code].full}
          onClick={() => setLang(code)}
        >
          {OPTIONS[code].short}
        </button>
      ))}
    </div>
  )
}
