// Types that mirror API contract v1 (CONTRACT.md). Money is always a decimal string such
// as "85.00"; the server computes every price, fee and total.

export type Money = string

export type Fulfillment = 'delivery' | 'pickup'
export type PaymentMethod = 'cash' | 'mbank_transfer'
export type OrderStatus =
  'new' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled'
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'rejected' | 'refunded'
export type Badge = 'popular' | 'deal' | 'new'

export interface MbankConfig {
  configured: boolean
  recipient_name: string
  phone: string
  qr_image_url: string
}

export interface StoreConfig {
  name: string
  city: string
  phone: string
  pickup_address: string
  opening_hours: string
  is_accepting_orders: boolean
  currency: string
  fulfillment: {
    delivery_enabled: boolean
    pickup_enabled: boolean
    delivery_fee: Money
    free_delivery_from: Money | null
    min_order_total: Money
  }
  payment: {
    cash_enabled: boolean
    mbank: MbankConfig
  }
}

export interface Category {
  id: number
  slug: string
  name_ru: string
  name_ky: string
  parent: number | null
  sort_order: number
  product_count: number
}

export interface Product {
  id: number
  sku: string
  category: number
  category_slug: string
  name_ru: string
  name_ky: string
  description: string
  price: Money
  unit: string
  image_url: string
  in_stock: boolean
  max_quantity: number
  badge: Badge | null
}

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface ProductQuery {
  category?: string
  search?: string
  inStock?: boolean
  ids?: readonly number[]
  page?: number
  pageSize?: number
}

export interface OrderItemInput {
  product_id: number
  quantity: number
}

export interface OrderCreateInput {
  customer_name: string
  phone: string
  fulfillment: Fulfillment
  address: string
  customer_note: string
  payment_method: PaymentMethod
  items: OrderItemInput[]
  idempotency_key: string
}

export interface OrderItem {
  product_id: number | null
  product_name: string
  sku: string
  unit: string
  quantity: number
  unit_price: Money
  line_total: Money
}

export interface Order {
  number: string
  status: OrderStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod
  fulfillment: Fulfillment
  customer_name: string
  phone: string
  address: string
  customer_note: string
  subtotal: Money
  delivery_fee: Money
  total: Money
  items: OrderItem[]
  created_at: string
  updated_at: string
}

export interface CreatedOrder {
  order: Order & { token: string }
  /** true for HTTP 201, false for an idempotent replay (HTTP 200). */
  created: boolean
}

export interface Api {
  getStore(signal?: AbortSignal): Promise<StoreConfig>
  getCategories(signal?: AbortSignal): Promise<Category[]>
  getProducts(query: ProductQuery, signal?: AbortSignal): Promise<Page<Product>>
  createOrder(input: OrderCreateInput): Promise<CreatedOrder>
  getOrder(token: string, signal?: AbortSignal): Promise<Order>
  reportPayment(token: string, reference: string): Promise<Order>
}
