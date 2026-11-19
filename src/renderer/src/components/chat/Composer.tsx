import { useLayoutEffect, useRef } from 'react'
import type { ClipboardEvent, KeyboardEvent, ReactNode, Ref } from 'react'
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
  /** T28 extension slots. */
  toolbar?: ReactNode
  beforeInput?: ReactNode
  onPaste?(e: ClipboardEvent<HTMLTextAreaElement>): void
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
    if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    if (canSend) p.onSend()
  }

  return (
    <form
      ref={root}
      className="ac-composer"
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
          id="ac-chat-prompt"
          ref={setRef}
          rows={MIN_LINES}
          aria-label="Message"
          placeholder={p.placeholder ?? ''}
          value={p.value}
          disabled={p.disabled}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={onKeyDown}
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
        <div className="ac-composer__hint">Enter to send, Shift+Enter for a new line</div>
      )}
    </form>
  )
}
