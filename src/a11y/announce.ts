import { createContext, use } from 'react'

export const AnnounceContext = createContext<(message: string) => void>(() => {})

/** Returns a function that reads a short message to screen-reader users. */
export function useAnnounce(): (message: string) => void {
  return use(AnnounceContext)
}
