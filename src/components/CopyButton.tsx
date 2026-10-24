import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAnnounce } from '../a11y/announce'
import { useI18n } from '../i18n/context'

interface CopyButtonProps {
  value: string
  /** The accessible name; also the visible text when `showLabel` is set. */
  label: string
  /** Shows `label` next to the icon as an outlined button instead of an icon-only one. */
  showLabel?: boolean
}

/** Copies a value (order number, phone, tracking link) to the clipboard. */
export function CopyButton({ value, label, showLabel = false }: CopyButtonProps) {
  const { t } = useI18n()
  const announce = useAnnounce()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      announce(t('common.copied'))
    } catch {
      // No clipboard access (insecure context or denied): the value stays visible to copy.
    }
  }

  const icon = copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />
  if (showLabel) {
    return (
      <button type="button" className="btn btn--outline btn--sm" onClick={copy}>
        {icon}
        {copied ? t('common.copied') : label}
      </button>
    )
  }
  return (
    <button type="button" className="icon-btn icon-btn--sm" onClick={copy} aria-label={label}>
      {icon}
    </button>
  )
}
