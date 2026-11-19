import { useAgentStatuses, useConsoleStore } from '../../store/useConsoleStore'
import { AgentCard } from './AgentCard'
import './teamCenter.css'

export function AgentGrid(): JSX.Element {
  const agents = useConsoleStore((s) => s.team.agents)
  const selectedAgentId = useConsoleStore((s) => s.selectedAgentId)
  const selectAgent = useConsoleStore((s) => s.selectAgent)
  const statuses = useAgentStatuses()
  return (
    <section className="ac-tc-grid-section">
      <div className="ac-tc-head">
        <h1>Team</h1>
        <span className="ac-tc-hint">Click an agent to inspect what it is doing</span>
      </div>
      <div className="ac-tc-grid">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            status={statuses[a.id] ?? 'waiting'}
            selected={a.id === selectedAgentId}
            onSelect={selectAgent}
          />
        ))}
      </div>
    </section>
  )
}
