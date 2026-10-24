import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useI18n } from '../i18n/context'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Changing this value (for example the page key) clears a previous error. */
  resetKey: string
}

interface ErrorBoundaryState {
  failedKey: string | null
}

/** Keeps one broken page from blanking the whole shop: header, cart and footer still work. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failedKey: null }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failedKey: '__pending__' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack)
    this.setState({ failedKey: this.props.resetKey })
  }

  render() {
    const { failedKey } = this.state
    const failed = failedKey === '__pending__' || failedKey === this.props.resetKey
    return failed ? <PageCrashed /> : this.props.children
  }
}

function PageCrashed() {
  const { t } = useI18n()
  return (
    <div className="container page">
      <div className="state-panel" role="alert">
        <p className="state-panel__title">{t('crash.title')}</p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          {t('crash.reload')}
        </button>
      </div>
    </div>
  )
}
