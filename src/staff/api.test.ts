import { describe, expect, it, vi } from 'vitest'
import { createStaffApi, isStaffApiError, staffErrorFromResponse } from './api'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  credentials: RequestCredentials | undefined
}

type Handler = (call: Call, index: number) => Response | Promise<Response>

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const SESSION_USER = {
  username: 'aigerim',
  display_name: 'Айгерим',
  is_superuser: false,
  permissions: {
    view_orders: true,
    change_orders: true,
    view_products: true,
    change_products: true,
    pause_orders: true,
  },
}

const ORDER = { number: 'AT-1', status: 'confirmed' }

/** A fake server: records every request and answers with `handler`. */
function setup(handler: Handler) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      credentials: init.credentials,
    }
    calls.push(call)
    return handler(call, calls.length - 1)
  })
  const onUnauthenticated = vi.fn()
  const api = createStaffApi({ baseUrl: '/api/staff/', fetchImpl: fetchImpl as typeof fetch })
  api.setUnauthenticatedHandler(onUnauthenticated)
  return { api, calls, onUnauthenticated }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the request to fail')
}

describe('staff API client: session and CSRF', () => {
  it('sends same-origin credentials and no CSRF header on GET', async () => {
    const { api, calls } = setup(() => json(200, { authenticated: false, csrf_token: 't1' }))
    await expect(api.getSession()).resolves.toEqual({ authenticated: false })
    expect(calls[0]).toMatchObject({
      url: '/api/staff/session/',
      method: 'GET',
      credentials: 'same-origin',
    })
    expect(calls[0]?.headers['X-CSRFToken']).toBeUndefined()
  })

  it('fetches /session/ for a token before the first POST and sends it as X-CSRFToken', async () => {
    const { api, calls } = setup((call) =>
      call.url.endsWith('/session/')
        ? json(200, { authenticated: true, csrf_token: 'from-session', user: SESSION_USER })
        : json(200, ORDER),
    )
    await api.changeStatus('AT-1', 'confirmed')
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/staff/session/',
      'POST /api/staff/orders/AT-1/status/',
    ])
    expect(calls[1]?.headers['X-CSRFToken']).toBe('from-session')
    expect(calls[1]?.body).toEqual({ status: 'confirmed', note: '' })
    expect(calls[1]?.credentials).toBe('same-origin')
  })

  it('uses the rotated token from the login response for the next POST', async () => {
    const { api, calls } = setup((call) => {
      if (call.url.endsWith('/session/'))
        return json(200, { authenticated: false, csrf_token: 'old' })
      if (call.url.endsWith('/login/')) {
        return json(200, {
          authenticated: true,
          csrf_token: 'rotated',
          user: SESSION_USER,
          backoffice_url: '/backoffice/',
        })
      }
      return json(200, ORDER)
    })
    await api.getSession()
    const session = await api.login('aigerim', 'secret')
    expect(session).toEqual({
      authenticated: true,
      user: SESSION_USER,
      backofficeUrl: '/backoffice/',
    })
    expect(calls[1]?.headers['X-CSRFToken']).toBe('old')
    await api.changePayment('AT-1', 'paid')
    expect(calls[2]?.headers['X-CSRFToken']).toBe('rotated')
    expect(calls[2]?.body).toEqual({ payment_status: 'paid', note: '' })
  })

  it('on a CSRF 403 refetches /session/ and retries once with the new token', async () => {
    let session = 0
    const { api, calls } = setup((call) => {
      if (call.url.endsWith('/session/')) {
        session += 1
        return json(200, { authenticated: true, csrf_token: `t${session}`, user: SESSION_USER })
      }
      return call.headers['X-CSRFToken'] === 't2'
        ? json(200, ORDER)
        : json(403, { detail: 'CSRF Failed: CSRF token missing or incorrect.' })
    })
    await api.getSession()
    await expect(api.cancelOrder('AT-1', 'Клиент передумал')).resolves.toEqual(ORDER)
    expect(
      calls.map((call) => `${call.method} ${call.url} ${call.headers['X-CSRFToken'] ?? ''}`),
    ).toEqual([
      'GET /api/staff/session/ ',
      'POST /api/staff/orders/AT-1/cancel/ t1',
      'GET /api/staff/session/ ',
      'POST /api/staff/orders/AT-1/cancel/ t2',
    ])
  })

  it('retries a CSRF failure only once, then reports it', async () => {
    const { api, calls } = setup((call) =>
      call.url.endsWith('/session/')
        ? json(200, { authenticated: true, csrf_token: 'never-accepted', user: SESSION_USER })
        : json(403, { detail: 'CSRF Failed: CSRF cookie not set.' }),
    )
    await api.getSession()
    const error = await caught(api.updateProduct(1, { price: '90.00' }))
    expect(isStaffApiError(error, 'csrf')).toBe(true)
    const posts = calls.filter((call) => call.method === 'PATCH')
    expect(posts).toHaveLength(2)
  })

  it('does not retry GET requests on 403', async () => {
    const { api, calls } = setup(() => json(403, { detail: 'CSRF Failed: odd proxy' }))
    const error = await caught(api.getSummary())
    expect(isStaffApiError(error)).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

describe('staff API client: error mapping', () => {
  it('maps 401 to "unauthenticated" and tells the app to show the login page', async () => {
    const { api, onUnauthenticated } = setup(() => json(401, { detail: 'Войдите в систему.' }))
    const error = await caught(api.listOrders({ status: 'active' }))
    expect(isStaffApiError(error, 'unauthenticated')).toBe(true)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('maps a permission 403 to "forbidden" without retrying or logging out', async () => {
    const { api, calls, onUnauthenticated } = setup((call) =>
      call.url.endsWith('/session/')
        ? json(200, { authenticated: true, csrf_token: 't', user: SESSION_USER })
        : json(403, { detail: 'Недостаточно прав.' }),
    )
    await api.getSession()
    const error = await caught(api.setAcceptingOrders(false))
    expect(isStaffApiError(error, 'forbidden')).toBe(true)
    expect((error as { detail: string }).detail).toBe('Недостаточно прав.')
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('reads retry_after from a 429 body, falling back to the Retry-After header', async () => {
    const lockout = await caught(
      setup((call) =>
        call.url.endsWith('/session/')
          ? json(200, { authenticated: false, csrf_token: 't' })
          : json(429, { detail: 'Слишком много попыток входа.', retry_after: 900 }),
      ).api.login('aigerim', 'wrong'),
    )
    expect(isStaffApiError(lockout, 'throttled')).toBe(true)
    expect((lockout as { retryAfter: number }).retryAfter).toBe(900)

    const throttled = await caught(
      setup(() =>
        json(429, { detail: 'Request was throttled.' }, { 'Retry-After': '42' }),
      ).api.getSummary(),
    )
    expect((throttled as { retryAfter: number }).retryAfter).toBe(42)
  })

  it('keeps 400 messages per field', async () => {
    const { api } = setup((call) =>
      call.url.endsWith('/session/')
        ? json(200, { authenticated: true, csrf_token: 't', user: SESSION_USER })
        : json(400, {
            price: ['Убедитесь, что это значение больше 0.'],
            stock_quantity: ['Убедитесь, что это значение меньше либо равно 100000.'],
            non_field_errors: ['Товар архивирован.'],
          }),
    )
    const error = await caught(api.updateProduct(7, { price: '0', stock_quantity: 200000 }))
    expect(isStaffApiError(error, 'validation')).toBe(true)
    expect((error as { fieldErrors: unknown }).fieldErrors).toEqual({
      price: ['Убедитесь, что это значение больше 0.'],
      stock_quantity: ['Убедитесь, что это значение меньше либо равно 100000.'],
      non_field_errors: ['Товар архивирован.'],
    })
  })

  it('reports a dropped connection as "network" and HTML instead of JSON as "server"', async () => {
    const offline = await caught(
      setup(() => {
        throw new TypeError('Failed to fetch')
      }).api.getSummary(),
    )
    expect(isStaffApiError(offline, 'network')).toBe(true)

    const html = await caught(
      setup(() => new Response('<!doctype html><html></html>', { status: 200 })).api.getSummary(),
    )
    expect(isStaffApiError(html, 'server')).toBe(true)
  })

  it('classifies statuses without a request', () => {
    expect(staffErrorFromResponse(404, { detail: 'Заказ не найден.' }).kind).toBe('not_found')
    expect(staffErrorFromResponse(503, null).kind).toBe('server')
    expect(staffErrorFromResponse(403, { detail: 'CSRF Failed: x' }).kind).toBe('csrf')
    expect(staffErrorFromResponse(429, {}, null).retryAfter).toBeNull()
  })
})
