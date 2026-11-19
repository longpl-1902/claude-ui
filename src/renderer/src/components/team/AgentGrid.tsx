import { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, AgentStatus } from '../../../../shared/types'
import { formatTokens } from '../../../../shared/format'
import { Button } from '../ui/Button'
import { useAgentStatuses, useAgentStatusInfo, useConsoleStore, useScrollMemory } from '../../store/useConsoleStore'
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

export type GridDensity = 'comfortable' | 'compact'
export const DENSITY_KEY = 'ac.gridDensity'
const NARROW_QUERY = '(max-width: 899px)'

function readDensity(): GridDensity {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

/** True while the window is narrower than 900 px; the grid then always uses one-row cards. */
function useNarrow(): boolean {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(NARROW_QUERY) : undefined
  const [narrow, setNarrow] = useState(mq?.matches ?? false)
  useEffect(() => {
    const m = window.matchMedia?.(NARROW_QUERY)
    if (!m) return
    const on = (): void => setNarrow(m.matches)
    on()
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return narrow
}

function CardCell({ agent, live, selected, compact, onSelect }: { agent: Agent; live: boolean; selected: boolean; compact: boolean; onSelect(id: string): void }): JSX.Element {
  const info = useAgentStatusInfo(agent.id)
  // Cards are ordered by status, so indentation would no longer line up under the parent; keep only the side border.
  const child = live && (agent.depth ?? 0) > 0
  return (
    <div className={child ? 'ac-card-cell ac-card-cell--child' : 'ac-card-cell'} title={info.reason}>
      <AgentCard agent={agent} status={info.status} selected={selected} compact={compact} onSelect={onSelect} />
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
  const sectionRef = useRef<HTMLElement>(null)
  useScrollMemory('grid', sectionRef)
  const statuses = useAgentStatuses()
  const ordered = useMemo(() => sortAgentsByStatus(agents, statuses), [agents, statuses])
  const [density, setDensityState] = useState<GridDensity>(readDensity)
  const [showDone, setShowDone] = useState(false)
  const narrow = useNarrow()
  const compact = narrow || density === 'compact'
  const setDensity = (d: GridDensity): void => {
    setDensityState(d)
    try {
      window.localStorage.setItem(DENSITY_KEY, d)
    } catch {
      /* storage unavailable: keep the choice for this session only */
    }
  }

  // Finished sub-agents collapse into one summary row; the lead and anything still active stay as cards.
  const isFinishedChild = (a: Agent): boolean => (a.depth ?? 0) > 0 && (statuses[a.id] ?? 'waiting') === 'done'
  const finished = ordered.filter(isFinishedChild)
  const collapse = finished.length > 0 && !showDone
  const visible = collapse ? ordered.filter((a) => !isFinishedChild(a)) : ordered
  const doneTokens = finished.reduce((sum, a) => sum + a.tokens, 0)

  return (
    <section className="ac-tc-grid-section" ref={sectionRef}>
      <div className="ac-tc-head">
        <h1>Team</h1>
        <span className="ac-tc-hint">Click an agent to inspect what it is doing</span>
        {!narrow && agents.length > 0 && (
          <div className="ac-tc-density" role="radiogroup" aria-label="Card density">
            <button type="button" role="radio" aria-checked={density === 'comfortable'} onClick={() => setDensity('comfortable')}>Comfortable</button>
            <button type="button" role="radio" aria-checked={density === 'compact'} onClick={() => setDensity('compact')}>Compact</button>
          </div>
        )}
      </div>
      {live && agents.length === 0 ? (
        <div className="ac-tc-empty" role="status">
          {waiting ? (
            <p>Waiting for the session to start… Claude writes its transcript after the first prompt.</p>
          ) : (
            <>
              <p className="ac-tc-empty__title">No agents yet - start a session or pick one above</p>
              <p>Start <code>claude</code> from the Raw terminal, or open a project in VS Code with Claude Code.</p>
              <Button variant="secondary" onClick={showDemo}>Show demo data</Button>
            </>
          )}
        </div>
      ) : (
        <div className={compact ? 'ac-tc-grid ac-tc-grid--compact' : 'ac-tc-grid'}>
          {visible.map((a) => (
            <CardCell key={a.id} agent={a} live={live} selected={a.id === selectedAgentId} compact={compact} onSelect={selectAgent} />
          ))}
          {finished.length > 0 && (
            <button type="button" className="ac-tc-done-row" aria-expanded={!collapse} onClick={() => setShowDone((v) => !v)}>
              <span>{finished.length} done · {formatTokens(doneTokens)} tok</span>
              <span className="ac-tc-done-row__show">{collapse ? 'Show' : 'Hide'}</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}
