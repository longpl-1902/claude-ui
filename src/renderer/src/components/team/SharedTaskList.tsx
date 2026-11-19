import type { SharedTask } from '@shared/types'
import { useConsoleStore } from '../../store/useConsoleStore'
import './teamLeft.css'

const SUBTLE = 'var(--ac-text-subtle)'

export function SharedTaskList() {
  const team = useConsoleStore((s) => s.team)
  const nameOf = (id: string) => team.agents.find((a) => a.id === id)?.name ?? id

  const view = (t: SharedTask): { color: string; fill: string; meta: string; metaColor: string } => {
    const owner = nameOf(t.ownerAgentId)
    switch (t.state) {
      case 'done':
        return { color: 'var(--ac-status-done)', fill: 'var(--ac-status-done)', meta: `Done · ${owner}`, metaColor: SUBTLE }
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
