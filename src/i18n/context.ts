import { createContext, use } from 'react'
import type { Lang, MessageKey } from './messages'
import type { Params } from './translate'

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey, params?: Params) => string
  /** Formats an API money string, e.g. "1500.00" -> "1 500 сом". */
  money: (value: string | null | undefined) => string
  /** Formats an amount in tyiyn (1/100 som). */
  som: (minor: number) => string
  name: (item: { name_ru: string; name_ky: string }) => string
  dateTime: (value: string | number) => string
  time: (value: string | number) => string
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const value = use(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}
