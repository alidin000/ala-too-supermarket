import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { useResource } from '../lib/hooks'
import { rulesFromStore } from '../lib/pricing'
import { StoreConfigContext } from './context'
import type { StoreConfigState } from './context'

const fetchStore = (signal: AbortSignal) => api.getStore(signal)

export function StoreConfigProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, reload } = useResource('store', fetchStore)
  const value = useMemo<StoreConfigState>(
    () => ({
      config: data ?? null,
      rules: data ? rulesFromStore(data) : null,
      error,
      loading,
      reload,
    }),
    [data, error, loading, reload],
  )
  return <StoreConfigContext value={value}>{children}</StoreConfigContext>
}
