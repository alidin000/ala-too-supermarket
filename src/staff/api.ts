// Client for the staff API (/api/staff/, STAFF_CONTRACT.md).
//
// - Auth is Django's session cookie: HttpOnly, SameSite=Strict, same origin. Requests use
//   `credentials: 'same-origin'`, and the app never reads cookies.
// - The CSRF token arrives in the JSON of /session/, /login/ and /logout/. It is held in
//   this closure only, never in localStorage or sessionStorage, and is sent as X-CSRFToken
//   on POST and PATCH. A CSRF 403 refetches /session/ and retries the request once.
// - 401 calls `onUnauthenticated` (the app goes to the login page); 403 means "Недостаточно
//   прав"; 429 carries `retry_after`.

import { parseErrorBody } from '../api/errors'
import type { FieldErrors } from '../api/errors'
import { buildOrderListParams } from './boardQuery'
import { buildProductListParams } from './productEdit'
import type {
  OrderListQuery,
  OrderPatch,
  OrderStatus,
  OrdersSummary,
  Page,
  PaymentStatus,
  ProductListQuery,
  ProductPage,
  ProductPatch,
  SessionResponse,
  StaffOrderDetail,
  StaffOrderRow,
  StaffProduct,
  StaffSession,
  StaffStoreSettings,
} from './types'

export type StaffErrorKind =
  | 'unauthenticated' // 401: not logged in, or the session ended
  | 'forbidden' // 403: logged in, but missing the permission
  | 'csrf' // 403 from the CSRF check, still failing after one retry
  | 'validation' // 400 with DRF field errors
  | 'not_found'
  | 'throttled' // 429, see retryAfter
  | 'network'
  | 'timeout'
  | 'server'
  | 'http'

interface StaffApiErrorOptions {
  fieldErrors?: FieldErrors
  detail?: string | null
  retryAfter?: number | null
  message?: string
}

export class StaffApiError extends Error {
  readonly kind: StaffErrorKind
  readonly status: number
  readonly fieldErrors: FieldErrors
  readonly detail: string | null
  /** Seconds to wait before retrying, from a 429 response. */
  readonly retryAfter: number | null

  constructor(kind: StaffErrorKind, status: number, options: StaffApiErrorOptions = {}) {
    super(options.message ?? options.detail ?? `Staff API error: ${kind} (${status})`)
    this.name = 'StaffApiError'
    this.kind = kind
    this.status = status
    this.fieldErrors = options.fieldErrors ?? {}
    this.detail = options.detail ?? null
    this.retryAfter = options.retryAfter ?? null
  }
}

export function isStaffApiError(error: unknown, kind?: StaffErrorKind): error is StaffApiError {
  return error instanceof StaffApiError && (kind === undefined || error.kind === kind)
}

function parseRetryAfter(body: unknown, header: string | null): number | null {
  if (body && typeof body === 'object' && 'retry_after' in body) {
    const value = Number((body as { retry_after: unknown }).retry_after)
    if (Number.isFinite(value) && value >= 0) return Math.ceil(value)
  }
  if (header !== null && /^\d+$/.test(header.trim())) return Number(header.trim())
  return null
}

/** Maps a failed response to a typed error. A 403 whose detail mentions CSRF is a CSRF failure. */
export function staffErrorFromResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null = null,
): StaffApiError {
  const { fieldErrors, detail } = parseErrorBody(body)
  const options = { fieldErrors, detail }
  if (status === 401) return new StaffApiError('unauthenticated', status, options)
  if (status === 403) {
    const csrf = detail !== null && /csrf/i.test(detail)
    return new StaffApiError(csrf ? 'csrf' : 'forbidden', status, options)
  }
  if (status === 400) return new StaffApiError('validation', status, options)
  if (status === 404) return new StaffApiError('not_found', status, options)
  if (status === 429) {
    return new StaffApiError('throttled', status, {
      ...options,
      retryAfter: parseRetryAfter(body, retryAfterHeader),
    })
  }
  if (status >= 500) return new StaffApiError('server', status, options)
  return new StaffApiError('http', status, options)
}

export interface StaffApi {
  getSession(signal?: AbortSignal): Promise<StaffSession>
  login(username: string, password: string): Promise<StaffSession>
  logout(): Promise<void>
  getSummary(signal?: AbortSignal): Promise<OrdersSummary>
  listOrders(query: OrderListQuery, signal?: AbortSignal): Promise<Page<StaffOrderRow>>
  getOrder(number: string, signal?: AbortSignal): Promise<StaffOrderDetail>
  changeStatus(number: string, status: OrderStatus, note?: string): Promise<StaffOrderDetail>
  changePayment(number: string, status: PaymentStatus, note?: string): Promise<StaffOrderDetail>
  cancelOrder(number: string, reason: string): Promise<StaffOrderDetail>
  updateOrder(number: string, patch: OrderPatch): Promise<StaffOrderDetail>
  listProducts(query: ProductListQuery, signal?: AbortSignal): Promise<ProductPage>
  updateProduct(id: number, patch: ProductPatch): Promise<StaffProduct>
  getStore(signal?: AbortSignal): Promise<StaffStoreSettings>
  setAcceptingOrders(value: boolean): Promise<StaffStoreSettings>
  /** Called on every 401, so the app can send the user to the login page. */
  setUnauthenticatedHandler(handler: (() => void) | null): void
}

export interface StaffApiOptions {
  /** For example "/api/staff". */
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

type Method = 'GET' | 'POST' | 'PATCH'

interface RequestOptions {
  method?: Method
  body?: unknown
  params?: URLSearchParams
  signal?: AbortSignal
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function toSession(body: SessionResponse): StaffSession {
  if (!body.authenticated) return { authenticated: false }
  return { authenticated: true, user: body.user, backofficeUrl: body.backoffice_url ?? null }
}

export function createStaffApi({
  baseUrl,
  fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = 20_000,
}: StaffApiOptions): StaffApi {
  const base = baseUrl.replace(/\/+$/, '')
  let csrfToken: string | null = null
  let onUnauthenticated: (() => void) | null = null
  let sessionRequest: Promise<StaffSession> | null = null

  function remember(body: unknown) {
    if (body && typeof body === 'object' && 'csrf_token' in body) {
      const token = (body as { csrf_token: unknown }).csrf_token
      if (typeof token === 'string' && token) csrfToken = token
    }
  }

  async function send(path: string, options: RequestOptions): Promise<unknown> {
    const method = options.method ?? 'GET'
    const query = options.params?.toString()
    const url = `${base}${path}${query ? `?${query}` : ''}`
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const forwardAbort = () => controller.abort()
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    if (options.signal?.aborted) controller.abort()

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET' && csrfToken) headers['X-CSRFToken'] = csrfToken

    let response: Response
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (timedOut) throw new StaffApiError('timeout', 0)
      throw new StaffApiError('network', 0, {
        message: error instanceof Error ? error.message : 'Network error',
      })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', forwardAbort)
    }

    const body = await readJson(response)
    remember(body)
    if (!response.ok) {
      throw staffErrorFromResponse(response.status, body, response.headers.get('Retry-After'))
    }
    if (body === null) {
      // For example the SPA's index.html served where the API should be.
      throw new StaffApiError('server', response.status, { message: 'Expected a JSON response' })
    }
    return body
  }

  /** GET /session/. Concurrent callers share one request. */
  function fetchSession(signal?: AbortSignal): Promise<StaffSession> {
    if (signal) {
      return send('/session/', { signal }).then((body) => toSession(body as SessionResponse))
    }
    sessionRequest ??= send('/session/', {})
      .then((body) => toSession(body as SessionResponse))
      .finally(() => {
        sessionRequest = null
      })
    return sessionRequest
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const unsafe = (options.method ?? 'GET') !== 'GET'
    try {
      // The first POST of a page load may come before any /session/ response.
      if (unsafe && csrfToken === null) await fetchSession()
      try {
        return (await send(path, options)) as T
      } catch (error) {
        if (!unsafe || !isStaffApiError(error, 'csrf')) throw error
        // Django rotated the token (login elsewhere, expired cookie): fetch a fresh one and
        // try exactly once more.
        await fetchSession()
        return (await send(path, options)) as T
      }
    } catch (error) {
      if (isStaffApiError(error, 'unauthenticated')) onUnauthenticated?.()
      throw error
    }
  }

  const orderPath = (number: string) => `/orders/${encodeURIComponent(number)}/`

  return {
    getSession: (signal) => fetchSession(signal),
    async login(username, password) {
      const body = await request<SessionResponse>('/login/', {
        method: 'POST',
        body: { username, password },
      })
      return toSession(body)
    },
    async logout() {
      await request<SessionResponse>('/logout/', { method: 'POST', body: {} })
    },
    getSummary: (signal) => request('/orders/summary/', { signal }),
    listOrders: (query, signal) =>
      request('/orders/', { signal, params: buildOrderListParams(query) }),
    getOrder: (number, signal) => request(orderPath(number), { signal }),
    changeStatus: (number, status, note = '') =>
      request(`${orderPath(number)}status/`, { method: 'POST', body: { status, note } }),
    changePayment: (number, status, note = '') =>
      request(`${orderPath(number)}payment/`, {
        method: 'POST',
        body: { payment_status: status, note },
      }),
    cancelOrder: (number, reason) =>
      request(`${orderPath(number)}cancel/`, { method: 'POST', body: { reason } }),
    updateOrder: (number, patch) => request(orderPath(number), { method: 'PATCH', body: patch }),
    listProducts: (query, signal) =>
      request('/products/', { signal, params: buildProductListParams(query) }),
    updateProduct: (id, patch) =>
      request(`/products/${encodeURIComponent(String(id))}/`, { method: 'PATCH', body: patch }),
    getStore: (signal) => request('/store/', { signal }),
    setAcceptingOrders: (value) =>
      request('/store/', { method: 'PATCH', body: { is_accepting_orders: value } }),
    setUnauthenticatedHandler(handler) {
      onUnauthenticated = handler
    },
  }
}
