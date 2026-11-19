import { shortenPath } from '@shared/displayPath'
import type { Agent, Worktree } from '@shared/types'
import { rendererPlatform, selectWorktreeViews, useWorkspaceStore } from '../../store/useWorkspaceStore'
import { useConsoleStore } from '../../store/useConsoleStore'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { ErrorBanner } from '../ui/ErrorBanner'
import { BranchIcon } from '../ui/Icons'
import { isKnownReason, reasonText } from '../ui/reasonText'
import './teamLeft.css'

const errText = (e: string): string => (isKnownReason(e) ? reasonText(e) : e)
const shortErr = (e: string): string => {
  const t = errText(e)
  return t.length > 80 ? `${t.slice(0, 79)}…` : t
}

function LiveWorktrees(): JSX.Element {
  const agents = useConsoleStore((s) => s.team.agents)
  const selectAgent = useConsoleStore((s) => s.selectAgent)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const watchedRoot = useWorkspaceStore((s) => s.watchedRoot)
  const platform = rendererPlatform()

  let body: JSX.Element
  if (!watchedRoot || (workspace && workspace.root === null)) {
    body = <p className="ac-left-placeholder">Pick a git project to see worktrees</p>
  } else if (!workspace) {
    body = <p className="ac-left-placeholder">Loading worktrees…</p>
  } else if (workspace.error && workspace.worktrees.length === 0) {
    body = <ErrorBanner message={errText(workspace.error)} />
  } else {
    const { worktrees } = selectWorktreeViews(workspace, agents, platform)
    const ordered = [...worktrees.filter((w) => w.isMain), ...worktrees.filter((w) => !w.isMain)]
    const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]))
    body = (
      <>
        {ordered.map((w: Worktree) => {
          const p = shortenPath(w.path, { ...(workspace.root ? { root: workspace.root } : {}), platform })
          const overlaps = w.overlapsWith ?? []
          return (
            <div key={w.path} className={`ac-wt${overlaps.length ? ' ac-wt--warn' : ''}`}>
              <div className="ac-wt__top">
                <BranchIcon size={14} color="var(--ac-text-muted)" />
                <span className="ac-wt__branch" title={w.branch}>
                  {w.branch}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ac-wt__open"
                  aria-label={`Open ${w.branch} in editor`}
                  onClick={() => void window.api?.worktree?.openInEditor(w.path)}
                >
                  Open
                </Button>
              </div>
              <div className="ac-wt__path" title={p.full}>
                {p.short}
              </div>
              {w.agentIds.length > 0 && (
                <div className="ac-wt__avatars">
                  {w.agentIds.map((id) => {
                    const a = byId.get(id)
                    if (!a) return null
                    return (
                      <button
                        key={id}
                        type="button"
                        className="ac-wt__avatar"
                        aria-label={`Select ${a.name}`}
                        title={a.name}
                        onClick={() => selectAgent(id)}
                      >
                        <Avatar initials={a.initials} color={a.avatarColor} size={20} shape="circle" />
                        <span className="ac-wt__agent-name">{a.name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="ac-wt__meta">
                <span>{`${w.changedFiles} changed`}</span>
                {(w.ahead > 0 || (w.behind ?? 0) > 0) && (
                  <span className="ac-wt__ab">{`+${w.ahead} / -${w.behind ?? 0}`}</span>
                )}
                {overlaps.length > 0 && <span className="ac-wt__overlap">{`overlaps ${overlaps.join(', ')}`}</span>}
              </div>
              {w.error && <ErrorBanner message={shortErr(w.error)} title={errText(w.error)} />}
            </div>
          )
        })}
        {ordered.length === 0 && <p className="ac-left-placeholder">No worktrees found</p>}
      </>
    )
  }
  return (
    <section className="ac-left-section">
      <h2 className="ac-left-title">Worktrees</h2>
      {body}
    </section>
  )
}

export function WorktreeList() {
  const team = useConsoleStore((s) => s.team)
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  const nameOf = (id: string) => team.agents.find((a) => a.id === id)?.name ?? id

  if (!demo) return <LiveWorktrees />

  return (
    <section className="ac-left-section">
      <div className="ac-left-head">
        <h2 className="ac-left-title">Worktrees</h2>
        <Button variant="icon" aria-label="Add worktree">
          +
        </Button>
      </div>
      {team.worktrees.map((w) => {
        const overlap = w.overlapsWith?.[0]
        let state: string
        let color: string
        if (overlap) {
          state = `overlaps ${overlap}`
          color = 'var(--ac-status-running)'
        } else if (w.changedFiles === 0) {
          state = 'clean'
          color = 'var(--ac-status-done)'
        } else {
          state = `${w.changedFiles} ${w.changedFiles === 1 ? 'file' : 'files'}${w.ahead > 0 ? ` · ↑${w.ahead}` : ''}`
          color = 'var(--ac-text-soft)'
        }
        return (
          <div key={w.branch} className={`ac-wt${overlap ? ' ac-wt--warn' : ''}`}>
            <div className="ac-wt__top">
              <BranchIcon size={14} color="var(--ac-text-muted)" />
              <span className="ac-wt__branch">{w.branch}</span>
            </div>
            <div className="ac-wt__path">{w.path}</div>
            <div className="ac-wt__meta">
              <span className="ac-wt__agents">{w.agentIds.map(nameOf).join(', ')}</span>
              <span className="ac-wt__dot">·</span>
              <span style={{ color }}>{state}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
