import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/translate'
import { mapServerErrors, validateCheckout } from './checkoutForm'

const filled = { name: 'Айгерим', phone: '0555 123 456', address: 'Киевская 10', note: '' }

describe('validateCheckout', () => {
  it('accepts a complete delivery form', () => {
    expect(validateCheckout(filled, 'delivery')).toEqual({})
  })

  it('requires an address for delivery only', () => {
    const form = { ...filled, address: '   ' }
    expect(validateCheckout(form, 'delivery')).toEqual({ address: 'validation.addressRequired' })
    expect(validateCheckout(form, 'pickup')).toEqual({})
  })

  it('flags a missing name and a non-Kyrgyz phone', () => {
    const errors = validateCheckout({ ...filled, name: ' ', phone: '+7 701 123 4567' }, 'pickup')
    expect(errors).toEqual({
      customer_name: 'validation.nameRequired',
      phone: 'validation.phoneInvalid',
    })
  })
})

describe('mapServerErrors (DRF 400 body)', () => {
  const t = (key: Parameters<typeof translate>[1]) => translate('ky', key)

  it('puts field errors inline and the rest in the summary', () => {
    const mapped = mapServerErrors(
      {
        phone: ['Введите номер в формате +996 XXX XXX XXX.'],
        items: ['Недостаточно товара «Рис»: доступно 2 шт.'],
        non_field_errors: ['Минимальная сумма заказа — 300 сом.'],
      },
      'ru',
      t,
    )
    expect(mapped.fields).toEqual({ phone: 'Введите номер в формате +996 XXX XXX XXX.' })
    expect(mapped.general).toEqual([
      'Недостаточно товара «Рис»: доступно 2 шт.',
      'Минимальная сумма заказа — 300 сом.',
    ])
    expect(mapped.itemsRejected).toBe(true)
  })

  it('shows translated text for known fields in Kyrgyz', () => {
    const mapped = mapServerErrors({ address: ['Укажите адрес доставки.'] }, 'ky', t)
    expect(mapped.fields.address).toBe('Жеткирүү дарегин жазыңыз')
    expect(mapped.itemsRejected).toBe(false)
  })
})
