import { Fragment } from 'react'
import type { CatalogItem, CommandSource, SlashCommandInfo } from '@shared/types'

export const SOURCE_ORDER: CommandSource[] = ['builtin', 'project', 'user', 'skill', 'plugin', 'mcp', 'unknown']
export const SOURCE_LABEL: Record<CommandSource, string> = {
  builtin: 'Built-in',
  project: 'Project',
  user: 'User',
  skill: 'Skills',
  plugin: 'Plugins',
  mcp: 'MCP',
  unknown: 'Other'
}

export interface PaletteItem extends SlashCommandInfo {
  /** Display name with the leading slash. */
  label: string
}

const bare = (n: string): string => (n.startsWith('/') ? n.slice(1) : n)

/**
 * Refine the source of a command by name against the loaded catalog (skills / commands / plugin items) when the
 * session did not say where it came from.
 */
function refine(c: SlashCommandInfo, catalog: CatalogItem[]): SlashCommandInfo {
  if (c.source !== 'unknown') return c
  const hit = catalog.find((i) => (i.kind === 'skill' || i.kind === 'command') && i.name === c.name)
  if (!hit) return c
  const source: CommandSource = hit.scope === 'plugin' ? 'plugin' : hit.kind === 'skill' ? 'skill' : hit.scope
  return {
    ...c,
    source,
    description: c.description || hit.description || '',
    ...(c.argumentHint || hit.argumentHint ? { argumentHint: c.argumentHint ?? hit.argumentHint! } : {})
  }
}

/** Filter by prefix first, then substring (name or alias), group by source in a fixed order. `query` has no slash. */
export function buildPalette(commands: SlashCommandInfo[], catalog: CatalogItem[], query: string): PaletteItem[] {
  const q = query.toLowerCase()
  const rank = (c: SlashCommandInfo): number => {
    const names = [bare(c.name), ...(c.aliases ?? []).map(bare)].map((n) => n.toLowerCase())
    if (q === '') return 0
    if (names.some((n) => n.startsWith(q))) return 0
    if (names.some((n) => n.includes(q))) return 1
    return -1
  }
  const seen = new Set<string>()
  const rows: { item: PaletteItem; rank: number; idx: number }[] = []
  commands.forEach((raw, idx) => {
    const c = refine({ ...raw, name: bare(raw.name) }, catalog)
    if (seen.has(c.name)) return
    seen.add(c.name)
    const r = rank(c)
    if (r >= 0) rows.push({ item: { ...c, label: `/${c.name}` }, rank: r, idx })
  })
  const g = (c: SlashCommandInfo): number => SOURCE_ORDER.indexOf(c.source)
  rows.sort((a, b) => g(a.item) - g(b.item) || a.rank - b.rank || a.idx - b.idx)
  return rows.map((r) => r.item)
}

export interface SlashPaletteProps {
  items: PaletteItem[]
  active: number
  /** Before the session runs, the list is the fallback one. */
  fallbackNote?: boolean
  onPick(item: PaletteItem): void
  listId?: string
}

export const slashOptionId = (i: number): string => `ac-slash-${i}`

/** Listbox of slash commands grouped by source. Picking only edits the draft (R-19). */
export function SlashPalette({ items, active, fallbackNote, onPick, listId = 'ac-slash-list' }: SlashPaletteProps): JSX.Element | null {
  if (items.length === 0) return null
  let prev: CommandSource | undefined
  return (
    <div className="ac-pop">
      <ul className="ac-pop__list" id={listId} role="listbox" aria-label="Slash commands">
        {items.map((c, i) => {
          const head = c.source !== prev
          prev = c.source
          return (
            <Fragment key={c.name}>
            {head ? (
              <li role="presentation" className="ac-pop__group">
                {SOURCE_LABEL[c.source]}
              </li>
            ) : null}
            <li
              id={slashOptionId(i)}
              role="option"
              aria-selected={i === active}
              className={`ac-pop__row${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(c)
              }}
            >
              <span className="ac-pop__name">{c.label}</span>
              {c.argumentHint && <span className="ac-pop__hint">{c.argumentHint}</span>}
              {c.description && <span className="ac-pop__desc">{c.description}</span>}
            </li>
            </Fragment>
          )
        })}
      </ul>
      {fallbackNote && <div className="ac-pop__note">full list after the session starts</div>}
    </div>
  )
}
