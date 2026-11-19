import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type { McpServerLive } from '@shared/types'
import './controlBar.css'

type Align = 'left' | 'right'

/**
 * Open/close state, outside-click and Esc handling shared by the "..." menu and the MCP popover (patterns from
 * AccountMenu). The panel is `position: fixed` under the trigger so the console's overflow never clips it.
 */
function usePopup(width: number, align: Align) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const top = Math.round(r.bottom + 4)
    setPos(
      align === 'right'
        ? { top, right: Math.max(8, Math.round(window.innerWidth - r.right)) }
        : { top, left: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - width - 8)) }
    )
  }, [open, align, width])

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  return { open, setOpen, pos, wrap, trigger, close }
}

const focusables = (root: HTMLElement | null, sel: string): HTMLElement[] =>
  Array.from(root?.querySelectorAll<HTMLElement>(sel) ?? [])

export interface MenuAction {
  key: string
  label: string
  onSelect(): void
  disabled?: boolean
  danger?: boolean
}

export interface MoreMenuProps {
  /** Shown as the menu header (the session title). */
  title: string
  actions: MenuAction[]
}

/** The toolbar's "..." menu: role=menu with menuitems, arrow keys, Home/End, Esc returns focus to the trigger. */
export function MoreMenu({ title, actions }: MoreMenuProps): JSX.Element {
  const { open, setOpen, pos, wrap, trigger, close } = usePopup(240, 'right')
  const items = (): HTMLElement[] => focusables(wrap.current, '[role="menu"] [role="menuitem"]:not(:disabled)')
  const focusAt = (i: number): void => {
    const list = items()
    if (list.length === 0) return
    list[((i % list.length) + list.length) % list.length]?.focus()
  }
  useEffect(() => {
    if (open) focusAt(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onKey = (e: KeyboardEvent): void => {
    const list = items()
    const cur = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusAt(cur + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusAt(cur < 0 ? list.length - 1 : cur - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAt(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAt(list.length - 1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="ac-ctl-pop" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="ac-ctl-iconbtn"
        aria-label="More session actions"
        title="More session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span aria-hidden="true">{'⋯'}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Session actions" className="ac-ctl-menu" style={pos} onKeyDown={onKey}>
          <div className="ac-ctl-menu__title" role="presentation" title={title}>
            {title}
          </div>
          <div className="ac-ctl-menu__sep" role="separator" />
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              disabled={a.disabled ?? false}
              className={`ac-ctl-menu__row${a.danger ? ' ac-ctl-menu__row--danger' : ''}`}
              onClick={() => {
                close(true)
                a.onSelect()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type McpLevel = 'ok' | 'warn' | 'bad' | 'none'

/** Green when every enabled server is connected, amber when one needs attention, red when one failed. */
export function mcpLevel(servers: McpServerLive[]): McpLevel {
  const live = servers.filter((s) => s.status !== 'disabled')
  if (live.some((s) => s.status === 'failed')) return 'bad'
  if (live.some((s) => s.status !== 'connected')) return 'warn'
  return live.length === 0 ? 'none' : 'ok'
}

export interface McpPopoverProps {
  servers: McpServerLive[]
  /** The existing McpChips content. */
  children: ReactNode
}

/** "MCP 6" summary chip with a status dot; opens a popover with the server chips and "Manage servers...". */
export function McpPopover({ servers, children }: McpPopoverProps): JSX.Element {
  const { open, setOpen, pos, wrap, trigger, close } = usePopup(360, 'left')
  const level = mcpLevel(servers)
  const attention = servers.filter((s) => s.status !== 'connected' && s.status !== 'disabled').length
  useEffect(() => {
    if (open) focusables(wrap.current, '[role="dialog"] button')[0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <div className="ac-ctl-pop" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="ac-tc-chipbtn ac-ctl-mcpbtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`MCP servers: ${servers.length}${attention > 0 ? `, ${attention} need attention` : ''}`}
        title={attention > 0 ? `${attention} MCP server(s) need attention` : 'MCP servers'}
        data-level={level}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="ac-ctl-mcpdot">
          {'●'}
        </span>
        {` MCP ${servers.length}`}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="MCP servers"
          className="ac-ctl-menu ac-ctl-menu--wide"
          style={pos}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              close(true)
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
