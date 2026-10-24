import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warning' | 'danger'

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert }

interface NoticeProps {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  role?: 'alert' | 'status'
  className?: string
  action?: ReactNode
}

export function Notice({ tone = 'info', title, children, role, className, action }: NoticeProps) {
  const Icon = ICONS[tone]
  return (
    <div className={['notice', `notice--${tone}`, className].filter(Boolean).join(' ')} role={role}>
      <Icon className="notice__icon" aria-hidden="true" />
      <div className="notice__body">
        {title && <p className="notice__title">{title}</p>}
        {children}
        {action && <div className="notice__action">{action}</div>}
      </div>
    </div>
  )
}
