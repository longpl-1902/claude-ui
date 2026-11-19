import { useId } from 'react'
import type { Agent, AgentStatus } from '../../../../shared/types'
import { formatElapsed, formatTokens } from '../../../../shared/format'
import { shortenPathsInText } from '../../../../shared/displayPath'
import { STATUS_META, toolColor } from '../../theme/colors'
import { useConsoleStore } from '../../store/useConsoleStore'
import { rendererPlatform } from '../../store/useWorkspaceStore'
import { Avatar } from '../ui/Avatar'
import { StatusPill } from '../ui/StatusPill'
import './teamCenter.css'

/** Compact rows have little room: show a path target as its last two segments ("…/src/App.tsx"). */
export function shortTarget(target: string): string {
  if (!/[\\/]/.test(target) || /\s/.test(target.trim())) return target
  const parts = target.split(/[\\/]+/).filter(Boolean)
  return parts.length <= 2 ? target : `…/${parts.slice(-2).join('/')}`
}

export function AgentCard({
  agent,
  status,
  selected,
  onSelect,
  compact = false
}: {
  agent: Agent
  status: AgentStatus
  selected: boolean
  onSelect(id: string): void
  compact?: boolean
}): JSX.Element {
  const root = useConsoleStore((s) => s.team.cwd)
  const uid = useId()
  const nameId = `${uid}-name`
  const descIds = ['role', 'status', 'tool', 'meta'].map((k) => `${uid}-${k}`)
  const meta = STATUS_META[status]
  if (compact) {
    return (
      <button type="button" className="ac-card ac-card--compact" aria-pressed={selected}
        aria-labelledby={nameId} aria-describedby={descIds.join(' ')}
        title={`${agent.role} - ${agent.current.tool} ${agent.current.target}`}
        onClick={() => onSelect(agent.id)}>
        <span id={descIds[1]} className="ac-card__dot-wrap">
          <span className={meta.pulse ? 'ac-pill__dot ac-pulse' : 'ac-pill__dot'} style={{ background: meta.color }} aria-hidden="true" />
          <span className="ac-card__sr">{meta.label}</span>
        </span>
        <span id={nameId} className="ac-card__name">{agent.name}</span>
        <span id={descIds[0]} className="ac-card__role ac-card__sr">{agent.role}</span>
        <span id={descIds[2]} className="ac-card__tool ac-card__tool--inline">
          <span style={{ color: toolColor(agent.current.tool) }}>{agent.current.tool}</span> {shortTarget(agent.current.target)}
        </span>
        <span id={descIds[3]} className="ac-card__meta ac-card__meta--inline">
          <span>{formatTokens(agent.tokens)} tok</span>
          <span>{formatElapsed(agent.elapsedSec)}</span>
        </span>
      </button>
    )
  }
  return (
    <button type="button" className="ac-card" aria-pressed={selected}
      aria-labelledby={nameId} aria-describedby={descIds.join(' ')}
      onClick={() => onSelect(agent.id)}>
      <span className="ac-card__row">
        <Avatar initials={agent.initials} color={agent.avatarColor} />
        <span className="ac-card__id">
          <span id={nameId} className="ac-card__name">{agent.name}</span>
          <span id={descIds[0]} className="ac-card__role">{agent.role}</span>
        </span>
        <span id={descIds[1]} style={{ display: 'contents' }}><StatusPill status={status} /></span>
      </span>
      <span id={descIds[2]} className="ac-card__tool">
        <span style={{ color: toolColor(agent.current.tool) }}>{agent.current.tool}</span>{' '}
        <span title={agent.current.target}>{shortenPathsInText(agent.current.target, { ...(root ? { root } : {}), platform: rendererPlatform() })}</span>
      </span>
      <span id={descIds[3]} className="ac-card__meta">
        <span className="ac-card__wt">⎇ {agent.worktree}</span>
        <span>{formatElapsed(agent.elapsedSec)}</span>
        <span>{formatTokens(agent.tokens)} tok</span>
        <span>{agent.toolCalls} calls</span>
      </span>
    </button>
  )
}
