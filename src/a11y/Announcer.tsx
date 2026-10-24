import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { AnnounceContext } from './announce'

/**
 * One polite live region for the whole app (cart changes, search results, form outcomes).
 * It sits outside the app shell, so it still speaks while a modal dialog makes the shell inert.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState({ id: 0, text: '' })
  const announce = useCallback((text: string) => {
    setMessage((previous) => ({ id: previous.id + 1, text }))
  }, [])

  return (
    <AnnounceContext value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {/* A new key replaces the node, so the same text is announced again. */}
        <span key={message.id}>{message.text}</span>
      </div>
    </AnnounceContext>
  )
}
