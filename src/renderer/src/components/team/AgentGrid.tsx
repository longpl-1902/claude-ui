import type { Agent } from '../../../../shared/types'
import { Button } from '../ui/Button'
import { useAgentStatusInfo, useConsoleStore } from '../../store/useConsoleStore'
import { AgentCard } from './AgentCard'
import './teamCenter.css'

function CardCell({ agent, live, selected, onSelect }: { agent: Agent; live: boolean; selected: boolean; onSelect(id: string): void }): JSX.Element {
  const info = useAgentStatusInfo(agent.id)
  const depth = live ? Math.min(agent.depth ?? 0, 3) : 0
  return (
    <div className={depth ? 'ac-card-cell ac-card-cell--child' : 'ac-card-cell'} title={info.reason} style={depth ? { marginLeft: 12 * depth } : undefined}>
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
          {agents.map((a) => (
            <CardCell key={a.id} agent={a} live={live} selected={a.id === selectedAgentId} onSelect={selectAgent} />
          ))}
        </div>
      )}
    </section>
  )
}
