import { describe, expect, it } from 'vitest'
import { formatKgPhone, normalizeKgPhone } from './phone'

describe('normalizeKgPhone (mirrors the backend rule)', () => {
  it.each([
    '+996 555 123 456',
    '996555123456',
    '0555 123 456',
    '555123456',
    '+996 (555) 12-34-56',
    ' 0555-123-456 ',
  ])('accepts %j as +996555123456', (input) => {
    expect(normalizeKgPhone(input)).toBe('+996555123456')
  })

  it.each([
    '',
    'phone',
    '12345',
    '+996 555 123 45', // 8 digits
    '+996 555 123 4567', // 10 digits
    '+996 0555 123 456', // trunk 0 after the country code
    '8 555 123 456', // old long-distance prefix
    '+7 701 123 4567', // Kazakhstan
    '+555123456', // "+" without 996
    '0555.123.456', // dots are not ignored by the backend
  ])('rejects %j', (input) => {
    expect(normalizeKgPhone(input)).toBeNull()
  })
})

describe('formatKgPhone', () => {
  it('groups a canonical number for display', () => {
    expect(formatKgPhone('+996555123456')).toBe('+996 555 123 456')
  })

  it('leaves anything else unchanged', () => {
    expect(formatKgPhone('уточняйте')).toBe('уточняйте')
  })
})
