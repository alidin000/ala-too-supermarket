import { useEffectEvent, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  )
}

interface DialogProps {
  open: boolean
  onClose: () => void
  labelledBy: string
  className?: string
  children: ReactNode
}

/**
 * Modal dialog: focus moves in and is trapped, Esc and the backdrop close it, the page
 * behind cannot scroll, and focus returns to the element that opened it. The app shell is
 * made `inert` by the caller while the dialog is open.
 */
export function Dialog({ open, onClose, labelledBy, className, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const requestClose = useEffectEvent(() => onClose())

  // A layout effect: it must read the opener before the inert shell loses focus.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(panel)[0]
    ;(first ?? panel).focus()

    const { body, documentElement } = document
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingRight
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableIn(panel)
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === firstItem || active === panel)) {
        event.preventDefault()
        lastItem?.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem?.focus()
      } else if (!panel.contains(active)) {
        event.preventDefault()
        firstItem?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    // When the focused control disappears (for example a removed cart line), keep focus
    // inside the dialog instead of letting it fall back to <body>.
    let refocusTimer = 0
    const onFocusOut = () => {
      window.clearTimeout(refocusTimer)
      refocusTimer = window.setTimeout(() => {
        if (document.activeElement === document.body) panel.focus()
      })
    }
    panel.addEventListener('focusout', onFocusOut)

    return () => {
      window.clearTimeout(refocusTimer)
      panel.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="dialog-root">
      <div className="dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={['dialog', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
