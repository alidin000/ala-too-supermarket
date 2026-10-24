import { createHttpApi } from './http'
import type { Api } from './types'

export const IS_MOCK = import.meta.env.VITE_USE_MOCK === '1'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

let implementation: Promise<Api> | undefined

function load(): Promise<Api> {
  implementation ??= IS_MOCK
    ? // The mock and its demo data live in a separate chunk, only fetched in demo mode.
      import('./mock/mockApi').then((module) => module.createMockApi())
    : Promise.resolve(createHttpApi(API_BASE_URL))
  return implementation
}

/** The storefront API: the real backend, or the in-browser demo when VITE_USE_MOCK=1. */
export const api: Api = {
  getStore: (signal) => load().then((impl) => impl.getStore(signal)),
  getCategories: (signal) => load().then((impl) => impl.getCategories(signal)),
  getProducts: (query, signal) => load().then((impl) => impl.getProducts(query, signal)),
  createOrder: (input) => load().then((impl) => impl.createOrder(input)),
  getOrder: (token, signal) => load().then((impl) => impl.getOrder(token, signal)),
  reportPayment: (token, reference) => load().then((impl) => impl.reportPayment(token, reference)),
}

export { ApiError, isAbortError } from './errors'
export type * from './types'
