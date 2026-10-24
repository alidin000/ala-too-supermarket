import { useSyncExternalStore } from 'react'
import { readJson, writeStorage } from './storage'

// Orders placed on this device, so customers can reopen them from "Мои заказы". The token
// is the only key to an order, so it stays on the device and is never sent anywhere else.

export interface RecentOrder {
  number: string
  token: string
  createdAt: string
  total: string
}

const KEY = 'ala-too:recent-orders:v1'
const MAX_ORDERS = 20
const listeners = new Set<() => void>()
let cache: RecentOrder[] | null = null

function isRecentOrder(value: unknown): value is RecentOrder {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.number === 'string' &&
    typeof row.token === 'string' &&
    row.token.length > 0 &&
    typeof row.createdAt === 'string' &&
    typeof row.total === 'string'
  )
}

export function parseRecentOrders(value: unknown): RecentOrder[] {
  return Array.isArray(value) ? value.filter(isRecentOrder).slice(0, MAX_ORDERS) : []
}

export function getRecentOrders(): RecentOrder[] {
  cache ??= parseRecentOrders(readJson(KEY))
  return cache
}

export function saveRecentOrder(order: RecentOrder): void {
  const others = getRecentOrders().filter((row) => row.token !== order.token)
  cache = [order, ...others].slice(0, MAX_ORDERS)
  writeStorage(KEY, JSON.stringify(cache))
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const EMPTY: RecentOrder[] = []

export function useRecentOrders(): RecentOrder[] {
  return useSyncExternalStore(subscribe, getRecentOrders, () => EMPTY)
}
