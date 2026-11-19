import type { AgentEvent, AgentStatus, TeamSnapshot } from './types'

export const RECENT_ACTIVITY_MS = 60_000
export const WAITING_SIGNALS = ['blocked', 'idle', 'waiting'] as const
export const NEEDS_YOU_SIGNALS = ['permission', 'notification'] as const

const inList = (list: readonly string[], value: string | undefined): boolean =>
  value !== undefined && list.includes(value)

export function eventsForAgent(events: AgentEvent[], agentId: string): AgentEvent[] {
  return events
    .map((e, i) => ({ e, i, t: Date.parse(e.ts) }))
    .filter((x) => x.e.agentId === agentId)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e)
}

/** A tool_start without a later tool_end of the same tool (matched FIFO by tool name). */
export function hasOpenTool(events: AgentEvent[]): boolean {
  const open = new Map<string, number>()
  for (const e of events) {
    const tool = e.tool ?? ''
    if (e.kind === 'tool_start') open.set(tool, (open.get(tool) ?? 0) + 1)
    else if (e.kind === 'tool_end') {
      const n = open.get(tool) ?? 0
      if (n > 0) open.set(tool, n - 1)
    }
  }
  for (const n of open.values()) if (n > 0) return true
  return false
}

export function deriveAgentStatus(
  events: AgentEvent[],
  agentId: string,
  now: Date | number | string,
  opts?: { recentMs?: number }
): AgentStatus {
  const own = eventsForAgent(events, agentId)
  const last = own[own.length - 1]
  if (!last) return 'waiting'
  if (last.kind === 'stop') return 'done'
  if (last.kind === 'error' || (last.kind === 'status' && inList(NEEDS_YOU_SIGNALS, last.result)))
    return 'needs-you'
  if (hasOpenTool(own)) return 'running'
  if (last.kind === 'status' && inList(WAITING_SIGNALS, last.result)) return 'waiting'
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now)
  const recentMs = opts?.recentMs ?? RECENT_ACTIVITY_MS
  return nowMs - Date.parse(last.ts) <= recentMs ? 'running' : 'waiting'
}

export function deriveAllStatuses(snapshot: TeamSnapshot): Record<string, AgentStatus> {
  const out: Record<string, AgentStatus> = {}
  for (const a of snapshot.agents) out[a.id] = deriveAgentStatus(snapshot.events, a.id, snapshot.now)
  return out
}
