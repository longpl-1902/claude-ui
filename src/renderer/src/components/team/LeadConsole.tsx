import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { routeConsoleInput } from '@shared/agentMessage'
import { shortenPathsInText } from '@shared/displayPath'
import type { ConsoleLine } from '@shared/types'
import { useConsoleStore, useScrollMemory } from '../../store/useConsoleStore'
import { selectControlForSession, selectDraftControl, useControlStore } from '../../store/useControlStore'
import { Button } from '../ui/Button'
import { ASK_LEAD_TEXT, ControlBar } from './ControlBar'
import type { StartOption } from './ControlBar'
import { PermissionCard } from './PermissionCard'
import { RawTerminalPane } from './RawTerminalPane'
import './teamCenter.css'

const COMMANDS = ['/pause', '/stop', '/status']

export type ConsoleFilter = 'messages' | 'tools' | 'errors' | 'all'
export type LineKind = 'message' | 'tool' | 'error'

const FILTERS: [ConsoleFilter, string][] = [
  ['messages', 'Messages & asks'],
  ['tools', 'Tools'],
  ['errors', 'Errors'],
  ['all', 'All']
]

const TOOL_NAMES = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell', 'Glob', 'Grep', 'Task',
  'Agent', 'WebFetch', 'WebSearch', 'TodoWrite', 'SendMessage', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'ExitPlanMode', 'Skill', 'ToolSearch', 'LS'
])

/** Console lines carry no kind, so classify from the text the transcript model produces. */
export function classifyLine(l: ConsoleLine): LineKind {
  if (l.who === 'you') return 'message'
  if (l.text.startsWith('API error') || l.text.startsWith('✗')) return 'error'
  if (l.text.startsWith('spawned ')) return 'tool'
  const first = l.text.split(' ', 1)[0] ?? ''
  if (first.startsWith('mcp__') || TOOL_NAMES.has(first)) return 'tool'
  return 'message'
}

const shows = (f: ConsoleFilter, k: LineKind): boolean =>
  f === 'all' || (f === 'messages' ? k !== 'tool' : f === 'tools' ? k === 'tool' : k === 'error')

const platform = (): string => (typeof navigator !== 'undefined' && /win/i.test(navigator.platform) ? 'win32' : 'posix')

const SEND_ERRORS: Record<string, string> = {
  'unknown-agent': 'No teammate with that name in this team.',
  'too-long': 'That message is too long (max 32000 characters).'
}

export interface LeadConsoleProps {
  /** Filter chip state; controlled when `filter` is given (T18 persists it per project). */
  filter?: ConsoleFilter
  defaultFilter?: ConsoleFilter
  onFilterChange?(f: ConsoleFilter): void
}

export function LeadConsole({ filter, defaultFilter = 'messages', onFilterChange }: LeadConsoleProps = {}): JSX.Element {
  const team = useConsoleStore((s) => s.team)
  const rawOpen = useConsoleStore((s) => s.rawTerminalOpen)
  const toggleRaw = useConsoleStore((s) => s.toggleRawTerminal)
  const draft = useConsoleStore((s) => s.consoleDraft)
  const setDraft = useConsoleStore((s) => s.setConsoleDraft)
  const submit = useConsoleStore((s) => s.submitConsole)
  const demo = useConsoleStore((s) => s.teamMode === 'demo')
  const summary = useConsoleStore((s) => s.sessions.find((x) => x.sessionId === team.sessionId))

  const bound = useControlStore(selectControlForSession(team.sessionId))
  const draftControl = useControlStore(selectDraftControl)
  const control = demo ? undefined : (bound ?? draftControl)
  const stream = useControlStore((s) => (control ? s.streams[control.id] : undefined))
  const send = useControlStore((s) => s.send)
  const answer = useControlStore((s) => s.answer)
  const openForm = useControlStore((s) => s.openStartForm)

  const controlled = control !== undefined && control.state !== 'exited'
  const external = !demo && !controlled && control === undefined && team.source === 'live' && !!team.sessionId
  const isDraft = controlled && control.state === 'draft' && !control.sessionId
  const projectRoot = summary?.project?.root ?? team.cwd
  const projectName = summary?.project?.name ?? team.repo ?? 'lead'

  // Without a controlled `filter` the chip is remembered per project in the console store (T18, UX M5).
  const storedFilter = useConsoleStore((s) => s.consoleFilter)
  const setStoredFilter = useConsoleStore((s) => s.setConsoleFilter)
  const stored = FILTERS.find(([f]) => f === storedFilter)?.[0]
  const activeFilter = filter ?? stored ?? defaultFilter
  const setFilter = (f: ConsoleFilter): void => {
    if (filter === undefined) setStoredFilter(f)
    onFilterChange?.(f)
  }
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [sendError, setSendError] = useState('')
  const [preset, setPreset] = useState<{ option: StartOption; n: number }>()
  const [active, setActive] = useState(-1)
  const [slashClosed, setSlashClosed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const logRef = useRef<HTMLDivElement>(null)
  useScrollMemory('console', logRef, !rawOpen)
  const atBottom = useRef(true)
  const onScroll = (): void => {
    const el = logRef.current
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  const lineCount = team.console.length
  const tail = (stream?.typing?.text.length ?? 0) + (stream?.notices.length ?? 0)
  useEffect(() => {
    const el = logRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [lineCount, rawOpen, tail])

  const who = (id: string): { name: string; color: string } => {
    if (id === 'you') return { name: 'you', color: 'var(--ac-accent)' }
    const a = team.agents.find((x) => x.id === id)
    return { name: a?.name ?? id, color: a?.avatarColor ?? 'var(--ac-text-muted)' }
  }
  const pathOpts = { ...(projectRoot ? { root: projectRoot } : {}), platform: platform() }
  const display = (t: string): string => shortenPathsInText(t, pathOpts)

  const slashAll = useMemo(() => {
    if (!controlled) return []
    const list = isDraft || control.slashCommands.length === 0 ? COMMANDS : control.slashCommands
    return list.map((c) => (c.startsWith('/') ? c : `/${c}`))
  }, [controlled, isDraft, control?.slashCommands])
  const slashOpen = controlled && !slashClosed && /^\/\S*$/.test(draft)
  const slashItems = slashOpen ? slashAll.filter((c) => c.startsWith(draft)) : []

  const onDraft = (v: string): void => {
    setDraft(v)
    setActive(-1)
    setSlashClosed(false)
    setSendError('')
  }
  const complete = (c: string): void => {
    onDraft(c + ' ')
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!slashOpen || slashItems.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % slashItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? slashItems.length - 1 : a - 1))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      complete(slashItems[active >= 0 ? active : 0]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSlashClosed(true)
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      complete(slashItems[active]!)
    }
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (demo) {
      submit()
      return
    }
    if (!controlled) return
    const route = routeConsoleInput(draft, team.agents)
    if (route.kind === 'error') {
      setSendError(SEND_ERRORS[route.reason] ?? '')
      return
    }
    setSendError('')
    void send(control.id, route.text).then((r) => {
      if (r.ok) setDraft('')
      else setSendError(`Could not send the message (${r.reason ?? 'failed'}).`)
    })
  }

  const askLead = (): void => {
    setDraft(ASK_LEAD_TEXT)
    inputRef.current?.focus()
  }

  const startPreset = (option: StartOption): void => {
    setPreset((p) => ({ option, n: (p?.n ?? 0) + 1 }))
    const cwd = summary?.cwd ?? summary?.project?.root
    openForm({
      ...(cwd ? { cwd } : {}),
      ...(summary?.accountId ? { accountId: summary.accountId } : {})
    })
  }

  const notices = stream?.notices ?? []
  const perms = stream?.permissions ?? []
  const promptDisabled = !demo && !controlled
  const placeholder = promptDisabled
    ? ''
    : isDraft
      ? 'Type the first message to start Claude'
      : 'Message the lead, @agent to talk to a teammate, / for commands'
  const where = summary?.entrypoint?.toLowerCase().includes('vscode') ? 'VS Code' : 'a terminal'

  return (
    <section className="ac-tc-console">
      <div className="ac-tc-console__bar">
        <span className="ac-tc-dot" aria-hidden="true" />
        <h2>Lead console</h2>
        <span className="ac-tc-hint">all team events, newest last</span>
        <div className="ac-tc-spacer" />
        <Button size="sm" aria-pressed={rawOpen} onClick={toggleRaw}>
          Raw terminal
        </Button>
      </div>
      {!demo && !rawOpen && (
        <ControlBar
          {...(control ? { control } : {})}
          projectName={projectName}
          {...(projectRoot ? { projectRoot } : {})}
          {...(team.sessionId ? { sessionId: team.sessionId } : {})}
          sessionLive={!!summary?.live}
          {...(preset ? { preset } : {})}
          onAskLead={askLead}
        />
      )}
      {rawOpen ? (
        <RawTerminalPane />
      ) : (
        <>
          {!demo && (
            <div className="ac-tc-chips" role="group" aria-label="Console filter">
              {FILTERS.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  className={`ac-tc-chipbtn${activeFilter === f ? ' is-on' : ''}`}
                  aria-pressed={activeFilter === f}
                  onClick={() => setFilter(f)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="ac-tc-log" ref={logRef} onScroll={onScroll}>
            {team.console.map((l, i) => {
              if (!demo && !shows(activeFilter, classifyLine(l))) return null
              const w = who(l.who)
              const isOpen = open.has(i)
              return (
                <div key={i} className={`ac-tc-line${isOpen ? ' ac-tc-line--open' : ''}`}>
                  <span className="ac-tc-line__t">{l.time}</span>
                  <span className="ac-tc-line__who" style={{ color: w.color }}>
                    {w.name}
                  </span>
                  <button
                    type="button"
                    className="ac-tc-line__msg"
                    title={l.text}
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpen((o) => {
                        const n = new Set(o)
                        if (n.has(i)) n.delete(i)
                        else n.add(i)
                        return n
                      })
                    }
                  >
                    {display(l.text)}
                  </button>
                </div>
              )
            })}
            {notices.map((n, i) =>
              shows(activeFilter, n.level === 'error' ? 'error' : 'message') ? (
                <div key={`n${i}`} className={`ac-tc-line ac-tc-line--notice ac-tc-line--${n.level}`}>
                  <span className="ac-tc-line__t">{n.time.slice(11, 19)}</span>
                  <span className="ac-tc-line__who">app</span>
                  <span className="ac-tc-line__msg ac-tc-line__msg--plain" title={n.text}>
                    {display(n.text)}
                  </span>
                </div>
              ) : null
            )}
            {stream?.typing && (
              <div className="ac-tc-line ac-tc-line--typing" data-testid="typing-row">
                <span className="ac-tc-line__t" />
                <span className="ac-tc-line__who" style={{ color: who('lead').color }}>
                  {who('lead').name}
                </span>
                <span className="ac-tc-line__msg ac-tc-line__msg--plain">
                  {display(stream.typing.text)}
                  <span className="ac-tc-typing" aria-live="polite">
                    typing
                  </span>
                </span>
              </div>
            )}
            {!stream?.typing && stream?.thinking && (
              <div className="ac-tc-line ac-tc-line--thinking">
                <span className="ac-tc-line__t" />
                <span className="ac-tc-line__who">{who('lead').name}</span>
                <span className="ac-tc-line__msg ac-tc-line__msg--plain" aria-live="polite">
                  thinking...
                </span>
              </div>
            )}
          </div>
        </>
      )}
      {control && perms.length > 0 && (
        <div className="ac-tc-perms">
          {perms.map((p) => (
            <PermissionCard key={p.requestId} prompt={p} onAnswer={(a) => void answer(control.id, p.requestId, a)} />
          ))}
        </div>
      )}
      <form className="ac-tc-prompt" onSubmit={onSubmit}>
        <label htmlFor="ac-prompt">›</label>
        <input
          ref={inputRef}
          id="ac-prompt"
          type="text"
          aria-label="Message the lead"
          placeholder={placeholder}
          value={draft}
          disabled={promptDisabled}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          {...(slashOpen && slashItems.length > 0
            ? {
                'aria-autocomplete': 'list' as const,
                'aria-controls': 'ac-slash-list',
                ...(active >= 0 ? { 'aria-activedescendant': `ac-slash-${active}` } : {})
              }
            : {})}
        />
        <span className="ac-tc-kbd">Enter</span>
      </form>
      {sendError && (
        <p className="ac-tc-ctl__error ac-tc-prompt-hint" role="alert">
          {sendError}
        </p>
      )}
      {promptDisabled && external && (
        <div className="ac-tc-external">
          <p>
            {summary?.live
              ? `This session runs in ${where}. Agent Console cannot type into it.`
              : 'This session is not running. Agent Console cannot type into it until you resume or fork it.'}
          </p>
          <div className="ac-tc-external__actions">
            <Button size="sm" onClick={() => startPreset('fork')}>
              Fork here
            </Button>
            {!summary?.live && (
              <Button size="sm" onClick={() => startPreset('resume')}>
                Resume here
              </Button>
            )}
          </div>
        </div>
      )}
      {promptDisabled && !external && (
        <div className="ac-tc-external">
          <p>No session is running here.</p>
          <div className="ac-tc-external__actions">
            <Button size="sm" variant="primary" onClick={() => startPreset('new')}>
              Start a session
            </Button>
          </div>
        </div>
      )}
      {controlled && slashItems.length > 0 && (
        <>
          <ul className="ac-tc-slash" id="ac-slash-list" role="listbox" aria-label="Slash commands">
            {slashItems.map((c, i) => (
              <li
                key={c}
                id={`ac-slash-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  complete(c)
                }}
              >
                {c}
              </li>
            ))}
          </ul>
          {isDraft && <div className="ac-tc-hint ac-tc-prompt-hint">full list after the session starts</div>}
        </>
      )}
      {demo && draft.startsWith('/') && (
        <div className="ac-tc-cmds">
          {COMMANDS.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
    </section>
  )
}
