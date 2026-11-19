import type { FileSuggestion } from '@shared/types'

export interface MentionMatch {
  /** Index of the `@`. */
  start: number
  /** Caret position the match ends at. */
  end: number
  query: string
}

/** The `@token` ending at the caret, if the `@` starts a word. */
export function findMention(text: string, caret: number): MentionMatch | null {
  let i = caret
  while (i > 0 && !/\s/.test(text.charAt(i - 1))) i--
  if (text.charAt(i) !== '@') return null
  return { start: i, end: caret, query: text.slice(i + 1, caret) }
}

/** At the very start of the text an `@name` that matches a teammate (or the lead) is routing, not a file mention. */
export function isAgentRouting(m: MentionMatch, agentNames: string[]): boolean {
  if (m.start !== 0 || /[\\/.]/.test(m.query)) return false
  const q = m.query.toLowerCase()
  return ['lead', ...agentNames].some((n) => n !== '' && n.toLowerCase().startsWith(q))
}

export const isFolder = (p: string): boolean => p.endsWith('/') || p.endsWith('\\')

export function relativePath(path: string, cwd: string): string {
  const norm = (s: string): string => s.replace(/\\/g, '/')
  const p = norm(path)
  const c = norm(cwd).replace(/\/+$/, '')
  return c !== '' && p.toLowerCase().startsWith(c.toLowerCase() + '/') ? p.slice(c.length + 1) : p
}

/** Replace the `@query` with `@<path>` (a space after files, none after folders so the user can keep descending). */
export function insertMention(text: string, m: MentionMatch, path: string): { text: string; caret: number } {
  const ins = `@${path}${isFolder(path) ? '' : ' '}`
  return { text: text.slice(0, m.start) + ins + text.slice(m.end), caret: m.start + ins.length }
}

export const mentionOptionId = (i: number): string => `ac-mention-${i}`

export interface MentionPickerProps {
  items: FileSuggestion[]
  cwd: string
  active: number
  onPick(path: string): void
  listId?: string
}

/** Listbox of file/folder suggestions. Picking only edits the draft (R-19). */
export function MentionPicker({ items, cwd, active, onPick, listId = 'ac-mention-list' }: MentionPickerProps): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="ac-pop">
      <ul className="ac-pop__list" id={listId} role="listbox" aria-label="Files and folders">
        {items.map((s, i) => {
          const rel = relativePath(s.path, cwd)
          return (
            <li
              key={s.path}
              id={mentionOptionId(i)}
              role="option"
              aria-selected={i === active}
              className={`ac-pop__row${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(rel)
              }}
            >
              <span className="ac-pop__name ac-pop__path">{rel}</span>
              {isFolder(rel) && <span className="ac-pop__hint">folder</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
