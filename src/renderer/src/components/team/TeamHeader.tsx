import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { AccountView, FolderResolution } from '@shared/types'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { NeedsYouButton } from '../rail/NeedsYouInbox'
import { useAttentionStore } from '../../store/useAttentionStore'
import { ChevronDownIcon, LockIcon, TerminalIcon } from '../ui/Icons'
import { formatTokens } from '@shared/format'
import { tokenHeadline } from '@shared/teamDefaults'
import {
  deriveProjects,
  selectActiveAccount,
  sessionProjectKey,
  useConsoleStore,
  useTeamCounters
} from '../../store/useConsoleStore'
import type { ConsoleState } from '../../store/useConsoleStore'
import { useControlStore } from '../../store/useControlStore'
import { useMaxWidth } from '../../store/useLayoutStore'
import { useWorkspaceStore } from '../../store/useWorkspaceStore'
import { useOverflowItems } from '../../hooks/useOverflowItems'
import { HooksDialog, hooksLabel } from './HooksDialog'
import './teamLeft.css'
import '../inspector/inspector.css'

/** Below this width the secondary header items move into the "..." menu (plan: Responsive). */
export const HEADER_OVERFLOW_MAX = 1299

/** Items leave the header in this order when it is too narrow (T35); the note first shrinks to an icon. */
export const OVERFLOW_ORDER = ['note', 'tokens', 'tokensToday', 'counters', 'hooks', 'extensions', 'pause', 'new'] as const
const NOTE_ICON_WIDTH = 16

/**
 * UX M4: the account of the VIEWED session. A live session carries its own accountId ('' = the default config dir);
 * demo keeps the active/default account.
 */
export function selectViewedAccount(s: ConsoleState): AccountView | undefined {
  const t = s.team
  if (s.teamMode === 'demo' || t.source !== 'live') return selectActiveAccount(s)
  const list = s.accounts.accounts
  if (t.accountId === '') {
    return list.find((a) => a.isDefaultDir) ?? list.find((a) => a.id === s.accounts.defaultAccountId)
  }
  return list.find((a) => a.id === t.accountId)
}

const neutral = (id: string, name: string): AccountView => ({
  id,
  name,
  color: 'var(--ac-text-muted)',
  configDir: '',
  folderRules: [],
  signedIn: false
})

/** The viewed session's account; a live session whose account is not in the list gets a neutral placeholder. */
export function useViewedAccount(): AccountView | undefined {
  const found = useConsoleStore(selectViewedAccount)
  const live = useConsoleStore((s) => s.teamMode !== 'demo' && s.team.source === 'live')
  const id = useConsoleStore((s) => s.team.accountId)
  return useMemo(() => {
    if (found || !live) return found
    return id === '' ? neutral('', 'Default account') : neutral(id, 'Unknown account')
  }, [found, live, id])
}

const norm = (p: string): string => p.split('\\').join('/').replace(/\/+$/, '').toLowerCase()
const inside = (p: string, root: string): boolean => {
  const a = norm(p)
  const b = norm(root)
  return b !== '' && (a === b || a.startsWith(b + '/'))
}

function relTime(mtimeMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.round((nowMs - mtimeMs) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export function TeamHeader() {
  const team = useConsoleStore((s) => s.team)
  const account = useViewedAccount()
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const edge = useConsoleStore((s) => s.accounts.safety.showAccountColorEdge)
  const navigate = useConsoleStore((s) => s.navigate)
  const counters = useTeamCounters()
  const teamMode = useConsoleStore((s) => s.teamMode)
  const sessions = useConsoleStore((s) => s.sessions)
  const selection = useConsoleStore((s) => s.selection)
  const selectSession = useConsoleStore((s) => s.selectSession)
  const exitDemo = useConsoleStore((s) => s.exitDemo)
  const nowMs = useConsoleStore((s) => s.nowMs)
  const projectKey = useConsoleStore((s) => s.projectKey)
  const usageToday = useConsoleStore((s) => s.usageToday)
  const hubProjects = useAttentionStore((s) => s.snapshot.projects)
  const controlSessions = useControlStore((s) => s.sessions)
  const interrupt = useControlStore((s) => s.interrupt)
  const openStartForm = useControlStore((s) => s.openStartForm)
  const hooks = useWorkspaceStore((s) => s.hooks)
  const projects = useMemo(() => deriveProjects(sessions), [sessions])
  const current = projects.find((p) => p.key === projectKey)
  const projectSessions = useMemo(() => sessions.filter((x) => sessionProjectKey(x) === projectKey), [sessions, projectKey])
  const selectedValue = selection.mode === 'session' ? `${selection.accountId}|${selection.sessionId}` : 'auto'
  const onPick = (value: string): void => {
    if (value === 'auto') {
      void selectSession(projectKey === null ? { mode: 'auto' } : { mode: 'auto', projectKey })
      return
    }
    const i = value.indexOf('|')
    void selectSession({ mode: 'session', accountId: value.slice(0, i), sessionId: value.slice(i + 1) })
  }
  const tokensTodayAll = useMemo(
    () => Object.values(usageToday?.byAccount ?? {}).reduce((n, t) => n + tokenHeadline(t), 0),
    [usageToday]
  )
  const tokensTodayTitle = useMemo(
    () =>
      hubProjects.length === 0
        ? 'All accounts, all projects'
        : `All accounts, all projects. Per project: ${hubProjects.map((p) => `${p.name} ${formatTokens(p.tokensToday)}`).join(', ')}`,
    [hubProjects]
  )
  const demo = teamMode === 'demo'
  const live = !demo && team.source === 'live'
  const narrow = useMaxWidth(HEADER_OVERFLOW_MAX)

  const projectName = current?.name ?? (projectKey ? (projectKey.split('/').filter(Boolean).pop() ?? projectKey) : '')
  const projectRoot = current?.root ?? team.cwd

  // --- S5: scoped "Pause all in <project>"
  const projectSessionIds = useMemo(() => new Set(projectSessions.map((x) => x.sessionId)), [projectSessions])
  const busyHere = controlSessions.filter(
    (c) =>
      c.state === 'busy' &&
      ((c.sessionId !== undefined && projectSessionIds.has(c.sessionId)) || (!!current?.root && inside(c.cwd, current.root)))
  )
  const pauseLabel = demo ? 'Pause all' : `Pause all in ${projectName || 'project'}`
  const pauseDisabled = demo ? false : busyHere.length === 0
  const pauseTitle = demo
    ? undefined
    : busyHere.length === 0
      ? `No controlled session is busy in ${projectName || 'this project'}`
      : `Interrupts ${busyHere.length} busy controlled session${busyHere.length === 1 ? '' : 's'} in ${projectName}`
  const onPauseAll = (): void => {
    if (demo) {
      void window.api?.team.pauseAll()
      return
    }
    for (const c of busyHere) void interrupt(c.id)
  }

  // --- S5: "+ New session in <project> as <account>" (folder-rule resolution of the project root)
  const [resolution, setResolution] = useState<FolderResolution | null>(null)
  useEffect(() => {
    setResolution(null)
    if (demo || !projectRoot) return
    const p = window.api?.accounts?.resolveFolder?.(projectRoot)
    if (!p) return
    let cancelled = false
    void p.then(
      (r) => {
        if (!cancelled) setResolution(r)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [demo, projectRoot])
  const resolvedId = resolution && resolution.accountId !== 'ask' ? resolution.accountId : undefined
  const newAccountName =
    resolvedId !== undefined
      ? (accounts.find((a) => a.id === resolvedId)?.name ?? resolvedId)
      : resolution
        ? 'choose account'
        : 'account'
  const newLabel = demo ? '+ New teammate' : `+ New session in ${projectName || 'project'} as ${newAccountName}`
  const newDisabled = !demo && !projectRoot
  const onNew = (): void => {
    if (demo) return
    openStartForm({
      ...(projectRoot ? { cwd: projectRoot } : {}),
      ...(resolvedId !== undefined ? { accountId: resolvedId } : {})
    })
  }

  // --- Hooks
  const [hooksOpen, setHooksOpen] = useState(false)
  const hooksText = `Hooks: ${hooksLabel(demo ? null : hooks)}`

  // --- overflow: measured, priority order (T35). The "needs you in this session" counter and everything in the
  // never-moved list stay put.
  const { containerRef, hidden, collapsed, compact } = useOverflowItems({
    order: OVERFLOW_ORDER,
    absent: team.historyTruncated ? [] : ['note'],
    collapse: { note: NOTE_ICON_WIDTH },
    fallbackNarrow: narrow
  })
  const hiddenCount = hidden.size
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (hiddenCount === 0) setMenuOpen(false)
  }, [hiddenCount])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])
  const menuItems = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]:not(:disabled)') ?? [])
  const focusItem = (i: number | 'first' | 'last'): void => {
    const items = menuItems()
    if (items.length === 0) return
    const idx = i === 'first' ? 0 : i === 'last' ? items.length - 1 : (i + items.length) % items.length
    items[idx]?.focus()
  }
  useEffect(() => {
    if (menuOpen) focusItem('first')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen])
  const closeMenu = (refocus: boolean): void => {
    setMenuOpen(false)
    if (refocus) menuRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
  }
  const onMenuKey = (e: KeyboardEvent): void => {
    const items = menuItems()
    const cur = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusItem(cur + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusItem(cur < 0 ? items.length - 1 : cur - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusItem('first')
    } else if (e.key === 'End') {
      e.preventDefault()
      focusItem('last')
    } else if (e.key === 'Tab') {
      setMenuOpen(false)
    }
  }
  const moreHasCount =
    (hidden.has('tokens') && counters.tokens > 0) ||
    (hidden.has('tokensToday') && tokensTodayAll > 0) ||
    (hidden.has('counters') && (counters.agents > 0 || counters.running > 0))

  const after = (fn: () => void) => () => {
    fn()
    setMenuOpen(false)
  }
  const buttons: Record<'pause' | 'new' | 'hooks' | 'extensions', (inMenu: boolean) => JSX.Element> = {
    pause: (inMenu) => (
      <Button
        variant="secondary"
        disabled={pauseDisabled}
        title={pauseTitle}
        onClick={after(onPauseAll)}
        {...(inMenu ? { role: 'menuitem' } : {})}
      >
        {pauseLabel}
      </Button>
    ),
    new: (inMenu) => (
      <Button
        variant="primary"
        disabled={newDisabled}
        title={newDisabled ? 'No project folder to start a session in' : 'Opens the start form; nothing is sent until you press Send'}
        onClick={after(onNew)}
        {...(inMenu ? { role: 'menuitem' } : {})}
      >
        {newLabel}
      </Button>
    ),
    hooks: (inMenu) => (
      <Button
        variant="secondary"
        disabled={demo}
        title={demo ? 'Not available in demo' : 'Install or remove the Agent Console hooks for this project'}
        onClick={after(() => setHooksOpen(true))}
        {...(inMenu ? { role: 'menuitem' } : {})}
      >
        {hooksText}
      </Button>
    ),
    extensions: (inMenu) => (
      <Button
        variant="secondary"
        title="MCP servers, plugins, skills, agents and commands (Ctrl+Shift+E)"
        onClick={after(() => navigate('extensions'))}
        {...(inMenu ? { role: 'menuitem' } : {})}
      >
        Extensions
      </Button>
    )
  }
  // Left to right in the header and top to bottom in the menu.
  const ACTION_IDS = ['pause', 'new', 'hooks', 'extensions'] as const

  return (
    <header
      ref={containerRef}
      className={`ac-header${compact ? ' is-compact' : ''}`}
      style={{ borderTop: `3px solid ${edge && account ? account.color : 'var(--ac-border)'}` }}
    >
      <div className="ac-header__brand" data-fixed data-brand>
        <TerminalIcon size={22} color="var(--ac-accent)" />
        <span className="ac-header__title">Agent Console</span>
      </div>
      <div className="ac-header__repo" data-fixed data-min="120" title={`${team.repo} / team: ${team.teamName}`}>
        {/* In live mode the Project picker already names the repo; show only the session title. */}
        {demo && (
          <>
            <span>{team.repo}</span>
            <span className="ac-header__sep" aria-hidden="true">/</span>
          </>
        )}
        <span className="ac-header__team">team: {team.teamName}</span>
      </div>
      {demo && (
        <span className="ac-header__badge ac-header__badge--demo" data-fixed title="Showing demo data">
          DEMO <span className="ac-header__badge-note">demo data</span>
        </span>
      )}
      {live && <span className="ac-header__badge ac-header__badge--live" data-fixed>LIVE</span>}
      {!demo && projectName && (
        <span className="ac-header__project" data-fixed data-min="60" title={projectRoot || projectName}>
          {projectName}
        </span>
      )}
      <select className="ac-header__picker" data-fixed data-min="160" aria-label="Session" value={selectedValue} onChange={(e) => onPick(e.target.value)}>
        <option value="auto">Auto (latest)</option>
        {projectSessions.map((x) => {
          const v = `${x.accountId}|${x.sessionId}`
          const label = `${[x.title ?? x.sessionId.slice(0, 8), relTime(x.mtimeMs, nowMs)].join(' · ')}${x.live ? ' · live' : ''}`
          return (
            <option key={v} value={v}>
              {label}
            </option>
          )
        })}
      </select>
      {demo && (
        <span className="ac-header__fixed" data-fixed>
          <Button size="sm" onClick={exitDemo}>
            Back to live
          </Button>
        </span>
      )}
      {team.historyTruncated &&
        (collapsed.has('note') ? (
          <span
            className="ac-header__note ac-header__note--icon"
            data-oi="note"
            role="img"
            aria-label="Older history not loaded"
            title="older history not loaded"
          >
            ⓘ
          </span>
        ) : (
          <span className="ac-header__note" data-oi="note">
            older history not loaded
          </span>
        ))}
      <button
        type="button"
        className="ac-header__chip"
        data-fixed
        data-min="120"
        aria-label={`Account: ${account ? (account.email ? `${account.name} (${account.email})` : account.name) : 'none'}. Manage accounts`}
        title={account ? (account.email ? `${account.name} · ${account.email}` : account.name) : 'No account'}
        onClick={() => navigate('accounts')}
      >
        <Avatar
          initials={account ? account.name.charAt(0).toUpperCase() : '?'}
          color={account ? account.color : 'var(--ac-text-muted)'}
          size={20}
          shape="circle"
        />
        <span className="ac-header__name">{account ? account.name : 'No account'}</span>
        {account?.email && <span className="ac-header__email">{account.email}</span>}
        {account?.locked && (
          <span title="Account locked while a session runs" className="ac-header__lock">
            <LockIcon size={12} color="var(--ac-text-muted)" />
          </span>
        )}
        <ChevronDownIcon size={12} color="var(--ac-text-muted)" />
      </button>
      <div className="ac-header__spacer" />
      <span className="ac-header__fixed" data-fixed>
        <NeedsYouButton />
      </span>
      <div className="ac-header__counters">
        {!hidden.has('counters') && (
          <span className="ac-header__pair" data-oi="counters">
            <span>
              <strong>{counters.agents}</strong> agents
            </span>
            <span className="is-running">
              <strong>{counters.running}</strong> running
            </span>
          </span>
        )}
        <span className="is-needs" data-fixed title="Agents in this session that need you">
          <strong>{counters.needsYou}</strong> needs you{hidden.has('counters') ? '' : ' in this session'}
        </span>
        {!hidden.has('tokens') && (
          <span data-oi="tokens">
            Tokens <strong>{formatTokens(counters.tokens)}</strong>
          </span>
        )}
        {!hidden.has('tokensToday') && (
          <span data-oi="tokensToday" title={tokensTodayTitle}>
            Tokens today <strong>{formatTokens(tokensTodayAll)}</strong>
          </span>
        )}
      </div>
      {ACTION_IDS.filter((id) => !hidden.has(id)).map((id) => (
        <span key={id} className="ac-header__oi" data-oi={id}>
          {buttons[id](false)}
        </span>
      ))}
      {hiddenCount > 0 && (
        <div className="ac-header__more" ref={menuRef}>
          <Button
            variant="secondary"
            aria-label="More header actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More"
            onClick={() => setMenuOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMenuOpen(false)
              else if (e.key === 'ArrowDown' && !menuOpen) {
                e.preventDefault()
                setMenuOpen(true)
              }
            }}
          >
            {'…'}
            {moreHasCount && <span className="ac-header__more-dot" aria-hidden="true" />}
          </Button>
          {menuOpen && (
            <div role="menu" aria-label="Header actions" className="ac-header__menu" onKeyDown={onMenuKey}>
              {hidden.has('counters') && (
                <div className="ac-header__menu-info" role="presentation">
                  <strong>{counters.agents}</strong> agents · <strong>{counters.running}</strong> running
                </div>
              )}
              {hidden.has('tokens') && (
                <div className="ac-header__menu-info" role="presentation">
                  Tokens <strong>{formatTokens(counters.tokens)}</strong>
                </div>
              )}
              {hidden.has('tokensToday') && (
                <div className="ac-header__menu-info" role="presentation" title={tokensTodayTitle}>
                  Tokens today <strong>{formatTokens(tokensTodayAll)}</strong>
                </div>
              )}
              {ACTION_IDS.filter((id) => hidden.has(id)).map((id) => (
                <span key={id} className="ac-header__menu-item" role="presentation">
                  {buttons[id](true)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <HooksDialog open={hooksOpen} onClose={() => setHooksOpen(false)} />
    </header>
  )
}
