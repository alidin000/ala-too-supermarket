import { useEffect, useState } from 'react'
import { useAnnounce } from '../../a11y/announce'
import { isAbortError } from '../../api/errors'
import { staffApi } from '../client'
import { errorMessage } from '../format'
import { S } from '../strings'
import type { StaffStoreSettings } from '../types'
import { StaffDialog } from './StaffDialog'

/**
 * "Принимаем заказы": shown only to users with pause_orders. Pausing asks for confirmation
 * first; resuming does not. The text under it reflects accepts_orders_now.
 */
export function StoreSwitch() {
  const announce = useAnnounce()
  const [settings, setSettings] = useState<StaffStoreSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    staffApi.getStore(controller.signal).then(setSettings, (reason: unknown) => {
      if (!isAbortError(reason)) setError(errorMessage(reason))
    })
    return () => controller.abort()
  }, [])

  async function apply(value: boolean) {
    setBusy(true)
    setError(null)
    try {
      const next = await staffApi.setAcceptingOrders(value)
      setSettings(next)
      announce(value ? S.store.resumedAnnounce : S.store.pausedAnnounce)
    } catch (reason) {
      setError(`${S.store.error} ${errorMessage(reason)}`)
      announce(S.store.error)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return error ? (
      <p className="staff-switch__error" role="status">
        {error}
      </p>
    ) : null
  }

  const on = settings.is_accepting_orders
  const stateText = !on
    ? S.store.paused
    : settings.accepts_orders_now
      ? S.store.on
      : S.store.onButClosed

  return (
    <div className={`staff-switch${on ? ' staff-switch--on' : ' staff-switch--off'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby="store-switch-state"
        className="staff-switch__control"
        // aria-disabled, not disabled: focus must be able to return here from the dialog.
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return
          if (on) setConfirming(true)
          else void apply(true)
        }}
      >
        <span className="staff-switch__track" aria-hidden="true">
          <span className="staff-switch__thumb" />
        </span>
        <span className="staff-switch__label">{S.store.switchLabel}</span>
      </button>
      <span id="store-switch-state" className="staff-switch__state">
        {error ?? stateText}
      </span>

      <StaffDialog open={confirming} onClose={() => setConfirming(false)} labelledBy="pause-title">
        <div className="staff-dialog__body">
          <h2 id="pause-title" className="staff-dialog__title">
            {S.store.confirmTitle}
          </h2>
          <p>{S.store.confirmText}</p>
        </div>
        <div className="staff-dialog__actions">
          <button
            type="button"
            className="btn btn--outline"
            data-autofocus
            onClick={() => setConfirming(false)}
          >
            {S.store.keepOpen}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              setConfirming(false)
              void apply(false)
            }}
          >
            {S.store.confirmPause}
          </button>
        </div>
      </StaffDialog>
    </div>
  )
}
