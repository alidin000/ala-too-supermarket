import type { FieldErrors } from '../api/errors'
import type { Fulfillment } from '../api/types'
import type { Lang, MessageKey } from '../i18n/messages'
import { normalizeKgPhone } from '../lib/phone'

export interface CheckoutForm {
  name: string
  phone: string
  address: string
  note: string
}

/** Form fields, named as the API names them, so server errors map straight onto them. */
export type CheckoutField = 'customer_name' | 'phone' | 'address' | 'customer_note'
export const CHECKOUT_FIELDS: readonly CheckoutField[] = [
  'customer_name',
  'phone',
  'address',
  'customer_note',
]

export const LIMITS = { name: 160, address: 1000, note: 1000 } as const

/** Client-side checks that mirror the server, so most mistakes are caught without a request. */
export function validateCheckout(
  form: CheckoutForm,
  fulfillment: Fulfillment,
): Partial<Record<CheckoutField, MessageKey>> {
  const errors: Partial<Record<CheckoutField, MessageKey>> = {}
  const name = form.name.trim()
  if (!name) errors.customer_name = 'validation.nameRequired'
  else if (name.length > LIMITS.name) errors.customer_name = 'validation.tooLong'

  if (!form.phone.trim()) errors.phone = 'validation.phoneRequired'
  else if (!normalizeKgPhone(form.phone)) errors.phone = 'validation.phoneInvalid'

  if (fulfillment === 'delivery') {
    const address = form.address.trim()
    if (!address) errors.address = 'validation.addressRequired'
    else if (address.length > LIMITS.address) errors.address = 'validation.tooLong'
  }
  if (form.note.trim().length > LIMITS.note) errors.customer_note = 'validation.tooLong'
  return errors
}

// Server messages are Russian. In Kyrgyz, the fields we can describe ourselves get our
// own translated text; everything else is shown as the server sent it.
const KYRGYZ_FIELD_MESSAGES: Partial<Record<CheckoutField, MessageKey>> = {
  customer_name: 'validation.nameRequired',
  phone: 'validation.phoneInvalid',
  address: 'validation.addressRequired',
}

export interface MappedErrors {
  fields: Partial<Record<CheckoutField, string>>
  general: string[]
  /** The server rejected one or more items (stock or availability changed). */
  itemsRejected: boolean
}

/** Splits a DRF 400 body into inline field errors and messages for the error summary. */
export function mapServerErrors(
  errors: FieldErrors,
  lang: Lang,
  translate: (key: MessageKey) => string,
): MappedErrors {
  const fields: Partial<Record<CheckoutField, string>> = {}
  const general: string[] = []
  for (const [key, messages] of Object.entries(errors)) {
    if ((CHECKOUT_FIELDS as readonly string[]).includes(key)) {
      const field = key as CheckoutField
      const ownKey = KYRGYZ_FIELD_MESSAGES[field]
      fields[field] = lang === 'ky' && ownKey ? translate(ownKey) : messages.join(' ')
    } else {
      general.push(...messages)
    }
  }
  return { fields, general, itemsRejected: 'items' in errors }
}
