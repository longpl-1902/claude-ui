import { useEffect, useMemo, useRef, useState } from 'react'
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
import { HooksDialog, hooksLabel } from './HooksDialog'
import './teamLeft.css'
import '../inspector/inspector.css'

/** Below this width the secondary header items move into the "..." menu (plan: Responsive). */
export const HEADER_OVERFLOW_MAX = 1299

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

  // --- overflow menu
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!narrow) setMenuOpen(false)
  }, [narrow])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const actionButtons = (inMenu: boolean) => {
    const role = inMenu ? ({ role: 'menuitem' } as const) : {}
    const after = (fn: () => void) => () => {
      fn()
      setMenuOpen(false)
    }
    return (
      <>
        <Button variant="secondary" disabled={pauseDisabled} title={pauseTitle} onClick={after(onPauseAll)} {...role}>
          {pauseLabel}
        </Button>
        <Button
          variant="primary"
          disabled={newDisabled}
          title={
            newDisabled ? 'No project folder to start a session in' : 'Opens the start form; nothing is sent until you press Send'
          }
          onClick={after(onNew)}
          {...role}
        >
          {newLabel}
        </Button>
        <Button
          variant="secondary"
          disabled={demo}
          title={demo ? 'Not available in demo' : 'Install or remove the Agent Console hooks for this project'}
          onClick={after(() => setHooksOpen(true))}
          {...role}
        >
          {hooksText}
        </Button>
      </>
    )
  }

  return (
    <header
      className="ac-header"
      style={{ borderTop: `3px solid ${edge && account ? account.color : 'var(--ac-border)'}` }}
    >
      <div className="ac-header__brand">
        <TerminalIcon size={22} color="var(--ac-accent)" />
        <span className="ac-header__title">Agent Console</span>
      </div>
      <div className="ac-header__repo" title={`${team.repo} / team: ${team.teamName}`}>
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
        <span className="ac-header__badge ac-header__badge--demo" title="Showing demo data">
          DEMO <span className="ac-header__badge-note">demo data</span>
        </span>
      )}
      {live && <span className="ac-header__badge ac-header__badge--live">LIVE</span>}
      {!demo && projectName && (
        <span className="ac-header__project" title={projectRoot || projectName}>
          {projectName}
        </span>
      )}
      <select className="ac-header__picker" aria-label="Session" value={selectedValue} onChange={(e) => onPick(e.target.value)}>
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
        <Button size="sm" onClick={exitDemo}>
          Back to live
        </Button>
      )}
      {team.historyTruncated && <span className="ac-header__note">older history not loaded</span>}
      <button
        type="button"
        className="ac-header__chip"
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
      <NeedsYouButton />
      <div className="ac-header__counters">
        {!narrow && (
          <>
            <span>
              <strong>{counters.agents}</strong> agents
            </span>
            <span className="is-running">
              <strong>{counters.running}</strong> running
            </span>
          </>
        )}
        <span className="is-needs" title="Agents in this session that need you">
          <strong>{counters.needsYou}</strong> needs you{narrow ? '' : ' in this session'}
        </span>
        {!narrow && (
          <span>
            Tokens <strong>{formatTokens(counters.tokens)}</strong>
          </span>
        )}
        {!narrow && (
          <span title={tokensTodayTitle}>
            Tokens today <strong>{formatTokens(tokensTodayAll)}</strong>
          </span>
        )}
      </div>
      {narrow ? (
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
            }}
          >
            …
          </Button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Header actions"
              className="ac-header__menu"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenuOpen(false)
              }}
            >
              <div className="ac-header__menu-info" role="presentation">
                <strong>{counters.agents}</strong> agents · <strong>{counters.running}</strong> running · Tokens{' '}
                <strong>{formatTokens(counters.tokens)}</strong> · Tokens today{' '}
                <strong>{formatTokens(tokensTodayAll)}</strong>
              </div>
              {actionButtons(true)}
            </div>
          )}
        </div>
      ) : (
        <div className="ac-header__actions">{actionButtons(false)}</div>
      )}
      <HooksDialog open={hooksOpen} onClose={() => setHooksOpen(false)} />
    </header>
  )
}
