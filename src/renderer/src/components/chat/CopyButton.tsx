import { useEffect, useRef, useState } from 'react'
import './chat.css'

/** Copy `text` to the clipboard; false when the clipboard is unavailable or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export interface CopyButtonProps {
  /** Exact text that lands on the clipboard. */
  text: string
  /** What is copied: the button is named "Copy <label>". */
  label: string
  className?: string
}

/** Icon button, visible on hover and keyboard focus of its container, with an aria-live confirmation. */
export function CopyButton({ text, label, className }: CopyButtonProps): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const onClick = async (): Promise<void> => {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1600)
  }
  return (
    <span className={`ac-copy${className ? ` ${className}` : ''}`} data-state={state}>
      <button type="button" className="ac-copy__btn" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => void onClick()}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
        </svg>
      </button>
      <span className="ac-copy__msg" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </span>
  )
}
