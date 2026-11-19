import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import './dialog.css'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Keep Tab / Shift+Tab inside `container`. Shared with drawers. */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (items.length === 0) {
    e.preventDefault()
    container.focus()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  /** Element to focus on open; defaults to the first focusable element, else the dialog. */
  initialFocus?: () => HTMLElement | null
  children?: ReactNode
  footer?: ReactNode
  /** Show a visible × close button in the title row (T32 U15). */
  closeButton?: boolean
}

export function Dialog({ open, title, onClose, initialFocus, children, footer, closeButton }: DialogProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const initialRef = useRef(initialFocus)
  initialRef.current = initialFocus

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const el = panel.current
    const target = initialRef.current?.() ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el
    target?.focus()
    return () => {
      const o = opener.current
      if (o && o.isConnected) o.focus()
    }
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    trapTab(e, panel.current)
  }

  return (
    <div
      className="ac-dialog__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ac-dialog"
        onKeyDown={onKeyDown}
      >
        {closeButton ? (
          <div className="ac-dialog__head">
            <h2 id={titleId} className="ac-dialog__title">
              {title}
            </h2>
            <button type="button" className="ac-dialog__close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
              {'×'}
            </button>
          </div>
        ) : (
          <h2 id={titleId} className="ac-dialog__title">
            {title}
          </h2>
        )}
        <div className="ac-dialog__body">{children}</div>
        {footer && <div className="ac-dialog__footer">{footer}</div>}
      </div>
    </div>
  )
}
