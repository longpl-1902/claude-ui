import type { ReactNode } from 'react'
import './ui.css'

export interface ErrorBannerProps {
  message: string
  onDismiss?(): void
  /** Optional recovery control (a Button) shown beside the message. */
  action?: ReactNode
  className?: string
  /** Full text for the tooltip when `message` is a shortened version. */
  title?: string
}

export function ErrorBanner({ message, onDismiss, action, className, title }: ErrorBannerProps): JSX.Element {
  return (
    <div className={['ac-errbanner', className].filter(Boolean).join(' ')} role="alert">
      <span className="ac-errbanner__text" title={title ?? message}>{message}</span>
      {action}
      {onDismiss && (
        <button type="button" className="ac-errbanner__x" aria-label="Dismiss error" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}
