import { useLayoutEffect, useRef } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, Ref, SyntheticEvent } from 'react'
import './chat.css'

export interface ComposerProps {
  value: string
  onChange(v: string): void
  /** Called only from an explicit Enter or the Send button (R-19). Never on mount, paste or change. */
  onSend(): void
  disabled?: boolean
  /** Shown instead of the help line while disabled. */
  disabledReason?: ReactNode
  /** "to lead" / "to @name" */
  target: string
  /** Session state text, e.g. "idle", "busy". */
  stateLabel?: string
  placeholder?: string
  error?: string
  /**
   * Extension slots (T28, also usable by T29). All optional and generic:
   * - toolbar: controls rendered at the end of the meta row (wraps on narrow widths)
   * - beforeInput: content between the meta row and the field (attachment chips, cards)
   * - suggestions: popover anchored above the field (palette, @-mentions)
   * - onPaste / onDrop / onDragOver: raw handlers; the composer never sends from them (R-19)
   * - onKeyDown: runs first; call preventDefault() to stop the built-in Enter/Esc handling
   */
  toolbar?: ReactNode
  beforeInput?: ReactNode
  onPaste?(e: ClipboardEvent<HTMLTextAreaElement>): void
  onDrop?(e: DragEvent<HTMLElement>): void
  onDragOver?(e: DragEvent<HTMLElement>): void
  onKeyDown?(e: KeyboardEvent<HTMLTextAreaElement>): void
  onSelect?(e: SyntheticEvent<HTMLTextAreaElement>): void
  /** When true Enter inserts a newline and Ctrl/Cmd+Enter sends. */
  ctrlEnterSend?: boolean
  /** DOM id of the textarea (default "ac-chat-prompt") and its accessible name (default "Message"). */
  id?: string
  ariaLabel?: string
  /** Extra props for the textarea, e.g. aria-controls / aria-activedescendant for a popover. */
  inputAria?: Record<string, string | boolean | undefined>
  /** Anchor for a suggestions popover (palette, @-mentions); rendered above the input. */
  suggestions?: ReactNode
  textareaRef?: Ref<HTMLTextAreaElement>
}

const MIN_LINES = 2
/** Grow with the text up to this share of the view, then scroll. */
const MAX_VIEW_SHARE = 0.4

export function Composer(p: ComposerProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const root = useRef<HTMLFormElement>(null)
  const setRef = (el: HTMLTextAreaElement | null): void => {
    ref.current = el
    if (typeof p.textareaRef === 'function') p.textareaRef(el)
    else if (p.textareaRef) (p.textareaRef as { current: HTMLTextAreaElement | null }).current = el
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const host = root.current?.parentElement
    const view = host?.clientHeight || window.innerHeight || 800
    el.style.height = 'auto'
    const max = Math.max(80, Math.floor(view * MAX_VIEW_SHARE))
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [p.value])

  const canSend = !p.disabled && p.value.trim() !== ''
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    p.onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    }
    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return
    if (e.nativeEvent.isComposing) return
    const mod = e.ctrlKey || e.metaKey
    if (p.ctrlEnterSend ? !mod : mod) return
    e.preventDefault()
    if (canSend) p.onSend()
  }

  return (
    <form
      ref={root}
      className="ac-composer"
      {...(p.onDrop ? { onDrop: p.onDrop } : {})}
      {...(p.onDragOver ? { onDragOver: p.onDragOver } : {})}
      onSubmit={(e) => {
        e.preventDefault()
        if (canSend) p.onSend()
      }}
    >
      <div className="ac-composer__meta">
        <span className="ac-composer__target">{p.target}</span>
        {p.stateLabel && <span className="ac-composer__state">{p.stateLabel}</span>}
        {p.toolbar && <span className="ac-composer__toolbar">{p.toolbar}</span>}
      </div>
      {p.beforeInput}
      <div className="ac-composer__field">
        {p.suggestions && <div className="ac-composer__suggest">{p.suggestions}</div>}
        <textarea
          id={p.id ?? 'ac-chat-prompt'}
          ref={setRef}
          rows={MIN_LINES}
          aria-label={p.ariaLabel ?? 'Message'}
          {...p.inputAria}
          placeholder={p.placeholder ?? ''}
          value={p.value}
          disabled={p.disabled}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={onKeyDown}
          {...(p.onSelect ? { onSelect: p.onSelect } : {})}
          {...(p.onPaste ? { onPaste: p.onPaste } : {})}
        />
        <button type="submit" className="ac-composer__send" disabled={!canSend}>
          Send
        </button>
      </div>
      {p.error && (
        <p className="ac-composer__error" role="alert">
          {p.error}
        </p>
      )}
      {p.disabled && p.disabledReason ? (
        <div className="ac-composer__reason">{p.disabledReason}</div>
      ) : (
        <div className="ac-composer__hint">
          {p.ctrlEnterSend ? 'Ctrl+Enter to send, Enter for a new line' : 'Enter to send, Shift+Enter for a new line'}
        </div>
      )}
    </form>
  )
}
