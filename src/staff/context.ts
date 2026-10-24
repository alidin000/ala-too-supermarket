import { createContext, use } from 'react'
import type { OrdersSummary, StaffUser } from './types'

export interface StaffContextValue {
  user: StaffUser
  backofficeUrl: string | null
  /** Live counts for the nav badge and the board tabs; null until loaded or without access. */
  summary: OrdersSummary | null
  refreshSummary: () => void
  /** The shell element that a modal dialog makes inert. */
  getShell: () => HTMLElement | null
}

export const StaffContext = createContext<StaffContextValue | null>(null)

export function useStaff(): StaffContextValue {
  const value = use(StaffContext)
  if (!value) throw new Error('useStaff must be used inside the staff shell')
  return value
}
