import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { formatMoney, formatSom } from '../lib/money'
import { readStorage, writeStorage } from '../lib/storage'
import { I18nContext } from './context'
import type { I18n } from './context'
import { DEFAULT_LANG } from './messages'
import type { Lang } from './messages'
import { isLang, localizedName, translate } from './translate'

const STORAGE_KEY = 'ala-too:lang'
const LOCALES: Record<Lang, string> = { ru: 'ru-RU', ky: 'ky-KG' }
const STORE_TIME_ZONE = 'Asia/Bishkek'

function initialLang(): Lang {
  const stored = readStorage(STORAGE_KEY)
  return isLang(stored) ? stored : DEFAULT_LANG
}

interface I18nProviderProps {
  children: ReactNode
  /** Forces one language (the staff panel is Russian-only) without changing the saved choice. */
  lockedLang?: Lang
}

export function I18nProvider({ children, lockedLang }: I18nProviderProps) {
  const [chosenLang, setLangState] = useState<Lang>(initialLang)
  const lang = lockedLang ?? chosenLang

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    writeStorage(STORAGE_KEY, next)
  }, [])

  const value = useMemo<I18n>(() => {
    const dateTime = new Intl.DateTimeFormat(LOCALES[lang], {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: STORE_TIME_ZONE,
    })
    const time = new Intl.DateTimeFormat(LOCALES[lang], {
      timeStyle: 'short',
      timeZone: STORE_TIME_ZONE,
    })
    const safe = (format: Intl.DateTimeFormat, value: string | number) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '' : format.format(date)
    }
    return {
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      money: (value) => formatMoney(value, lang),
      som: (minor) => formatSom(minor, lang),
      name: (item) => localizedName(lang, item),
      dateTime: (value) => safe(dateTime, value),
      time: (value) => safe(time, value),
    }
  }, [lang, setLang])

  return <I18nContext value={value}>{children}</I18nContext>
}
