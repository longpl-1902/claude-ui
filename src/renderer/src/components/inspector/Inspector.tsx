import type { KeyboardEvent } from 'react'
import { formatElapsed, formatTokens } from '@shared/format'
import {
  selectSelectedAgent,
  useAgentStatuses,
  useConsoleStore,
  type InspectorTab
} from '../../store/useConsoleStore'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { StatusPill } from '../ui/StatusPill'
import { ActivityTab } from './ActivityTab'
import { FilesTab } from './FilesTab'
import { MessagesTab } from './MessagesTab'
import './inspector.css'

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
  { id: 'messages', label: 'Messages' }
]
const tabId = (t: InspectorTab): string => `insp-tab-${t}`
const PANEL_ID = 'insp-panel'

export function Inspector(): JSX.Element {
  const agent = useConsoleStore(selectSelectedAgent)
  const statuses = useAgentStatuses()
  const tab = useConsoleStore((s) => s.inspectorTab)
  const setInspectorTab = useConsoleStore((s) => s.setInspectorTab)
  const setConsoleDraft = useConsoleStore((s) => s.setConsoleDraft)
  const status = statuses[agent.id] ?? 'waiting'

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!
    setInspectorTab(next.id)
    document.getElementById(tabId(next.id))?.focus()
  }

  const messageAgent = (): void => {
    setConsoleDraft(`@${agent.name} `)
    document.getElementById('ac-prompt')?.focus()
  }

  const stats = [
    ['Elapsed', formatElapsed(agent.elapsedSec)],
    ['Tokens', formatTokens(agent.tokens)],
    ['Tool calls', String(agent.toolCalls)]
  ]

  return (
    <aside className="insp" aria-label="Agent inspector">
      <div className="insp__head">
        <Avatar initials={agent.initials} color={agent.avatarColor} size={40} />
        <div className="insp__who">
          <span className="insp__name">{agent.name}</span>
          <span className="insp__sub">
            {agent.role} · {agent.model}
          </span>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="insp__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="insp__stat">
            <div className="insp__stat-label">{label}</div>
            <div className="insp__stat-value">{value}</div>
          </div>
        ))}
      </div>

      <div className="insp__task">
        <span className="insp__task-label">Assigned task</span>
        <span className="insp__task-title">{agent.taskTitle}</span>
        <span className="insp__task-wt">⎇ {agent.worktree}</span>
      </div>

      <div role="tablist" aria-label="Agent details" className="insp__tabs" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={tab === t.id}
            aria-controls={PANEL_ID}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'insp__tab insp__tab--on' : 'insp__tab'}
            onClick={() => setInspectorTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)}>
        {tab === 'activity' && <ActivityTab items={agent.activity} />}
        {tab === 'files' && <FilesTab files={agent.files} />}
        {tab === 'messages' && <MessagesTab messages={agent.messages} />}
      </div>

      <div className="insp__spacer" />
      <div className="insp__actions">
        <Button size="lg" onClick={messageAgent}>
          Message agent
        </Button>
        <Button size="lg" onClick={() => void window.api?.worktree.openInEditor(agent.worktree)}>
          Open worktree
        </Button>
        <Button size="lg" onClick={() => void window.api?.agent.pause(agent.id)}>
          Pause
        </Button>
        <Button size="lg" variant="danger" onClick={() => void window.api?.agent.stop(agent.id)}>
          Stop
        </Button>
      </div>
    </aside>
  )
}
