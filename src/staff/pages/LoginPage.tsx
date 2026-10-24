import { Eye, EyeOff, Info, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { IS_MOCK } from '../../api'
import { DemoBanner } from '../../components/Banners'
import { BrandMark } from '../../components/BrandMark'
import { Notice } from '../../components/Notice'
import { isStaffApiError } from '../api'
import { staffApi } from '../client'
import { errorMessage } from '../format'
import { useStaffTitle } from '../hooks'
import { S } from '../strings'
import type { StaffSession } from '../types'

interface LoginError {
  /** Bumped on every failure, so the same message is focused and announced again. */
  id: number
  title?: string
  message: string
  hint?: string
  /** A credentials problem, as opposed to a lockout or a network error. */
  invalid?: boolean
}

/** /admin/login: username and password, no "remember me". */
export function LoginPage({ onLoggedIn }: { onLoggedIn: (session: StaffSession) => void }) {
  useStaffTitle(S.login.title)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<LoginError | null>(null)
  const [demoLogins, setDemoLogins] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // Demo mode only: the demo accounts come from the mock chunk, which production lacks.
  useEffect(() => {
    if (import.meta.env.VITE_USE_MOCK !== '1') return
    let active = true
    void import('../mock/staffMock').then((module) => {
      if (active) setDemoLogins(module.DEMO_LOGINS)
    })
    return () => {
      active = false
    }
  }, [])

  // Move focus to the error, so keyboard and screen-reader users hear it at once.
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  function fail(next: Omit<LoginError, 'id'>) {
    setError((previous) => ({ ...next, id: (previous?.id ?? 0) + 1 }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    if (!username.trim() || !password) {
      fail({ message: S.login.required, invalid: true })
      return
    }
    setSending(true)
    try {
      const session = await staffApi.login(username.trim(), password)
      if (!session.authenticated) {
        fail({ message: S.login.failed, invalid: true })
        return
      }
      setPassword('')
      onLoggedIn(session)
    } catch (reason) {
      setPassword('')
      if (isStaffApiError(reason, 'throttled')) {
        fail({
          title: S.login.lockedTitle,
          message: S.login.locked(reason.retryAfter ?? 15 * 60),
          hint: S.login.lockedHint,
        })
      } else if (isStaffApiError(reason, 'validation')) {
        // The server sends the same text for every kind of failure; keep it generic.
        fail({ message: S.login.failed, invalid: true })
      } else {
        fail({ message: errorMessage(reason) })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app staff-login">
      {IS_MOCK && <DemoBanner />}
      <main id="staff-main" className="main staff-login__main">
        <div className="staff-login__card">
          <div className="staff-login__brand">
            <BrandMark size={48} />
            <span className="brand__name">
              {S.brand} <span className="brand__accent">{S.brandAccent}</span>
            </span>
          </div>
          <h1 className="staff-login__title" tabIndex={-1}>
            {S.login.title}
          </h1>
          <p className="muted">{S.login.lead}</p>

          {error && (
            <div
              key={error.id}
              ref={errorRef}
              className="staff-login__error"
              role="alert"
              tabIndex={-1}
            >
              <Notice tone="danger" title={error.title}>
                <p>{error.message}</p>
                {error.hint && <p>{error.hint}</p>}
              </Notice>
            </div>
          )}

          <form className="staff-login__form" noValidate onSubmit={submit}>
            <div className="field">
              <label className="field__label" htmlFor="staff-username">
                {S.login.username}
              </label>
              <input
                id="staff-username"
                className="input"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                aria-invalid={error?.invalid || undefined}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="staff-password">
                {S.login.password}
              </label>
              <div className="staff-password">
                <input
                  id="staff-password"
                  className="input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  aria-invalid={error?.invalid || undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn--sm staff-password__toggle"
                  aria-label={showPassword ? S.login.hidePassword : S.login.showPassword}
                  aria-pressed={showPassword}
                  aria-controls="staff-password"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn--primary btn--lg btn--block"
              disabled={sending}
              aria-busy={sending || undefined}
            >
              <Lock aria-hidden="true" />
              {sending ? S.login.submitting : S.login.submit}
            </button>
          </form>

          {demoLogins && (
            <p className="staff-login__demo">
              <Info aria-hidden="true" />
              <span>
                <strong>{S.login.demoTitle}:</strong> {demoLogins}
              </span>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
