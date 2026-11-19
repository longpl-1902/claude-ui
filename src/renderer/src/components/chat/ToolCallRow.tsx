import { useState } from 'react'
import { shortenPathsInText } from '@shared/displayPath'
import { CopyButton } from './CopyButton'
import './chat.css'

const MAX_CHARS = 800
const MAX_LINES = 14

export interface ToolCallRowProps {
  /** Console line text: "<Tool> <input summary>". */
  text: string
  projectRoot?: string
  platform?: string
}

/** One collapsed tool call "▸ Bash  npm test"; expands to the full input/result, truncated with "show more". */
export function ToolCallRow({ text, projectRoot, platform = 'posix' }: ToolCallRowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const m = /^(\S+)\s*([\s\S]*)$/.exec(text)
  const name = m?.[1] ?? text
  const rest = m?.[2] ?? ''
  const opts = { ...(projectRoot ? { root: projectRoot } : {}), platform }
  const shown = shortenPathsInText(rest, opts)
  const first = shown.split('\n', 1)[0] ?? ''
  const lines = shown.split('\n')
  const long = shown.length > MAX_CHARS || lines.length > MAX_LINES
  const body = long && !more ? `${lines.slice(0, MAX_LINES).join('\n').slice(0, MAX_CHARS)}...` : shown
  return (
    <div className={`ac-chat__tool${open ? ' is-open' : ''}`}>
      <div className="ac-chat__toolhead">
        <button type="button" className="ac-chat__toolbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="ac-chat__toolname">{name}</span>
          <span className="ac-chat__toolsum">{first}</span>
        </button>
        <CopyButton text={rest || text} label="tool input" />
      </div>
      {open && (
        <div className="ac-chat__toolbody">
          <pre tabIndex={0} aria-label="Tool input and result">
            {body}
          </pre>
          {long && (
            <button type="button" className="ac-chat__more" onClick={() => setMore((v) => !v)}>
              {more ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
