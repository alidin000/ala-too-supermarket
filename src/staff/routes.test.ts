import { describe, expect, it } from 'vitest'
import { isStaffPath, parseRoute } from '../lib/router'
import { loginHref, parseStaffRoute, sanitizeNext, staffHref } from './routes'

describe('isStaffPath', () => {
  it('matches /admin and everything below it, nothing else', () => {
    expect(isStaffPath('/admin')).toBe(true)
    expect(isStaffPath('/admin/')).toBe(true)
    expect(isStaffPath('/admin/orders/AT-000123')).toBe(true)
    expect(isStaffPath('/')).toBe(false)
    expect(isStaffPath('/administrator')).toBe(false)
    expect(isStaffPath('/backoffice/')).toBe(false)
  })
})

describe('customer routes stay query-based', () => {
  it('parses the storefront URLs exactly as before', () => {
    expect(parseRoute('?view=checkout')).toEqual({ name: 'checkout' })
    expect(parseRoute('?view=orders')).toEqual({ name: 'orders' })
    expect(parseRoute('?order=tok_123')).toEqual({ name: 'order', token: 'tok_123' })
    expect(parseRoute('?category=produkty&q=молоко')).toEqual({
      name: 'catalog',
      category: 'produkty',
      q: 'молоко',
    })
  })
})

describe('parseStaffRoute', () => {
  it('maps /admin to the board with default filters', () => {
    expect(parseStaffRoute('/admin', '')).toEqual({
      name: 'board',
      filters: { tab: 'active', paymentPending: false, q: '' },
    })
    expect(parseStaffRoute('/admin/', '').name).toBe('board')
  })

  it('reads board filters from the query and ignores unknown tabs', () => {
    expect(parseStaffRoute('/admin', '?status=ready&payment=pending&q=%20Айгерим%20')).toEqual({
      name: 'board',
      filters: { tab: 'ready', paymentPending: true, q: 'Айгерим' },
    })
    expect(parseStaffRoute('/admin', '?status=deleted')).toMatchObject({
      filters: { tab: 'active' },
    })
  })

  it('parses an order page, with or without a trailing slash', () => {
    expect(parseStaffRoute('/admin/orders/AT-1', '')).toEqual({ name: 'order', number: 'AT-1' })
    expect(parseStaffRoute('/admin/orders/AT-000123/', '')).toEqual({
      name: 'order',
      number: 'AT-000123',
    })
  })

  it('rejects order numbers that are not plain codes', () => {
    expect(parseStaffRoute('/admin/orders/%3Cscript%3E', '').name).toBe('not_found')
    expect(parseStaffRoute('/admin/orders/%E0%A4%A', '').name).toBe('not_found')
    expect(parseStaffRoute('/admin/orders/', '').name).toBe('not_found')
    expect(parseStaffRoute('/admin/orders/AT-1/extra', '').name).toBe('not_found')
  })

  it('parses products with filters, and unknown paths as not found', () => {
    expect(parseStaffRoute('/admin/products', '?stock=low&active=0&category=produkty')).toEqual({
      name: 'products',
      filters: { q: '', category: 'produkty', stock: 'low', active: '0' },
    })
    expect(parseStaffRoute('/admin/products', '?stock=lots&active=yes')).toMatchObject({
      filters: { stock: 'all', active: '' },
    })
    expect(parseStaffRoute('/admin/settings', '').name).toBe('not_found')
  })

  it('parses login with a sanitised next', () => {
    expect(parseStaffRoute('/admin/login', '?next=%2Fadmin%2Forders%2FAT-1')).toEqual({
      name: 'login',
      next: '/admin/orders/AT-1',
    })
    expect(parseStaffRoute('/admin/login', '?next=https%3A%2F%2Fevil.com')).toEqual({
      name: 'login',
      next: '/admin',
    })
    expect(parseStaffRoute('/admin/login', '')).toEqual({ name: 'login', next: '/admin' })
  })
})

describe('sanitizeNext', () => {
  it.each([
    ['//evil.com'],
    ['https://evil.com'],
    ['http://evil.com/admin'],
    ['/admin@evil'],
    ['/admin@evil.com/x'],
    ['/'],
    ['/administrator'],
    ['/\\evil.com'],
    ['\\\\evil.com'],
    ['/admin\\..\\evil'],
    ['/admin/\\evil.com'],
    ['/admin//evil.com'],
    ['/admin/../evil'],
    ['/admin/%2e%2e/evil'],
    ['/admin/%2E%2E/%2E%2E/evil'],
    ['javascript:alert(1)'],
    ['/admin\njavascript:alert(1)'],
    [' /admin'],
    ['/admin/login'],
    ['/admin/login?next=/admin'],
    [''],
    [null],
    [undefined],
  ])('rejects %j', (raw) => {
    expect(sanitizeNext(raw)).toBe('/admin')
  })

  it.each([
    ['/admin', '/admin'],
    ['/admin/', '/admin/'],
    ['/admin/orders/AT-1', '/admin/orders/AT-1'],
    ['/admin?status=new&q=%D0%90', '/admin?status=new&q=%D0%90'],
    ['/admin/products?stock=low', '/admin/products?stock=low'],
  ])('accepts %j', (raw, expected) => {
    expect(sanitizeNext(raw)).toBe(expected)
  })

  it('refuses very long values', () => {
    expect(sanitizeNext(`/admin/${'a'.repeat(600)}`)).toBe('/admin')
  })
})

describe('staff hrefs', () => {
  it('round-trips board and product filters through the URL', () => {
    const board = {
      name: 'board' as const,
      filters: { tab: 'new' as const, paymentPending: true, q: 'AT-12' },
    }
    const href = staffHref(board)
    expect(href).toBe('/admin?status=new&payment=pending&q=AT-12')
    const [path, query] = href.split('?')
    expect(parseStaffRoute(path ?? '', `?${query}`)).toEqual(board)
  })

  it('leaves default filters out of the URL', () => {
    expect(
      staffHref({ name: 'board', filters: { tab: 'active', paymentPending: false, q: '' } }),
    ).toBe('/admin')
    expect(
      staffHref({ name: 'products', filters: { q: '', category: '', stock: 'all', active: '' } }),
    ).toBe('/admin/products')
  })

  it('encodes the order number and builds login links with a safe next', () => {
    expect(staffHref({ name: 'order', number: 'AT-000123' })).toBe('/admin/orders/AT-000123')
    expect(loginHref('/admin/orders/AT-1')).toBe('/admin/login?next=%2Fadmin%2Forders%2FAT-1')
    expect(loginHref('/admin')).toBe('/admin/login')
    expect(loginHref('//evil.com')).toBe('/admin/login')
  })
})
