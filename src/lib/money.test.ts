import { describe, expect, it } from 'vitest'
import { formatMoney, formatSom, toMinor } from './money'

// \s matches both the no-break space and the narrow no-break space that Intl may use.
describe('toMinor', () => {
  it('parses API money strings into whole tyiyn', () => {
    expect(toMinor('85.00')).toBe(8500)
    expect(toMinor('0.10')).toBe(10)
    expect(toMinor('1500.5')).toBe(150050)
    expect(toMinor('2000')).toBe(200000)
  })

  it('does not drift like floating point would', () => {
    const sum = ['0.10', '0.20'].map(toMinor).reduce((a, b) => a + b, 0)
    expect(sum).toBe(30)
  })

  it('returns NaN for values that are not money', () => {
    expect(toMinor('')).toBeNaN()
    expect(toMinor('85,00')).toBeNaN()
    expect(toMinor('1e3')).toBeNaN()
    expect(toMinor(null)).toBeNaN()
  })
})

describe('formatSom / formatMoney', () => {
  it('formats whole som without decimals and groups thousands', () => {
    expect(formatMoney('85.00')).toMatch(/^85\sсом$/)
    expect(formatMoney('1500.00')).toMatch(/^1\s500\sсом$/)
    expect(formatSom(12_345_600)).toMatch(/^123\s456\sсом$/)
  })

  it('shows two decimals only when there are tyiyn', () => {
    expect(formatMoney('85.50')).toMatch(/^85,50\sсом$/)
  })

  it('keeps the amount and "сом" on one line', () => {
    expect(formatMoney('85.00')).toContain('\u00a0сом')
  })

  it('formats the same way in Kyrgyz', () => {
    expect(formatMoney('1500.00', 'ky')).toMatch(/^1\s500\sсом$/)
  })

  it('shows a dash instead of "NaN сом" for bad input', () => {
    expect(formatMoney('oops')).toBe('—')
  })
})
