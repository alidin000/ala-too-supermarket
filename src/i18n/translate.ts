import { DEFAULT_LANG, ky, LANGS, ru } from './messages'
import type { Dictionary, Lang, Message, MessageKey } from './messages'

export type Params = Record<string, string | number>

const DICTIONARIES: Record<Lang, Dictionary> = { ru, ky }
const pluralRules = new Map<Lang, Intl.PluralRules>()

function selectPlural(lang: Lang, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(lang)
    pluralRules.set(lang, rules)
  }
  return rules.select(count)
}

function lookup(dictionary: Dictionary, key: MessageKey): Message | undefined {
  const message = dictionary[key]
  // An empty translation is treated as missing, so the Russian text shows instead.
  return message === '' ? undefined : message
}

/** Translates `key`, falling back to Russian, then to the key itself. */
export function translate(
  lang: Lang,
  key: MessageKey,
  params: Params = {},
  dictionaries: Record<Lang, Dictionary> = DICTIONARIES,
): string {
  let usedLang = lang
  let message = lookup(dictionaries[lang], key)
  if (message === undefined) {
    usedLang = DEFAULT_LANG
    message = lookup(dictionaries[DEFAULT_LANG], key)
  }
  if (message === undefined) return key

  let text: string
  if (typeof message === 'string') {
    text = message
  } else {
    const form = selectPlural(usedLang, Number(params.count ?? 0))
    text = message[form as keyof typeof message] ?? message.other
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Picks the Kyrgyz name when there is one, else the Russian one (the API allows empty name_ky). */
export function localizedName(lang: Lang, item: { name_ru: string; name_ky: string }): string {
  if (lang === 'ky' && item.name_ky.trim()) return item.name_ky
  return item.name_ru
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}
