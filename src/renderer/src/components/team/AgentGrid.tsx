import { useMemo } from 'react'
import type { Agent, AgentStatus } from '../../../../shared/types'
import { Button } from '../ui/Button'
import { useAgentStatuses, useAgentStatusInfo, useConsoleStore } from '../../store/useConsoleStore'
import { AgentCard } from './AgentCard'
import './teamCenter.css'

/** Lower = earlier in the grid: what needs the lead first, then active work, then idle, then finished. */
export const STATUS_ORDER: Record<AgentStatus, number> = { 'needs-you': 0, running: 1, waiting: 2, done: 3 }

/** Stable sort by status rank; agents with the same status keep their original (tree) order. */
export function sortAgentsByStatus(agents: Agent[], statuses: Record<string, AgentStatus>): Agent[] {
  return agents
    .map((a, i) => ({ a, i, r: STATUS_ORDER[statuses[a.id] ?? 'waiting'] }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a)
}

function CardCell({ agent, live, selected, onSelect }: { agent: Agent; live: boolean; selected: boolean; onSelect(id: string): void }): JSX.Element {
  const info = useAgentStatusInfo(agent.id)
  // Cards are ordered by status, so indentation would no longer line up under the parent; keep only the side border.
  const child = live && (agent.depth ?? 0) > 0
  return (
    <div className={child ? 'ac-card-cell ac-card-cell--child' : 'ac-card-cell'} title={info.reason}>
      <AgentCard agent={agent} status={info.status} selected={selected} onSelect={onSelect} />
    </div>
  )
}

export function AgentGrid(): JSX.Element {
  const agents = useConsoleStore((s) => s.team.agents)
  const selectedAgentId = useConsoleStore((s) => s.selectedAgentId)
  const selectAgent = useConsoleStore((s) => s.selectAgent)
  const teamMode = useConsoleStore((s) => s.teamMode)
  const waiting = useConsoleStore((s) => s.team.waitingForSession)
  const showDemo = useConsoleStore((s) => s.showDemo)
  const live = teamMode === 'live'
  const statuses = useAgentStatuses()
  const ordered = useMemo(() => sortAgentsByStatus(agents, statuses), [agents, statuses])
  return (
    <section className="ac-tc-grid-section">
      <div className="ac-tc-head">
        <h1>Team</h1>
        <span className="ac-tc-hint">Click an agent to inspect what it is doing</span>
      </div>
      {live && agents.length === 0 ? (
        <div className="ac-tc-empty" role="status">
          {waiting ? (
            <p>Waiting for the session to start… Claude writes its transcript after the first prompt.</p>
          ) : (
            <>
              <p className="ac-tc-empty__title">No Claude Code session found</p>
              <p>Start <code>claude</code> from the Raw terminal, or open a project in VS Code with Claude Code.</p>
              <Button variant="secondary" onClick={showDemo}>Show demo data</Button>
            </>
          )}
        </div>
      ) : (
        <div className="ac-tc-grid">
          {ordered.map((a) => (
            <CardCell key={a.id} agent={a} live={live} selected={a.id === selectedAgentId} onSelect={selectAgent} />
          ))}
        </div>
      )}
    </section>
  )
}
