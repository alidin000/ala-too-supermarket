import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAnnounce } from '../a11y/announce'
import { useI18n } from '../i18n/context'

/** Copies a value (order number, phone) for pasting into the bank app. */
export function CopyButton({ value, label }: { value: string; label: string }) {
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

  return (
    <button type="button" className="icon-btn icon-btn--sm" onClick={copy} aria-label={label}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  )
}
