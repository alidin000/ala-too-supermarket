import { ApiError, errorKindForStatus, parseErrorBody } from './errors'
import type {
  Api,
  Category,
  Order,
  OrderCreateInput,
  Page,
  Product,
  ProductQuery,
  StoreConfig,
} from './types'

const TIMEOUT_MS = 20_000
const MAX_IDS = 100

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  params?: URLSearchParams
}

export function buildProductParams(query: ProductQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.category) params.set('category', query.category)
  if (query.search) params.set('search', query.search)
  if (query.inStock) params.set('in_stock', '1')
  if (query.ids && query.ids.length > 0) params.set('ids', query.ids.slice(0, MAX_IDS).join(','))
  if (query.page && query.page > 1) params.set('page', String(query.page))
  if (query.pageSize) params.set('page_size', String(query.pageSize))
  return params
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

export function createHttpApi(baseUrl: string, fetchImpl: typeof fetch = fetch): Api {
  const base = baseUrl.replace(/\/+$/, '')

  async function request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; status: number }> {
    const query = options.params?.toString()
    const url = `${base}${path}${query ? `?${query}` : ''}`
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TIMEOUT_MS)
    const forwardAbort = () => controller.abort()
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    if (options.signal?.aborted) controller.abort()

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        // The public API needs no cookies. Omitting them also keeps a staff member who is
        // logged in to Django admin from hitting DRF's session CSRF check on checkout.
        credentials: 'omit',
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (timedOut) throw new ApiError('timeout', 0)
      throw new ApiError('network', 0, {
        message: error instanceof Error ? error.message : 'Network error',
      })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', forwardAbort)
    }

    const body = await readJson(response)
    if (!response.ok) {
      const { fieldErrors, detail } = parseErrorBody(body)
      throw new ApiError(errorKindForStatus(response.status), response.status, {
        fieldErrors,
        detail,
      })
    }
    if (body === null) {
      // For example an HTML fallback page served where the API should be.
      throw new ApiError('server', response.status, { message: 'Expected a JSON response' })
    }
    return { data: body as T, status: response.status }
  }

  const orderPath = (token: string) => `/orders/${encodeURIComponent(token)}/`

  return {
    async getStore(signal) {
      return (await request<StoreConfig>('/store/', { signal })).data
    },
    async getCategories(signal) {
      const { data } = await request<Category[] | Page<Category>>('/categories/', { signal })
      // The contract says "plain list"; tolerate a paginated response too.
      return Array.isArray(data) ? data : data.results
    },
    async getProducts(query, signal) {
      const params = buildProductParams(query)
      return (await request<Page<Product>>('/products/', { signal, params })).data
    },
    async createOrder(input: OrderCreateInput) {
      const { data, status } = await request<Order & { token: string }>('/orders/', {
        method: 'POST',
        body: input,
      })
      return { order: data, created: status === 201 }
    },
    async getOrder(token, signal) {
      return (await request<Order>(orderPath(token), { signal })).data
    },
    async reportPayment(token, reference) {
      const path = `${orderPath(token)}payment-report/`
      return (await request<Order>(path, { method: 'POST', body: { reference } })).data
    },
  }
}
