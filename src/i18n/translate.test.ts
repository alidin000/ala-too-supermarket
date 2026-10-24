import { describe, expect, it } from 'vitest'
import { ky, ru } from './messages'
import type { Dictionary, MessageKey } from './messages'
import { isLang, localizedName, translate } from './translate'

describe('translate', () => {
  it('uses the Kyrgyz text when it exists', () => {
    expect(translate('ky', 'cart.title')).toBe('Себет')
    expect(translate('ru', 'cart.title')).toBe('Корзина')
  })

  it('falls back to Russian for a key missing or empty in Kyrgyz', () => {
    const dictionaries: Record<'ru' | 'ky', Dictionary> = {
      ru,
      ky: { ...ky, 'cart.title': '', 'cart.empty': undefined },
    }
    expect(translate('ky', 'cart.title', {}, dictionaries)).toBe('Корзина')
    expect(translate('ky', 'cart.empty', {}, dictionaries)).toBe('Корзина пока пуста')
  })

  it('returns the key itself when no language has it', () => {
    const dictionaries: Record<'ru' | 'ky', Dictionary> = { ru: {}, ky: {} }
    expect(translate('ky', 'cart.title', {}, dictionaries)).toBe('cart.title')
  })

  it('fills in parameters and leaves unknown placeholders visible', () => {
    expect(translate('ru', 'catalog.shown', { shown: 4, total: 12 })).toBe('Показано 4 из 12')
    expect(translate('ru', 'catalog.shown', { shown: 4 })).toBe('Показано 4 из {total}')
  })

  it('picks Russian plural forms', () => {
    expect(translate('ru', 'cart.count', { count: 1 })).toBe('1 товар')
    expect(translate('ru', 'cart.count', { count: 3 })).toBe('3 товара')
    expect(translate('ru', 'cart.count', { count: 5 })).toBe('5 товаров')
    expect(translate('ru', 'cart.count', { count: 21 })).toBe('21 товар')
  })

  it('does not inflect after numbers in Kyrgyz', () => {
    expect(translate('ky', 'cart.count', { count: 5 })).toBe('5 товар')
  })

  it('every Kyrgyz key also exists in Russian', () => {
    const missing = Object.keys(ky).filter((key) => !(key in ru))
    expect(missing).toEqual([])
  })

  it('every Kyrgyz message keeps the same placeholders as the Russian one', () => {
    const placeholders = (message: unknown) =>
      [...JSON.stringify(message).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    const mismatched = (Object.keys(ky) as MessageKey[]).filter(
      (key) =>
        JSON.stringify([...new Set(placeholders(ky[key]))]) !==
        JSON.stringify([...new Set(placeholders(ru[key]))]),
    )
    expect(mismatched).toEqual([])
  })
})

describe('localizedName', () => {
  const item = { name_ru: 'Молоко', name_ky: 'Сүт' }

  it('prefers name_ky in Kyrgyz and name_ru in Russian', () => {
    expect(localizedName('ky', item)).toBe('Сүт')
    expect(localizedName('ru', item)).toBe('Молоко')
  })

  it('falls back to name_ru when name_ky is empty', () => {
    expect(localizedName('ky', { name_ru: 'Шампунь', name_ky: ' ' })).toBe('Шампунь')
  })
})

describe('isLang', () => {
  it('accepts only supported languages (guards localStorage values)', () => {
    expect(isLang('ru')).toBe(true)
    expect(isLang('ky')).toBe(true)
    expect(isLang('en')).toBe(false)
    expect(isLang(null)).toBe(false)
  })
})
