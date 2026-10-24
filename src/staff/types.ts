// Types that mirror the staff API in STAFF_CONTRACT.md (/api/staff/). Money is a decimal
// string such as "85.00"; times are ISO 8601 with an offset.

import type {
  Badge,
  Fulfillment,
  Money,
  OrderItem,
  OrderStatus,
  Page,
  PaymentMethod,
  PaymentStatus,
} from '../api/types'

export type {
  Badge,
  Fulfillment,
  Money,
  OrderItem,
  OrderStatus,
  Page,
  PaymentMethod,
  PaymentStatus,
}

export const PERMISSIONS = [
  'view_orders',
  'change_orders',
  'view_products',
  'change_products',
  'pause_orders',
] as const
export type Permission = (typeof PERMISSIONS)[number]
export type Permissions = Record<Permission, boolean>

export interface StaffUser {
  username: string
  display_name: string
  is_superuser: boolean
  permissions: Permissions
}

/** GET /session/, POST /login/ and POST /logout/ all answer with this shape. */
export type SessionResponse =
  | { authenticated: false; csrf_token: string }
  | { authenticated: true; csrf_token: string; user: StaffUser; backoffice_url?: string }

/** The session as the app uses it; the CSRF token stays inside the API client. */
export type StaffSession =
  { authenticated: false } | { authenticated: true; user: StaffUser; backofficeUrl: string | null }

export interface OrdersSummary {
  new: number
  confirmed: number
  preparing: number
  ready: number
  out_for_delivery: number
  active: number
  payment_pending: number
}

/** `status` filter of GET /orders/: a status value, "active" (default) or "all". */
export type OrderStatusFilter = OrderStatus | 'active' | 'all'

export interface OrderListQuery {
  status: OrderStatusFilter
  paymentStatus?: PaymentStatus | null
  q?: string
  page?: number
}

export interface StaffOrderRow {
  number: string
  status: OrderStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod
  fulfillment: Fulfillment
  customer_name: string
  phone: string
  total: Money
  items_count: number
  created_at: string
  updated_at: string
}

export type OrderEventKind =
  'created' | 'status' | 'payment' | 'payment_reported' | 'stock_restored' | 'edited' | 'migrated'

export interface OrderEvent {
  at: string
  kind: OrderEventKind
  from: string | null
  to: string | null
  actor: string | null
  message: string
}

export interface StaffOrderDetail extends StaffOrderRow {
  address: string
  customer_note: string
  staff_note: string
  payment_reference: string
  subtotal: Money
  delivery_fee: Money
  items: OrderItem[]
  events: OrderEvent[]
  allowed_status_transitions: OrderStatus[]
  allowed_payment_transitions: PaymentStatus[]
  can_cancel: boolean
  tracking_path: string
}

export interface OrderPatch {
  customer_name?: string
  phone?: string
  address?: string
  staff_note?: string
}

export type StockFilter = 'all' | 'low' | 'out'
/** `active` filter of GET /products/: "" for all, "1" active only, "0" hidden only. */
export type ActiveFilter = '' | '1' | '0'

export interface ProductListQuery {
  q?: string
  category?: string
  stock?: StockFilter
  active?: ActiveFilter
  page?: number
}

export interface StaffProduct {
  id: number
  sku: string
  name_ru: string
  name_ky: string
  category_slug: string
  category_name: string
  price: Money
  unit: string
  stock_quantity: number
  is_active: boolean
  badge: Badge | null
  updated_at: string
}

export interface ProductPage extends Page<StaffProduct> {
  low_stock_threshold: number
}

export interface ProductPatch {
  price?: string
  stock_quantity?: number
  is_active?: boolean
  badge?: Badge | null
}

export interface StaffStoreSettings {
  is_accepting_orders: boolean
  accepts_orders_now: boolean
  delivery_enabled: boolean
  pickup_enabled: boolean
  delivery_fee: Money
  free_delivery_from: Money | null
  min_order_total: Money
}
