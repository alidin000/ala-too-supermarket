// Mirrors the backend phone rule in API contract v1: Kyrgyz numbers, +996 and 9 digits.
// Accepted: "+996 555 123 456", "996555123456", "0555 123 456", "555123456".
// Spaces, dashes and parentheses are ignored. Anything else is rejected.

const IGNORED = /[\s\-()]/g
const KG_PHONE = /^(?:\+996|996|0)?(\d{9})$/

/** Returns the canonical "+996555123456" form, or null when the input is not accepted. */
export function normalizeKgPhone(input: string): string | null {
  const match = KG_PHONE.exec(input.replace(IGNORED, ''))
  return match ? `+996${match[1]}` : null
}

/** "+996555123456" -> "+996 555 123 456". Other values are returned unchanged. */
export function formatKgPhone(phone: string): string {
  const match = /^\+996(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return match ? `+996 ${match[1]} ${match[2]} ${match[3]}` : phone
}

/** A staff-entered phone, shown as "+996 555 123 456" when it is a Kyrgyz number. */
export function displayPhone(phone: string): string {
  const normalized = normalizeKgPhone(phone)
  return normalized ? formatKgPhone(normalized) : phone
}

/** A tel: URI for a phone number typed by staff in admin. */
export function telHref(phone: string): string {
  const normalized = normalizeKgPhone(phone)
  return `tel:${normalized ?? phone.replace(/[^\d+]/g, '')}`
}
