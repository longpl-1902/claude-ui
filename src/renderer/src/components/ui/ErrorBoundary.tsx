import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './ui.css'

interface Props {
  /** Shown in the message: "<label> hit an error." */
  label?: string
  children: ReactNode
}
interface State {
  error: Error | null
  /** Bumped by "Reload view" so the children mount from scratch. */
  attempt: number
}

/**
 * Renderer error boundary (T32 U1): a render throw inside a screen shows one line and a way back, instead of an
 * empty window. Placed inside the screens, never around the window-kind switch.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Agent Console view error:', error, info.componentStack)
  }

  private reload = (): void => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))
  }

  override render(): ReactNode {
    const { error, attempt } = this.state
    if (error) {
      return (
        <div className="ac-errorboundary" role="alert">
          <span className="ac-errorboundary__text" title={error.message}>
            {this.props.label ?? 'This view'} hit an error: {error.message || 'unknown error'}
          </span>
          <button type="button" className="ac-errorboundary__btn" onClick={this.reload}>
            Reload view
          </button>
        </div>
      )
    }
    return <div key={attempt} className="ac-errorboundary__root">{this.props.children}</div>
  }
}
