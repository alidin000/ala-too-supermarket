/**
 * An in-browser fake of the staff API (STAFF_CONTRACT.md), used when VITE_USE_MOCK=1. It
 * answers `fetch` calls with real Response objects, so the production client runs as is:
 * CSRF token checks and rotation, 401/403/429, DRF-style 400s.
 *
 * Demo logins (shown on the login page in demo mode):
 *   demo / demo       staff with every permission
 *   viewer / viewer   can view orders and products, cannot change anything
 *   owner / owner     superuser, sees "Расширенные настройки"
 * Five wrong passwords for one username lock it for 15 minutes (429 with retry_after).
 *
 * The "server session" lives in memory only: reloading the page logs out, like a server
 * restart. Orders, stock and product edits live in the storefront demo database
 * (src/api/mock/shared.ts), so both demos see the same shop. New orders arrive by themselves
 * about every 45 seconds while the panel is open.
 */
import { MOCK_CATEGORIES, MOCK_PRODUCTS, mockStoreConfig } from '../../api/mock/data'
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
} from '../../api/mock/shared'
import type { MockDb, MockEvent, StoredOrder } from '../../api/mock/shared'
import { normalizeKgPhone } from '../../lib/phone'
import type {
  Fulfillment,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Permissions,
  StaffOrderDetail,
  StaffOrderRow,
  StaffProduct,
  StaffStoreSettings,
  StaffUser,
} from '../types'

// --- Users and the in-memory session ---------------------------------------------------------

interface MockUser extends StaffUser {
  password: string
}

const ALL: Permissions = {
  view_orders: true,
  change_orders: true,
  view_products: true,
  change_products: true,
  pause_orders: true,
}

const USERS: MockUser[] = [
  {
    username: 'demo',
    password: 'demo',
    display_name: 'Айгерим (демо)',
    is_superuser: false,
    permissions: ALL,
  },
  {
    username: 'viewer',
    password: 'viewer',
    display_name: 'Бакыт (просмотр)',
    is_superuser: false,
    permissions: {
      view_orders: true,
      change_orders: false,
      view_products: true,
      change_products: false,
      pause_orders: false,
    },
  },
  {
    username: 'owner',
    password: 'owner',
    display_name: 'Владелец (демо)',
    is_superuser: true,
    permissions: ALL,
  },
]

/** Shown on the login page in demo mode; it lives here so production builds never carry it. */
export const DEMO_LOGINS =
  'demo / demo — все права; viewer / viewer — только просмотр; owner / owner — владелец.'

const LOCK_WINDOW_MS = 15 * 60_000
const LOCK_AFTER_USER = 5
const LOCK_AFTER_CLIENT = 20
const SPAWN_EVERY_MS = 45_000
const ORDERS_PAGE = 25
const PRODUCTS_PAGE = 50
const LOW_STOCK = 5

const server = {
  csrf: randomToken(18),
  user: null as MockUser | null,
  failures: new Map<string, number[]>(),
  clientFailures: [] as number[],
  lockedUntil: new Map<string, number>(),
  clientLockedUntil: 0,
  flagsRead: false,
}

// --- HTTP plumbing ---------------------------------------------------------------------------

type Json = object
type Reply = [number, Json, Record<string, string>?]

const UNAUTHENTICATED: Reply = [401, { detail: 'Войдите в систему.' }]
const FORBIDDEN: Reply = [403, { detail: 'Недостаточно прав.' }]
const NOT_FOUND: Reply = [404, { detail: 'Не найдено.' }]

function respond([status, body, headers = {}]: Reply): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...headers,
    },
  })
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string' || !body) return {}
  try {
    const value = JSON.parse(body) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function sessionBody(): Json {
  const user = server.user
  if (!user) return { authenticated: false, csrf_token: server.csrf }
  const { password: _password, ...publicUser } = user
  void _password
  return {
    authenticated: true,
    csrf_token: server.csrf,
    user: publicUser,
    ...(user.is_superuser ? { backoffice_url: '/backoffice/' } : {}),
  }
}

const rotateCsrf = () => {
  server.csrf = randomToken(18)
}

// --- Demo orders ----------------------------------------------------------------------------

const NAMES = [
  'Айгерим',
  'Бакыт',
  'Нургуль',
  'Эрлан',
  'Жыпар',
  'Тимур',
  'Асель',
  'Мирлан',
  'Чолпон',
  'Данияр',
]
const ADDRESSES = [
  'ул. Киевская 10, кв. 5, ориентир — ЦУМ',
  'мкр. Джал 23, дом 4, кв. 18',
  'пр. Чуй 155, офис 3',
  'ул. Ахунбаева 98, кв. 41',
  'мкр. Асанбай 11, кв. 7, домофон 7К',
]

interface SeedOrder {
  minutesAgo: number
  status: OrderStatus
  payment: PaymentStatus
  method: PaymentMethod
  fulfillment: Fulfillment
  items: [number, number][]
  note?: string
  staffNote?: string
  reference?: string
  cancelReason?: string
}

const SEED: SeedOrder[] = [
  {
    minutesAgo: 2,
    status: 'new',
    payment: 'unpaid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [
      [1, 2],
      [2, 1],
      [9, 1],
    ],
    note: 'Позвоните за 10 минут до приезда.',
  },
  {
    minutesAgo: 9,
    status: 'new',
    payment: 'pending',
    method: 'mbank_transfer',
    fulfillment: 'pickup',
    items: [[8, 1]],
    reference: 'Перевод с карты *4417',
  },
  {
    minutesAgo: 17,
    status: 'new',
    payment: 'unpaid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [
      [10, 2],
      [3, 1],
      [11, 2],
    ],
  },
  {
    minutesAgo: 34,
    status: 'confirmed',
    payment: 'unpaid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [
      [5, 1],
      [12, 1],
      [7, 2],
    ],
    staffNote: 'Клиент просил без пакета.',
  },
  {
    minutesAgo: 48,
    status: 'preparing',
    payment: 'unpaid',
    method: 'cash',
    fulfillment: 'pickup',
    items: [
      [4, 2],
      [9, 2],
    ],
  },
  {
    minutesAgo: 66,
    status: 'out_for_delivery',
    payment: 'unpaid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [
      [1, 4],
      [2, 2],
    ],
  },
  {
    minutesAgo: 81,
    status: 'ready',
    payment: 'paid',
    method: 'mbank_transfer',
    fulfillment: 'pickup',
    items: [
      [6, 1],
      [11, 1],
    ],
    reference: 'AT оплата',
  },
  {
    minutesAgo: 140,
    status: 'completed',
    payment: 'paid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [
      [3, 2],
      [10, 1],
    ],
  },
  {
    minutesAgo: 205,
    status: 'cancelled',
    payment: 'unpaid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [[12, 1]],
    cancelReason: 'Клиент не отвечает на звонки.',
  },
  {
    minutesAgo: 60 * 22,
    status: 'completed',
    payment: 'paid',
    method: 'cash',
    fulfillment: 'pickup',
    items: [[2, 3]],
  },
  {
    minutesAgo: 60 * 26,
    status: 'completed',
    payment: 'paid',
    method: 'cash',
    fulfillment: 'delivery',
    items: [
      [1, 1],
      [4, 1],
      [7, 1],
    ],
  },
  {
    minutesAgo: 60 * 30,
    status: 'cancelled',
    payment: 'refunded',
    method: 'mbank_transfer',
    fulfillment: 'delivery',
    items: [[8, 2]],
    cancelReason: 'Нет нужного размера.',
  },
]

const FLOW: Record<Fulfillment, OrderStatus[]> = {
  delivery: ['new', 'confirmed', 'preparing', 'out_for_delivery', 'completed'],
  pickup: ['new', 'confirmed', 'preparing', 'ready', 'completed'],
}

function event(
  at: string,
  kind: MockEvent['kind'],
  from: string | null,
  to: string | null,
  actor: string | null,
  message = '',
): MockEvent {
  return { at, kind, from, to, actor, message }
}

function buildOrder(db: MockDb, createdAt: number, seed: SeedOrder, index: number): StoredOrder {
  db.seq += 1
  let subtotal = 0
  const items = seed.items.map(([id, quantity]) => {
    const base = MOCK_PRODUCTS.find((product) => product.id === id) ?? MOCK_PRODUCTS[0]!
    const product = effectiveProduct(base, db)
    const line = minorOf(product.price) * quantity
    subtotal += line
    return {
      product_id: product.id,
      product_name: product.name_ru,
      sku: product.sku,
      unit: product.unit,
      quantity,
      unit_price: product.price,
      line_total: money(line),
    }
  })
  const fee = seed.fulfillment === 'pickup' || subtotal >= 200_000 ? 0 : 15_000
  const created = new Date(createdAt).toISOString()
  const actor = USERS[0]!.display_name
  const events: MockEvent[] = [event(created, 'created', null, 'new', null)]
  if (seed.reference) {
    events.push(
      event(
        new Date(createdAt + 60_000).toISOString(),
        'payment_reported',
        'unpaid',
        'pending',
        null,
        seed.reference,
      ),
    )
  }
  // Walk the status flow up to the seed's status, a few minutes apart.
  const flow = FLOW[seed.fulfillment]
  const target = seed.status === 'cancelled' ? 1 : flow.indexOf(seed.status)
  for (let step = 1; step <= target; step += 1) {
    const at = new Date(createdAt + step * 4 * 60_000).toISOString()
    events.push(event(at, 'status', flow[step - 1]!, flow[step]!, actor))
  }
  if (seed.payment === 'paid' || seed.payment === 'refunded') {
    const at = new Date(createdAt + 5 * 60_000).toISOString()
    events.push(event(at, 'payment', seed.reference ? 'pending' : 'unpaid', 'paid', actor))
  }
  if (seed.status === 'cancelled') {
    const at = new Date(createdAt + 10 * 60_000).toISOString()
    events.push(event(at, 'status', flow[target]!, 'cancelled', actor, seed.cancelReason ?? ''))
    events.push(event(at, 'stock_restored', null, null, null))
    if (seed.payment === 'refunded') {
      events.push(
        event(
          new Date(createdAt + 15 * 60_000).toISOString(),
          'payment',
          'paid',
          'refunded',
          actor,
        ),
      )
    }
  }
  const name = NAMES[index % NAMES.length]!
  return {
    number: `AT-${String(db.seq).padStart(6, '0')}`,
    token: randomToken(),
    idempotency_key: '',
    status: seed.status,
    payment_status: seed.payment,
    payment_method: seed.method,
    fulfillment: seed.fulfillment,
    customer_name: name,
    // Obviously fake demo numbers: +996 700 000 1xx.
    phone: `+996700000${String(100 + (index % 900)).padStart(3, '0')}`,
    address: seed.fulfillment === 'delivery' ? ADDRESSES[index % ADDRESSES.length]! : '',
    customer_note: seed.note ?? '',
    subtotal: money(subtotal),
    delivery_fee: money(fee),
    total: money(subtotal + fee),
    items,
    created_at: created,
    updated_at: events[events.length - 1]!.at,
    payment_reference: seed.reference ?? '',
    reported_at: seed.reference ? created : null,
    staff_managed: true,
    staff_note: seed.staffNote ?? '',
    events,
    stock_restored: seed.status === 'cancelled',
  }
}

/** Seeds demo orders once, freezes storefront orders, and lets new orders trickle in. */
function prepare(db: MockDb, now: number): void {
  if (!db.staff) {
    db.staff = { seeded: false, paused: hasFlag('closed'), lastSpawnAt: now }
    // From now on staff move orders along. Keep what customers already see.
    for (const order of db.orders) {
      if (order.staff_managed) continue
      const live = withLiveStatus(order)
      order.status = live.status
      order.payment_status = live.payment_status
      order.staff_managed = true
      order.events ??= [event(order.created_at, 'created', null, 'new', null)]
      order.staff_note ??= ''
    }
  }
  if (!db.staff.seeded) {
    SEED.forEach((seed, index) => {
      db.orders.push(buildOrder(db, now - seed.minutesAgo * 60_000, seed, index))
    })
    db.staff.seeded = true
    db.staff.lastSpawnAt = now
  }
  if (now - db.staff.lastSpawnAt >= SPAWN_EVERY_MS && db.orders.length < 80) {
    const index = db.seq
    const first = (index % MOCK_PRODUCTS.length) + 1
    const second = ((index + 4) % MOCK_PRODUCTS.length) + 1
    const seed: SeedOrder = {
      minutesAgo: 0,
      status: 'new',
      payment: 'unpaid',
      method: 'cash',
      fulfillment: index % 3 === 0 ? 'pickup' : 'delivery',
      items:
        first === second
          ? [[first, 2]]
          : [
              [first, 1],
              [second, 2],
            ],
    }
    const order = buildOrder(db, now, seed, index)
    for (const item of order.items) {
      if (item.product_id !== null) {
        db.stock[item.product_id] = Math.max(0, (db.stock[item.product_id] ?? 0) - item.quantity)
      }
    }
    db.orders.push(order)
    db.staff.lastSpawnAt = now
  }
}

// --- Shapes ------------------------------------------------------------------------------------

function allowedStatus(order: StoredOrder): OrderStatus[] {
  switch (order.status) {
    case 'new':
      return ['confirmed']
    case 'confirmed':
      return ['preparing']
    case 'preparing':
      return [order.fulfillment === 'pickup' ? 'ready' : 'out_for_delivery']
    case 'ready':
    case 'out_for_delivery':
      return ['completed']
    default:
      return []
  }
}

function allowedPayment(order: StoredOrder): PaymentStatus[] {
  if (order.status === 'cancelled') return order.payment_status === 'paid' ? ['refunded'] : []
  switch (order.payment_status) {
    case 'unpaid':
    case 'rejected':
      return ['paid']
    case 'pending':
      return ['paid', 'rejected']
    case 'paid':
      return ['refunded']
    case 'refunded':
      return []
  }
}

const canCancel = (order: StoredOrder) =>
  order.status !== 'completed' && order.status !== 'cancelled'

function toRow(order: StoredOrder): StaffOrderRow {
  return {
    number: order.number,
    status: order.status,
    payment_status: order.payment_status,
    payment_method: order.payment_method,
    fulfillment: order.fulfillment,
    customer_name: order.customer_name,
    phone: order.phone,
    total: order.total,
    items_count: order.items.length,
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

function toDetail(order: StoredOrder): StaffOrderDetail {
  return {
    ...toRow(order),
    address: order.address,
    customer_note: order.customer_note,
    staff_note: order.staff_note ?? '',
    payment_reference: order.payment_reference,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    items: order.items,
    events: order.events ?? [],
    allowed_status_transitions: allowedStatus(order),
    allowed_payment_transitions: allowedPayment(order),
    can_cancel: canCancel(order),
    tracking_path: `/?order=${encodeURIComponent(order.token)}`,
  }
}

function toStaffProduct(id: number, db: MockDb): StaffProduct | null {
  const base = MOCK_PRODUCTS.find((product) => product.id === id)
  if (!base) return null
  const product = effectiveProduct(base, db)
  const category = MOCK_CATEGORIES.find((row) => row.id === product.category)
  return {
    id: product.id,
    sku: product.sku,
    name_ru: product.name_ru,
    name_ky: product.name_ky,
    category_slug: category?.slug ?? '',
    category_name: category?.name_ru ?? '',
    price: product.price,
    unit: product.unit,
    stock_quantity: db.stock[product.id] ?? 0,
    is_active: product.is_active,
    badge: product.badge,
    updated_at: db.products?.[product.id]?.updated_at ?? '2026-10-01T09:00:00+06:00',
  }
}

function page<T>(rows: T[], pageNumber: number, size: number, path: string) {
  const start = (pageNumber - 1) * size
  if (start > 0 && start >= rows.length) return null
  return {
    count: rows.length,
    next: start + size < rows.length ? `${path}?page=${pageNumber + 1}` : null,
    previous: pageNumber > 1 ? `${path}?page=${pageNumber - 1}` : null,
    results: rows.slice(start, start + size),
  }
}

const STATUS_RU: Record<OrderStatus, string> = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  preparing: 'Собираем',
  ready: 'Готов к выдаче',
  out_for_delivery: 'Курьер в пути',
  completed: 'Выполнен',
  cancelled: 'Отменён',
}

// --- Handlers ----------------------------------------------------------------------------------

function login(body: Record<string, unknown>, now: number): Reply {
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const key = username.toLowerCase()
  const lockedUntil = Math.max(server.lockedUntil.get(key) ?? 0, server.clientLockedUntil)
  if (lockedUntil > now) {
    const retryAfter = Math.ceil((lockedUntil - now) / 1000)
    return [
      429,
      {
        detail: `Слишком много попыток входа. Попробуйте через ${Math.ceil(retryAfter / 60)} минут.`,
        retry_after: retryAfter,
      },
      { 'Retry-After': String(retryAfter) },
    ]
  }
  const user = USERS.find((row) => row.username === key && row.password === password)
  if (!user) {
    const recent = (server.failures.get(key) ?? []).filter((at) => now - at < LOCK_WINDOW_MS)
    recent.push(now)
    server.failures.set(key, recent)
    server.clientFailures = server.clientFailures.filter((at) => now - at < LOCK_WINDOW_MS)
    server.clientFailures.push(now)
    if (recent.length >= LOCK_AFTER_USER) server.lockedUntil.set(key, now + LOCK_WINDOW_MS)
    if (server.clientFailures.length >= LOCK_AFTER_CLIENT) {
      server.clientLockedUntil = now + LOCK_WINDOW_MS
    }
    console.warn(`[demo] failed staff login for "${username}"`)
    return [400, { non_field_errors: ['Неверный логин или пароль.'] }]
  }
  server.failures.delete(key)
  server.user = user
  rotateCsrf() // Django rotates the token on login.
  return [200, sessionBody()]
}

function has(permission: keyof Permissions): boolean {
  return Boolean(server.user?.permissions[permission])
}

function listOrders(db: MockDb, params: URLSearchParams): Reply {
  const status = params.get('status') || 'active'
  const payment = params.get('payment_status')
  const q = (params.get('q') ?? '').trim().toLocaleLowerCase('ru')
  const digits = q.replace(/\D/g, '').replace(/^(996|0)/, '')
  let rows = db.orders.slice()
  if (status === 'active') {
    rows = rows.filter((order) => order.status !== 'completed' && order.status !== 'cancelled')
  } else if (status !== 'all') {
    rows = rows.filter((order) => order.status === status)
  }
  if (payment) rows = rows.filter((order) => order.payment_status === payment)
  if (q) {
    rows = rows.filter(
      (order) =>
        order.number.toLocaleLowerCase('ru').includes(q) ||
        order.customer_name.toLocaleLowerCase('ru').includes(q) ||
        (digits.length >= 3 && order.phone.replace(/\D/g, '').includes(digits)),
    )
  }
  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const result = page(
    rows.map(toRow),
    Number(params.get('page') || 1),
    ORDERS_PAGE,
    '/api/staff/orders/',
  )
  return result ? [200, result] : [404, { detail: 'Неправильная страница' }]
}

function summary(db: MockDb): Reply {
  const count = (status: OrderStatus) => db.orders.filter((order) => order.status === status).length
  return [
    200,
    {
      new: count('new'),
      confirmed: count('confirmed'),
      preparing: count('preparing'),
      ready: count('ready'),
      out_for_delivery: count('out_for_delivery'),
      active: db.orders.filter((order) => canCancel(order)).length,
      payment_pending: db.orders.filter((order) => order.payment_status === 'pending').length,
    },
  ]
}

function orderAction(
  db: MockDb,
  order: StoredOrder,
  action: string,
  body: Record<string, unknown>,
  now: string,
): Reply {
  const actor = server.user?.display_name ?? null
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (action === 'status') {
    const to = body.status
    if (to === 'cancelled') {
      return [400, { status: ['Для отмены заказа используйте отдельное действие.'] }]
    }
    if (typeof to !== 'string' || !allowedStatus(order).includes(to as OrderStatus)) {
      const label = STATUS_RU[to as OrderStatus] ?? String(to)
      return [
        400,
        { status: [`Нельзя перевести заказ из «${STATUS_RU[order.status]}» в «${label}».`] },
      ]
    }
    order.events = [...(order.events ?? []), event(now, 'status', order.status, to, actor, note)]
    order.status = to as OrderStatus
  } else if (action === 'payment') {
    const to = body.payment_status
    if (typeof to !== 'string' || !allowedPayment(order).includes(to as PaymentStatus)) {
      return [400, { payment_status: ['Такое изменение оплаты для этого заказа недоступно.'] }]
    }
    order.events = [
      ...(order.events ?? []),
      event(now, 'payment', order.payment_status, to, actor, note),
    ]
    order.payment_status = to as PaymentStatus
  } else if (action === 'cancel') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 3) return [400, { reason: ['Укажите причину отмены: от 3 символов.'] }]
    if (reason.length > 500) return [400, { reason: ['Не больше 500 символов.'] }]
    if (!canCancel(order)) return [400, { non_field_errors: ['Этот заказ уже нельзя отменить.'] }]
    order.events = [
      ...(order.events ?? []),
      event(now, 'status', order.status, 'cancelled', actor, reason),
    ]
    order.status = 'cancelled'
    if (!order.stock_restored) {
      for (const item of order.items) {
        if (item.product_id !== null) {
          db.stock[item.product_id] = (db.stock[item.product_id] ?? 0) + item.quantity
        }
      }
      order.stock_restored = true
      order.events.push(event(now, 'stock_restored', null, null, null))
    }
  } else {
    return NOT_FOUND
  }
  order.updated_at = now
  saveDb(db)
  return [200, toDetail(order)]
}

function editOrder(
  db: MockDb,
  order: StoredOrder,
  body: Record<string, unknown>,
  now: string,
): Reply {
  const errors: Record<string, string[]> = {}
  const changes: string[] = []
  if ('customer_name' in body) {
    const name = String(body.customer_name ?? '').trim()
    if (!name) errors.customer_name = ['Это поле не может быть пустым.']
    else if (name.length > 160) errors.customer_name = ['Не больше 160 символов.']
    else if (name !== order.customer_name) changes.push('имя')
  }
  let phone: string | null = order.phone
  if ('phone' in body) {
    phone = normalizeKgPhone(String(body.phone ?? ''))
    if (!phone) errors.phone = ['Введите номер в формате +996 XXX XXX XXX.']
    else if (phone !== order.phone) changes.push('телефон')
  }
  if ('address' in body) {
    const address = String(body.address ?? '').trim()
    if (order.fulfillment === 'delivery' && !address) errors.address = ['Укажите адрес доставки.']
    else if (address !== order.address) changes.push('адрес')
  }
  if ('staff_note' in body) {
    const staffNote = String(body.staff_note ?? '')
    if (staffNote.length > 2000) errors.staff_note = ['Не больше 2000 символов.']
    else if (staffNote !== (order.staff_note ?? '')) changes.push('заметка')
  }
  if (Object.keys(errors).length > 0) return [400, errors]
  if ('customer_name' in body) order.customer_name = String(body.customer_name).trim()
  if ('phone' in body && phone) order.phone = phone
  if ('address' in body && order.fulfillment === 'delivery')
    order.address = String(body.address).trim()
  if ('staff_note' in body) order.staff_note = String(body.staff_note ?? '')
  if (changes.length > 0) {
    const actor = server.user?.display_name ?? null
    order.events = [
      ...(order.events ?? []),
      event(now, 'edited', null, null, actor, `Изменено: ${changes.join(', ')}`),
    ]
    order.updated_at = now
  }
  saveDb(db)
  return [200, toDetail(order)]
}

function listProducts(db: MockDb, params: URLSearchParams): Reply {
  const q = (params.get('q') ?? '').trim().toLocaleLowerCase('ru')
  const category = params.get('category') ?? ''
  const stock = params.get('stock') ?? 'all'
  const active = params.get('active')
  let rows = MOCK_PRODUCTS.map((product) => toStaffProduct(product.id, db)).filter(
    (row): row is StaffProduct => row !== null,
  )
  if (q) {
    rows = rows.filter((row) =>
      [row.name_ru, row.name_ky, row.sku].some((field) =>
        field.toLocaleLowerCase('ru').includes(q),
      ),
    )
  }
  if (category) rows = rows.filter((row) => row.category_slug === category)
  if (stock === 'low')
    rows = rows.filter((row) => row.stock_quantity > 0 && row.stock_quantity <= LOW_STOCK)
  if (stock === 'out') rows = rows.filter((row) => row.stock_quantity === 0)
  if (active === '1' || active === '0')
    rows = rows.filter((row) => row.is_active === (active === '1'))
  rows.sort((a, b) => a.name_ru.localeCompare(b.name_ru, 'ru'))
  const result = page(rows, Number(params.get('page') || 1), PRODUCTS_PAGE, '/api/staff/products/')
  return result
    ? [200, { ...result, low_stock_threshold: LOW_STOCK }]
    : [404, { detail: 'Неправильная страница' }]
}

function editProduct(db: MockDb, id: number, body: Record<string, unknown>, now: string): Reply {
  const product = toStaffProduct(id, db)
  if (!product) return [404, { detail: 'Товар не найден.' }]
  const errors: Record<string, string[]> = {}
  const override = { ...(db.products?.[id] ?? {}) }
  let stock: number | null = null
  if ('price' in body) {
    const text = String(body.price ?? '').trim()
    if (!/^\d+(\.\d+)?$/.test(text)) errors.price = ['Введите правильное число.']
    else if (/\.\d{3,}$/.test(text))
      errors.price = ['Убедитесь, что не более 2 знаков после запятой.']
    else if (minorOf(text) <= 0) errors.price = ['Убедитесь, что это значение больше 0.']
    else override.price = money(minorOf(text))
  }
  if ('stock_quantity' in body) {
    const value = body.stock_quantity
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      errors.stock_quantity = ['Введите правильное целое число.']
    } else if (value < 0) {
      errors.stock_quantity = ['Убедитесь, что это значение больше либо равно 0.']
    } else if (value > 100_000) {
      errors.stock_quantity = ['Убедитесь, что это значение меньше либо равно 100000.']
    } else {
      stock = value
    }
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') errors.is_active = ['Требуется булево значение.']
    else override.is_active = body.is_active
  }
  if ('badge' in body) {
    const badge = body.badge
    if (badge === null || badge === 'popular' || badge === 'deal' || badge === 'new') {
      override.badge = badge
    } else {
      errors.badge = [`Значения «${String(badge)}» нет среди допустимых вариантов.`]
    }
  }
  if (Object.keys(errors).length > 0) return [400, errors]
  override.updated_at = now
  db.products = { ...(db.products ?? {}), [id]: override }
  if (stock !== null) db.stock[id] = stock
  saveDb(db)
  return [200, toStaffProduct(id, db) as StaffProduct]
}

function storeSettings(db: MockDb): StaffStoreSettings {
  const config = mockStoreConfig({ closed: false, mbank: false })
  const open = !db.staff?.paused && !hasFlag('closed')
  return {
    is_accepting_orders: open,
    accepts_orders_now: open,
    delivery_enabled: config.fulfillment.delivery_enabled,
    pickup_enabled: config.fulfillment.pickup_enabled,
    delivery_fee: config.fulfillment.delivery_fee,
    free_delivery_from: config.fulfillment.free_delivery_from,
    min_order_total: config.fulfillment.min_order_total,
  }
}

function route(
  method: string,
  path: string,
  params: URLSearchParams,
  body: Record<string, unknown>,
): Reply {
  const now = Date.now()
  if (path === '/session/' && method === 'GET') return [200, sessionBody()]
  if (path === '/login/' && method === 'POST') return login(body, now)
  if (path === '/logout/' && method === 'POST') {
    server.user = null
    rotateCsrf()
    return [200, sessionBody()]
  }
  if (!server.user) return UNAUTHENTICATED

  const db = loadDb()
  prepare(db, now)
  saveDb(db)
  const iso = new Date(now).toISOString()

  if (path === '/orders/summary/' && method === 'GET')
    return has('view_orders') ? summary(db) : FORBIDDEN
  if (path === '/orders/' && method === 'GET')
    return has('view_orders') ? listOrders(db, params) : FORBIDDEN

  const orderMatch = /^\/orders\/([^/]+)\/(?:(status|payment|cancel)\/)?$/.exec(path)
  if (orderMatch) {
    const number = decodeURIComponent(orderMatch[1] ?? '')
    const action = orderMatch[2]
    const order = db.orders.find((row) => row.number === number)
    if (!has('view_orders')) return FORBIDDEN
    if (!order) return [404, { detail: 'Заказ не найден.' }]
    if (!action && method === 'GET') return [200, toDetail(order)]
    if (!has('change_orders')) return FORBIDDEN
    if (!action && method === 'PATCH') return editOrder(db, order, body, iso)
    if (action && method === 'POST') return orderAction(db, order, action, body, iso)
    return [405, { detail: 'Метод не разрешён.' }]
  }

  if (path === '/products/' && method === 'GET')
    return has('view_products') ? listProducts(db, params) : FORBIDDEN
  const productMatch = /^\/products\/(\d+)\/$/.exec(path)
  if (productMatch && method === 'PATCH') {
    if (!has('change_products')) return FORBIDDEN
    return editProduct(db, Number(productMatch[1]), body, iso)
  }

  if (path === '/store/') {
    if (method === 'GET') return has('view_orders') ? [200, storeSettings(db)] : FORBIDDEN
    if (method === 'PATCH') {
      if (!has('pause_orders')) return FORBIDDEN
      if (typeof body.is_accepting_orders !== 'boolean') {
        return [400, { is_accepting_orders: ['Требуется булево значение.'] }]
      }
      db.staff = { ...db.staff!, paused: !body.is_accepting_orders }
      saveDb(db)
      return [200, storeSettings(db)]
    }
  }
  return NOT_FOUND
}

// --- fetch ---------------------------------------------------------------------------------------

/** A drop-in `fetch` for the staff API in demo mode. */
export async function mockStaffFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!server.flagsRead) {
    initFlags()
    server.flagsRead = true
  }
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(href, window.location.origin)
  const method = (init.method ?? 'GET').toUpperCase()
  const path = url.pathname.replace(/^.*?\/staff(?=\/)/, '')

  if (!hasFlag('fast')) await sleep(150 + Math.random() * 250, init.signal)
  if (consumeFlag('offline')) throw new TypeError('Failed to fetch')

  if (method !== 'GET') {
    // ?mock=csrf: the token the page holds goes stale, as after a login in another tab.
    if (consumeFlag('csrf')) rotateCsrf()
    const token = new Headers(init.headers).get('X-CSRFToken')
    if (token !== server.csrf) {
      return respond([
        403,
        { detail: "CSRF Failed: CSRF token from the 'X-Csrftoken' HTTP header incorrect." },
      ])
    }
  }
  return respond(route(method, path, url.searchParams, parseBody(init.body)))
}
