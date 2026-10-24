import { Lock, SearchX } from 'lucide-react'
import { Link } from '../../components/Link'
import { Notice } from '../../components/Notice'
import { errorMessage } from '../format'
import { S } from '../strings'

/** The 403 state: logged in, but this account may not use this part of the panel. */
export function Forbidden() {
  return (
    <div className="state-panel" role="alert">
      <span className="empty-illustration staff-forbidden-icon" aria-hidden="true">
        <Lock strokeWidth={1.5} />
      </span>
      <p className="state-panel__title">{S.forbidden.title}</p>
      <p className="muted">{S.forbidden.text}</p>
    </div>
  )
}

export function StaffNotFound({ title, text }: { title: string; text: string }) {
  return (
    <div className="state-panel">
      <span className="empty-illustration" aria-hidden="true">
        <SearchX strokeWidth={1.5} />
      </span>
      <p className="state-panel__title">{title}</p>
      <p className="muted">{text}</p>
      <div className="state-panel__actions">
        <Link to="/admin" className="btn btn--primary">
          {S.notFound.home}
        </Link>
      </div>
    </div>
  )
}

/** A failed load, with the reason and a retry button. */
export function LoadError({
  title,
  error,
  onRetry,
}: {
  title: string
  error: unknown
  onRetry: () => void
}) {
  return (
    <Notice
      tone="danger"
      role="alert"
      title={title}
      action={
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          {S.errors.retry}
        </button>
      }
    >
      <p>{errorMessage(error)}</p>
    </Notice>
  )
}
