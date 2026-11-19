import type { Agent, TeamSnapshot } from './types'
import { deriveAllStatuses } from './status'

export function formatTokens(n: number): string {
  if (n >= 1e6) {
    const v = Math.floor(n / 1e4) / 100
    return `${v.toFixed(2).replace(/\.?0+$/, '')}M`
  }
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatElapsed(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${pad2(m)}m`
  return `${m}m ${pad2(s)}s`
}

export function sumTokens(agents: Agent[]): number {
  return agents.reduce((sum, a) => sum + a.tokens, 0)
}

export function teamCounters(snapshot: TeamSnapshot): {
  agents: number
  running: number
  needsYou: number
  tokens: number
} {
  const statuses = Object.values(deriveAllStatuses(snapshot))
  return {
    agents: snapshot.agents.length,
    running: statuses.filter((s) => s === 'running').length,
    needsYou: statuses.filter((s) => s === 'needs-you').length,
    tokens: sumTokens(snapshot.agents)
  }
}
