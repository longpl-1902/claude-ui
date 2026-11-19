import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface RowMenuItem {
  label: string
  ariaLabel?: string
  danger?: boolean
  onSelect(): void
}

/** "..." button with a small menu for the rare or destructive actions of a row (T32 U13 / U14). */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const onKey = (e: KeyboardEvent): void => {
    const els = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(i + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(i - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <span className="ac-rowmenu" ref={root}>
      <button
        type="button"
        className="ac-rowmenu__btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {'⋯'}
      </button>
      {open && (
        <div role="menu" aria-label={label} className="ac-rowmenu__menu" onKeyDown={onKey}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`ac-rowmenu__item${it.danger ? ' is-danger' : ''}`}
              {...(it.ariaLabel ? { 'aria-label': it.ariaLabel } : {})}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
