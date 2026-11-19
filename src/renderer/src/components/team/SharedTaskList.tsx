import type { SharedTask } from '@shared/types'
import { useConsoleStore } from '../../store/useConsoleStore'
import './teamLeft.css'

const SUBTLE = 'var(--ac-text-subtle)'
const ORDER: Record<SharedTask['state'], number> = { in_progress: 0, failing: 1, blocked: 2, pending: 3, done: 4 }

function pill(t: SharedTask): string {
  switch (t.state) {
    case 'done':
      return 'done'
    case 'in_progress':
      return 'in progress'
    case 'pending':
      return 'to do'
    case 'blocked':
      return `blocked by #${t.blockedBy ?? t.blockers?.[0] ?? '?'}`
    case 'failing':
      return `failing ×${t.failingCount ?? 1}`
  }
}

export function SharedTaskList() {
  const team = useConsoleStore((s) => s.team)
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  const nameOf = (id: string) => team.agents.find((a) => a.id === id)?.name ?? id

  const view = (t: SharedTask): { color: string; fill: string; meta: string; metaColor: string } => {
    const owner = nameOf(t.ownerAgentId)
    switch (t.state) {
      case 'done':
        return { color: 'var(--ac-status-done)', fill: 'var(--ac-status-done)', meta: `Done · ${owner}`, metaColor: SUBTLE }
      case 'pending':
        return { color: SUBTLE, fill: 'transparent', meta: `to do · ${owner}`, metaColor: SUBTLE }
      case 'in_progress':
        return { color: 'var(--ac-status-running)', fill: 'transparent', meta: `In progress · ${owner}`, metaColor: SUBTLE }
      case 'blocked':
        return {
          color: 'var(--ac-status-waiting)',
          fill: 'transparent',
          meta: `Blocked by #${t.blockedBy} · ${owner}`,
          metaColor: 'var(--ac-status-waiting)'
        }
      case 'failing':
        return {
          color: 'var(--ac-status-needs-you)',
          fill: 'transparent',
          meta: `${t.failingCount ?? 0} failing · ${owner}`,
          metaColor: 'var(--ac-status-needs-you)'
        }
    }
  }

  if (!demo) {
    const sorted = [...team.tasks].sort((a, b) => ORDER[a.state] - ORDER[b.state])
    return (
      <section className="ac-left-section">
        <h2 className="ac-left-title">Shared tasks</h2>
        {sorted.length === 0 ? (
          <p className="ac-left-placeholder">No tasks in this session (TaskCreate / TodoWrite)</p>
        ) : (
          <ul className="ac-tasks">
            {sorted.map((t) => (
              <li key={t.id} className="ac-task">
                <div className="ac-task__body">
                  <span className="ac-task__title">{`#${t.id} ${t.title}`}</span>
                  <span className="ac-task__meta">
                    <span className="ac-task__owner">{nameOf(t.ownerAgentId)}</span>
                    <span className={`ac-task__pill ac-task__pill--${t.state}`}>{pill(t)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section className="ac-left-section">
      <h2 className="ac-left-title">Shared tasks</h2>
      <ul className="ac-tasks">
        {team.tasks.map((t) => {
          const v = view(t)
          return (
            <li key={t.id} className="ac-task">
              <span className="ac-task__box" style={{ borderColor: v.color, background: v.fill }} />
              <div className="ac-task__body">
                <span className="ac-task__title">{`#${t.id} ${t.title}`}</span>
                <span className="ac-task__meta" style={{ color: v.metaColor }}>
                  {v.meta}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
