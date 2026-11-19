import type { Agent, AgentStatus } from '../../../../shared/types'
import { formatElapsed, formatTokens } from '../../../../shared/format'
import { STATUS_META, toolColor } from '../../theme/colors'
import { Avatar } from '../ui/Avatar'
import { StatusPill } from '../ui/StatusPill'
import './teamCenter.css'

export function AgentCard({
  agent,
  status,
  selected,
  onSelect
}: {
  agent: Agent
  status: AgentStatus
  selected: boolean
  onSelect(id: string): void
}): JSX.Element {
  return (
    <button type="button" className="ac-card" aria-pressed={selected}
      aria-label={`${agent.name}, ${STATUS_META[status].label}`}
      onClick={() => onSelect(agent.id)}>
      <span className="ac-card__row">
        <Avatar initials={agent.initials} color={agent.avatarColor} />
        <span className="ac-card__id">
          <span className="ac-card__name">{agent.name}</span>
          <span className="ac-card__role">{agent.role}</span>
        </span>
        <StatusPill status={status} />
      </span>
      <span className="ac-card__tool">
        <span style={{ color: toolColor(agent.current.tool) }}>{agent.current.tool}</span> {agent.current.target}
      </span>
      <span className="ac-card__meta">
        <span className="ac-card__wt">⎇ {agent.worktree}</span>
        <span>{formatElapsed(agent.elapsedSec)}</span>
        <span>{formatTokens(agent.tokens)} tok</span>
        <span>{agent.toolCalls} calls</span>
      </span>
    </button>
  )
}
