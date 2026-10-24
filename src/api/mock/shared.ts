// State shared by the storefront mock (mockApi.ts) and the staff mock
// (src/staff/mock/staffMock.ts): the demo database in localStorage and the ?mock= switches.
// Only loaded when VITE_USE_MOCK=1.

import { readJson, readStorage, writeStorage } from '../../lib/storage'
import { abortError } from '../errors'
import type { Badge, Order, OrderStatus } from '../types'
import { MOCK_PRODUCTS } from './data'
import type { MockProduct } from './data'

const DB_KEY = 'ala-too:mock-db:v1'
const FLAGS_KEY = 'ala-too:mock-flags'
const ONE_SHOT = new Set(['fail-products', 'throttle', 'offline', 'csrf'])

/** A journal entry, as the staff API returns it. */
export interface MockEvent {
  at: string
  kind: 'created' | 'status' | 'payment' | 'payment_reported' | 'stock_restored' | 'edited'
  from: string | null
  to: string | null
  actor: string | null
  message: string
}

export interface StoredOrder extends Order {
  token: string
  idempotency_key: string
  payment_reference: string
  reported_at: string | null
  /** Set once the staff panel manages the order: its status no longer moves on its own. */
  staff_managed?: boolean
  staff_note?: string
  events?: MockEvent[]
  stock_restored?: boolean
}

/** Staff edits to a demo product (the catalogue itself is static in data.ts). */
export interface ProductOverride {
  price?: string
  badge?: Badge | null
  is_active?: boolean
  updated_at?: string
}

export interface MockDb {
  seq: number
  stock: Record<string, number>
  orders: StoredOrder[]
  products?: Record<string, ProductOverride>
  /** Present once the staff panel has been opened in this browser. */
  staff?: { seeded: boolean; paused: boolean; lastSpawnAt: number }
}

// --- Switches -----------------------------------------------------------------------------

function readFlags(): Set<string> {
  const stored = readStorage(FLAGS_KEY, 'session')
  return new Set(stored ? stored.split(',').filter(Boolean) : [])
}

function writeFlags(flags: Set<string>): void {
  writeStorage(FLAGS_KEY, flags.size > 0 ? [...flags].join(',') : null, 'session')
}

/** Reads ?mock=... from the URL once per page load. */
export function initFlags(): void {
  const requested = new URLSearchParams(window.location.search).get('mock')
  if (!requested) return
  const flags = readFlags()
  for (const flag of requested.split(',').map((value) => value.trim())) {
    if (flag === 'off') flags.clear()
    else if (flag === 'reset') writeStorage(DB_KEY, null)
    else if (flag) flags.add(flag)
  }
  writeFlags(flags)
}

export const hasFlag = (flag: string) => readFlags().has(flag)

/** Fires a one-shot switch: returns true once, then turns it off. */
export function consumeFlag(flag: string): boolean {
  const flags = readFlags()
  if (!flags.has(flag)) return false
  if (ONE_SHOT.has(flag)) {
    flags.delete(flag)
    writeFlags(flags)
  }
  return true
}

// --- Storage ------------------------------------------------------------------------------

function freshDb(): MockDb {
  const stock: Record<string, number> = {}
  for (const product of MOCK_PRODUCTS) stock[product.id] = product.stock
  return { seq: 120, stock, orders: [] }
}

export function loadDb(): MockDb {
  const data = readJson(DB_KEY) as Partial<MockDb> | null
  if (!data || typeof data.seq !== 'number' || !data.stock || !Array.isArray(data.orders)) {
    return freshDb()
  }
  // Keep every section, including the staff panel's, when the storefront saves.
  return { ...data, seq: data.seq, stock: data.stock, orders: data.orders }
}

export function saveDb(db: MockDb): void {
  writeStorage(DB_KEY, JSON.stringify(db))
}

// --- Helpers ------------------------------------------------------------------------------

export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(abortError())
      },
      { once: true },
    )
  })
}

export const money = (minor: number) => (minor / 100).toFixed(2)
export const minorOf = (value: string) => Math.round(Number(value) * 100)

export function randomToken(bytes = 24): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** A demo product with the staff panel's edits applied. */
export function effectiveProduct(
  product: MockProduct,
  db: MockDb,
): MockProduct & { is_active: boolean } {
  const override = db.products?.[product.id] ?? {}
  return {
    ...product,
    price: override.price ?? product.price,
    badge: override.badge === undefined ? product.badge : override.badge,
    is_active: override.is_active ?? true,
  }
}

// --- Order status over time -------------------------------------------------------------

export const STEPS: Record<Order['fulfillment'], OrderStatus[]> = {
  delivery: ['new', 'confirmed', 'preparing', 'out_for_delivery', 'completed'],
  pickup: ['new', 'confirmed', 'preparing', 'ready', 'completed'],
}
// Seconds after creation at which the demo order moves to the next status.
const STEP_AFTER_S = [0, 20, 60, 120, 600]

/** Demo orders move along on their own, so the order page has something to poll. */
export function withLiveStatus(order: StoredOrder): StoredOrder {
  if (order.status === 'cancelled' || order.staff_managed) return order
  const ageS = (Date.now() - new Date(order.created_at).getTime()) / 1000
  const steps = STEPS[order.fulfillment]
  let index = 0
  STEP_AFTER_S.forEach((after, step) => {
    if (ageS >= after) index = step
  })
  let paymentStatus = order.payment_status
  if (paymentStatus === 'pending' && order.reported_at) {
    const sinceReportS = (Date.now() - new Date(order.reported_at).getTime()) / 1000
    if (sinceReportS > 30) paymentStatus = 'paid'
  }
  return { ...order, status: steps[index] ?? order.status, payment_status: paymentStatus }
}
