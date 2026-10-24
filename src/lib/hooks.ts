import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { isAbortError } from '../api/errors'

/** Returns `value` once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export interface Resource<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
}

/**
 * Loads data for `key` and reloads when the key changes. Pass null to skip loading.
 * While a new key loads, `data` still holds the previous result.
 */
export function useResource<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown } | null>(null)
  const requestKey = key === null ? null : `${key}#${attempt}`
  const runFetcher = useEffectEvent((signal: AbortSignal) => fetcher(signal))

  useEffect(() => {
    if (requestKey === null) return
    const controller = new AbortController()
    runFetcher(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key: requestKey, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setState((previous) => ({ key: requestKey, data: previous?.data, error }))
        }
      },
    )
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const settled = state !== null && state.key === requestKey
  return {
    data: state?.data,
    error: settled ? state.error : undefined,
    loading: requestKey !== null && !settled,
    reload,
  }
}
