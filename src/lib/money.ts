import type { Lang } from '../i18n/messages'

const MONEY_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/

/**
 * Converts an API money string ("85.00") to integer tyiyn (1/100 som), so sums never
 * suffer from floating-point drift. Returns NaN for anything that is not a money value.
 */
export function toMinor(value: string | null | undefined): number {
  if (typeof value !== 'string') return Number.NaN
  const match = MONEY_PATTERN.exec(value.trim())
  if (!match) return Number.NaN
  const whole = Number(match[2] ?? '0')
  const fraction = Number((match[3] ?? '').padEnd(2, '0'))
  const minor = whole * 100 + fraction
  return match[1] ? -minor : minor
}

const LOCALES: Record<Lang, string> = { ru: 'ru-RU', ky: 'ky-KG' }
const formatters = new Map<string, Intl.NumberFormat>()

function numberFormat(lang: Lang, fractional: boolean): Intl.NumberFormat {
  const key = `${lang}:${fractional ? 2 : 0}`
  let formatter = formatters.get(key)
  if (!formatter) {
    const digits = fractional ? 2 : 0
    formatter = new Intl.NumberFormat(LOCALES[lang], {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatters.set(key, formatter)
  }
  return formatter
}

/** Formats tyiyn as "1 500 сом" (or "85,50 сом" when there are tyiyn). */
export function formatSom(minor: number, lang: Lang = 'ru'): string {
  if (!Number.isFinite(minor)) return '—'
  const fractional = minor % 100 !== 0
  // A no-break space keeps the amount and the currency on one line.
  return `${numberFormat(lang, fractional).format(minor / 100)}\u00a0сом`
}

export function formatMoney(value: string | null | undefined, lang: Lang = 'ru'): string {
  return formatSom(toMinor(value), lang)
}
