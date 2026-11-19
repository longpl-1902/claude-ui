import { useMemo } from 'react'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { ChevronDownIcon, LockIcon, TerminalIcon } from '../ui/Icons'
import { formatTokens } from '@shared/format'
import { deriveProjects, selectActiveAccount, sessionProjectKey, useConsoleStore, useTeamCounters } from '../../store/useConsoleStore'
import './teamLeft.css'

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
  const account = useConsoleStore(selectActiveAccount)
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
  const setProject = useConsoleStore((s) => s.setProject)
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
  const demo = teamMode === 'demo'
  const live = !demo && team.source === 'live'

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
      <select
        className="ac-header__picker ac-header__picker--project"
        aria-label="Project"
        title={current?.root ?? projectKey ?? undefined}
        value={projectKey ?? ''}
        onChange={(e) => setProject(e.target.value)}
      >
        {projectKey === null && <option value="">{projects.length === 0 ? 'No projects' : 'Select project'}</option>}
        {projectKey !== null && !current && <option value={projectKey}>{projectKey.split('/').filter(Boolean).pop() ?? projectKey}</option>}
        {projects.map((p) => (
          <option key={p.key} value={p.key} title={p.root}>
            {p.liveCount > 0 ? `${p.name} · ${p.liveCount} live` : p.name}
          </option>
        ))}
      </select>
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
      <div className="ac-header__counters">
        <span>
          <strong>{counters.agents}</strong> agents
        </span>
        <span className="is-running">
          <strong>{counters.running}</strong> running
        </span>
        <span className="is-needs">
          <strong>{counters.needsYou}</strong> needs you
        </span>
        <span>
          Tokens <strong>{formatTokens(counters.tokens)}</strong>
        </span>
      </div>
      <div className="ac-header__actions">
        <Button
          variant="secondary"
          disabled={!demo}
          title={demo ? undefined : 'Arrives in Phase 4'}
          onClick={() => void window.api?.team.pauseAll()}
        >
          Pause all
        </Button>
        <Button variant="primary" disabled={!demo} title={demo ? undefined : 'Arrives in Phase 4'}>
          + New teammate
        </Button>
      </div>
    </header>
  )
}
