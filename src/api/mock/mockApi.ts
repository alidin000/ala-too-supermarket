/**
 * In-browser implementation of API contract v1, used when VITE_USE_MOCK=1.
 * Orders and stock are kept in localStorage, so the order page survives a reload.
 *
 * Demo switches. Add them to the URL once; they stay on for the browser tab:
 *   ?mock=fail-products  the next product request fails with HTTP 500 (Retry then works)
 *   ?mock=throttle       the next order request gets HTTP 429
 *   ?mock=offline        the next request fails like a dropped connection
 *   ?mock=closed         the store is not accepting orders
 *   ?mock=mbank          MBANK transfer is "configured" with obviously fake details
 *   ?mock=paged          4 products per page, to show "Показать ещё"
 *   ?mock=fast           no simulated latency
 *   ?mock=csrf           (staff panel) the next POST/PATCH meets a rotated CSRF token
 *   ?mock=reset          forget demo orders and restore stock
 *   ?mock=off            turn every switch off
 * Combine them with commas, for example ?mock=paged,mbank
 *
 * The staff panel's mock (src/staff/mock/) shares this database: orders placed here show
 * up on its board, and its price, stock, visibility and "pause orders" edits show up here.
 * Once the staff panel has been opened, order statuses change only through it.
 */
import { normalizeKgPhone } from '../../lib/phone'
import { ApiError } from '../errors'
import type { FieldErrors } from '../errors'
import type { Api, Category, Order, OrderCreateInput, Page, Product, ProductQuery } from '../types'
import { MOCK_CATEGORIES, MOCK_PRODUCTS, mockStoreConfig } from './data'
import type { MockProduct } from './data'
import {
  consumeFlag,
  effectiveProduct,
  hasFlag,
  initFlags,
  loadDb,
  minorOf,
  money,
  randomToken,
  saveDb,
  sleep,
  withLiveStatus,
} from './shared'
import type { MockDb, StoredOrder } from './shared'

// --- Helpers ------------------------------------------------------------------------------

async function simulateNetwork(signal?: AbortSignal): Promise<void> {
  if (!hasFlag('fast')) await sleep(250 + Math.random() * 450, signal)
  if (consumeFlag('offline')) throw new ApiError('network', 0, { message: 'Failed to fetch' })
}

function toProduct(base: MockProduct, db: MockDb): Product {
  const product = effectiveProduct(base, db)
  const stock = db.stock[product.id] ?? 0
  const category = MOCK_CATEGORIES.find((row) => row.id === product.category)
  return {
    id: product.id,
    sku: product.sku,
    category: product.category,
    category_slug: category?.slug ?? '',
    name_ru: product.name_ru,
    name_ky: product.name_ky,
    description: product.description,
    price: product.price,
    unit: product.unit,
    image_url: '',
    in_stock: stock > 0,
    max_quantity: Math.min(stock, 100),
    badge: product.badge,
  }
}

function descendantIds(categoryId: number): Set<number> {
  const ids = new Set([categoryId])
  let grew = true
  while (grew) {
    grew = false
    for (const row of MOCK_CATEGORIES) {
      if (row.parent !== null && ids.has(row.parent) && !ids.has(row.id)) {
        ids.add(row.id)
        grew = true
      }
    }
  }
  return ids
}

function publicOrder(order: StoredOrder): Order {
  const live = withLiveStatus(order)
  return {
    number: live.number,
    status: live.status,
    payment_status: live.payment_status,
    payment_method: live.payment_method,
    fulfillment: live.fulfillment,
    customer_name: live.customer_name,
    phone: live.phone,
    address: live.address,
    customer_note: live.customer_note,
    subtotal: live.subtotal,
    delivery_fee: live.delivery_fee,
    total: live.total,
    items: live.items,
    created_at: live.created_at,
    updated_at: live.updated_at,
  }
}

function validationError(fieldErrors: FieldErrors): ApiError {
  return new ApiError('validation', 400, { fieldErrors })
}

// --- The API ------------------------------------------------------------------------------

export function createMockApi(): Api {
  initFlags()
  const store = () =>
    mockStoreConfig({
      closed: hasFlag('closed') || Boolean(loadDb().staff?.paused),
      mbank: hasFlag('mbank'),
    })

  return {
    async getStore(signal) {
      await simulateNetwork(signal)
      return store()
    },

    async getCategories(signal) {
      await simulateNetwork(signal)
      const db = loadDb()
      const products = MOCK_PRODUCTS.filter((product) => effectiveProduct(product, db).is_active)
      return MOCK_CATEGORIES.map((row): Category => ({
        ...row,
        product_count: products.filter((product) => descendantIds(row.id).has(product.category))
          .length,
      }))
    },

    async getProducts(query: ProductQuery, signal) {
      await simulateNetwork(signal)
      if (consumeFlag('fail-products')) {
        throw new ApiError('server', 500, { message: 'Demo server error' })
      }
      const db = loadDb()
      // Products hidden in the staff panel are not on sale.
      let rows = MOCK_PRODUCTS.filter((product) => effectiveProduct(product, db).is_active).map(
        (product) => toProduct(product, db),
      )
      if (query.category) {
        const category = MOCK_CATEGORIES.find((row) => row.slug === query.category)
        const ids = category ? descendantIds(category.id) : new Set<number>()
        rows = rows.filter((product) => ids.has(product.category))
      }
      if (query.search) {
        const needle = query.search.toLocaleLowerCase('ru')
        rows = rows.filter((product) =>
          [product.name_ru, product.name_ky, product.sku].some((field) =>
            field.toLocaleLowerCase('ru').includes(needle),
          ),
        )
      }
      if (query.inStock) rows = rows.filter((product) => product.in_stock)
      if (query.ids) {
        const wanted = new Set(query.ids.slice(0, 100))
        rows = rows.filter((product) => wanted.has(product.id))
      }
      rows.sort(
        (a, b) =>
          Number(b.in_stock) - Number(a.in_stock) || a.name_ru.localeCompare(b.name_ru, 'ru'),
      )
      const pageSize = Math.min(Math.max(query.pageSize ?? (hasFlag('paged') ? 4 : 48), 1), 100)
      const page = Math.max(query.page ?? 1, 1)
      const start = (page - 1) * pageSize
      if (start > 0 && start >= rows.length) {
        throw new ApiError('not_found', 404, { detail: 'Неправильная страница' })
      }
      const result: Page<Product> = {
        count: rows.length,
        next: start + pageSize < rows.length ? `/api/products/?page=${page + 1}` : null,
        previous: page > 1 ? `/api/products/?page=${page - 1}` : null,
        results: rows.slice(start, start + pageSize),
      }
      return result
    },

    async createOrder(input: OrderCreateInput) {
      await simulateNetwork()
      if (consumeFlag('throttle')) {
        throw new ApiError('throttled', 429, {
          detail: 'Запрос был проигнорирован. Ожидается доступность через 60 секунд.',
        })
      }
      const db = loadDb()
      const replay = db.orders.find((order) => order.idempotency_key === input.idempotency_key)
      if (input.idempotency_key && replay) return { order: publicWithToken(replay), created: false }

      const config = store()
      const errors: FieldErrors = {}
      const name = input.customer_name.trim()
      if (!name) errors.customer_name = ['Это поле не может быть пустым.']
      else if (name.length > 160) errors.customer_name = ['Не больше 160 символов.']
      const phone = normalizeKgPhone(input.phone)
      if (!phone) errors.phone = ['Введите номер в формате +996 XXX XXX XXX.']
      if (input.fulfillment === 'delivery' && !input.address.trim()) {
        errors.address = ['Укажите адрес доставки.']
      }
      const fulfillmentOn =
        input.fulfillment === 'delivery'
          ? config.fulfillment.delivery_enabled
          : config.fulfillment.pickup_enabled
      if (!fulfillmentOn) errors.fulfillment = ['Этот способ получения сейчас недоступен.']
      if (input.payment_method === 'mbank_transfer' && !config.payment.mbank.configured) {
        errors.payment_method = ['Оплата переводом MBANK пока недоступна.']
      }
      if (!config.is_accepting_orders) {
        errors.non_field_errors = ['Магазин сейчас не принимает заказы.']
      }

      const itemErrors: string[] = []
      const ids = input.items.map((item) => item.product_id)
      if (input.items.length === 0) itemErrors.push('Добавьте хотя бы один товар.')
      if (input.items.length > 50) itemErrors.push('Не больше 50 позиций в заказе.')
      if (new Set(ids).size !== ids.length) itemErrors.push('Каждый товар можно указать один раз.')
      let subtotal = 0
      const lines: Order['items'] = []
      for (const item of input.items) {
        const base = MOCK_PRODUCTS.find((row) => row.id === item.product_id)
        const product = base ? effectiveProduct(base, db) : undefined
        if (!product || !product.is_active) {
          itemErrors.push(`Товар #${item.product_id} больше не продаётся.`)
          continue
        }
        const stock = db.stock[product.id] ?? 0
        if (item.quantity < 1 || item.quantity > 100) {
          itemErrors.push(`«${product.name_ru}»: количество должно быть от 1 до 100.`)
        } else if (stock < item.quantity) {
          itemErrors.push(`Недостаточно товара «${product.name_ru}»: доступно ${stock} шт.`)
        }
        const lineTotal = minorOf(product.price) * item.quantity
        subtotal += lineTotal
        lines.push({
          product_id: product.id,
          product_name: product.name_ru,
          sku: product.sku,
          unit: product.unit,
          quantity: item.quantity,
          unit_price: product.price,
          line_total: money(lineTotal),
        })
      }
      if (itemErrors.length > 0) errors.items = itemErrors

      const minimum = minorOf(config.fulfillment.min_order_total)
      if (itemErrors.length === 0 && subtotal < minimum) {
        errors.non_field_errors = [
          ...(errors.non_field_errors ?? []),
          `Минимальная сумма заказа — ${money(minimum)} сом.`,
        ]
      }
      if (Object.keys(errors).length > 0) throw validationError(errors)

      const free = config.fulfillment.free_delivery_from
      const fee =
        input.fulfillment === 'pickup' || (free !== null && subtotal >= minorOf(free))
          ? 0
          : minorOf(config.fulfillment.delivery_fee)
      const now = new Date().toISOString()
      db.seq += 1
      const order: StoredOrder = {
        number: `AT-${String(db.seq).padStart(6, '0')}`,
        token: randomToken(),
        idempotency_key: input.idempotency_key,
        status: 'new',
        payment_status: 'unpaid',
        payment_method: input.payment_method,
        fulfillment: input.fulfillment,
        customer_name: name,
        phone: phone ?? '',
        address: input.fulfillment === 'delivery' ? input.address.trim() : '',
        customer_note: input.customer_note.trim(),
        subtotal: money(subtotal),
        delivery_fee: money(fee),
        total: money(subtotal + fee),
        items: lines,
        created_at: now,
        updated_at: now,
        payment_reference: '',
        reported_at: null,
        // With the staff panel in use, staff move the order along, not a timer.
        staff_managed: Boolean(db.staff),
        staff_note: '',
        events: [{ at: now, kind: 'created', from: null, to: 'new', actor: null, message: '' }],
      }
      for (const item of input.items) {
        db.stock[item.product_id] = (db.stock[item.product_id] ?? 0) - item.quantity
      }
      db.orders.push(order)
      saveDb(db)
      return { order: publicWithToken(order), created: true }
    },

    async getOrder(token, signal) {
      await simulateNetwork(signal)
      const order = loadDb().orders.find((row) => row.token === token)
      if (!order) throw new ApiError('not_found', 404, { detail: 'Заказ не найден.' })
      return publicOrder(order)
    },

    async reportPayment(token, reference) {
      await simulateNetwork()
      const db = loadDb()
      const stored = db.orders.find((row) => row.token === token)
      if (!stored) throw new ApiError('not_found', 404, { detail: 'Заказ не найден.' })
      const live = withLiveStatus(stored)
      if (reference.length > 120) {
        throw validationError({ reference: ['Не больше 120 символов.'] })
      }
      if (
        live.payment_method !== 'mbank_transfer' ||
        !['unpaid', 'rejected'].includes(live.payment_status) ||
        live.status === 'cancelled' ||
        live.status === 'completed'
      ) {
        throw validationError({ non_field_errors: ['Сейчас нельзя сообщить об оплате.'] })
      }
      const now = new Date().toISOString()
      stored.events = [
        ...(stored.events ?? []),
        {
          at: now,
          kind: 'payment_reported',
          from: live.payment_status,
          to: 'pending',
          actor: null,
          message: reference.trim(),
        },
      ]
      stored.payment_status = 'pending'
      stored.payment_reference = reference.trim()
      stored.reported_at = now
      stored.updated_at = now
      saveDb(db)
      return publicOrder(stored)
    },
  }
}

function publicWithToken(order: StoredOrder): Order & { token: string } {
  return { ...publicOrder(order), token: order.token }
}
