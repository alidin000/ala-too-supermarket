export type ApiErrorKind =
  'network' | 'timeout' | 'validation' | 'not_found' | 'throttled' | 'server' | 'http'

/** DRF validation errors, flattened to plain message lists per field. */
export type FieldErrors = Record<string, string[]>

interface ApiErrorOptions {
  fieldErrors?: FieldErrors
  detail?: string | null
  message?: string
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly fieldErrors: FieldErrors
  readonly detail: string | null

  constructor(kind: ApiErrorKind, status: number, options: ApiErrorOptions = {}) {
    super(options.message ?? options.detail ?? `API error: ${kind} (${status})`)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.fieldErrors = options.fieldErrors ?? {}
    this.detail = options.detail ?? null
  }
}

/** Collects every string in a DRF error value: "msg", ["msg"], [{quantity: ["msg"]}], ... */
export function flattenMessages(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) return value.flatMap(flattenMessages)
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenMessages)
  return []
}

export function parseErrorBody(body: unknown): { fieldErrors: FieldErrors; detail: string | null } {
  const fieldErrors: FieldErrors = {}
  let detail: string | null = null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const messages = flattenMessages(body)
    if (messages.length > 0) fieldErrors.non_field_errors = messages
    return { fieldErrors, detail }
  }
  for (const [key, value] of Object.entries(body)) {
    if (key === 'detail' && typeof value === 'string') {
      detail = value
      continue
    }
    const messages = flattenMessages(value)
    if (messages.length > 0) fieldErrors[key] = messages
  }
  return { fieldErrors, detail }
}

export function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 400) return 'validation'
  if (status === 404) return 'not_found'
  if (status === 429) return 'throttled'
  if (status >= 500) return 'server'
  return 'http'
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}
