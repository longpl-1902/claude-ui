import { Button } from '../ui/Button'
import { BranchIcon } from '../ui/Icons'
import { useConsoleStore } from '../../store/useConsoleStore'
import './teamLeft.css'

export function WorktreeList() {
  const team = useConsoleStore((s) => s.team)
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  const nameOf = (id: string) => team.agents.find((a) => a.id === id)?.name ?? id

  if (!demo) {
    return (
      <section className="ac-left-section">
        <h2 className="ac-left-title">Worktrees</h2>
        <p className="ac-left-placeholder">Worktrees arrive in Phase 5</p>
      </section>
    )
  }

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
