import type { AgentRuntime, AgentStatus } from './types'

export const LIVE_THRESHOLDS = {
  modelTurnStaleMs: 5 * 60_000, // the model's turn (last line user/tool_result) but no write for this long -> waiting 'stale'
  openToolStaleMs: 30 * 60_000, // an open tool with no write for this long -> waiting 'stale'
  leadDoneMs: 30 * 60_000 // the lead after end_turn, quiet this long and no live registry -> done 'ended'
} as const

export type LiveReason =
  | 'finished' | 'ended' | 'waiting-for-you' | 'question' | 'api-error' | 'tool' | 'thinking'
  | 'busy' | 'idle' | 'interrupted' | 'stale' | 'no-activity'

export const NEEDS_YOU_TOOLS = ['AskUserQuestion', 'ExitPlanMode'] as const

export interface LiveResult { status: AgentStatus; reason: LiveReason; detail?: string }

export function deriveLiveStatus(rt: AgentRuntime, nowMs: number, th: { [K in keyof typeof LIVE_THRESHOLDS]: number } = LIVE_THRESHOLDS): LiveResult {
  const quiet = Math.max(0, nowMs - rt.lastActivityMs)
  const reg = rt.registry

  if (rt.finished) return { status: 'done', reason: 'finished' }
  if (reg?.status === 'waiting') return { status: 'needs-you', reason: 'waiting-for-you', detail: reg.waitingFor }

  const ask = rt.openTools.find((t) => (NEEDS_YOU_TOOLS as readonly string[]).includes(t.name))
  if (ask) return { status: 'needs-you', reason: 'question', detail: ask.name }

  if (rt.lastTurn === 'api_error') return { status: 'needs-you', reason: 'api-error', detail: rt.errorKind }

  if (rt.openTools.length > 0) {
    if (quiet > th.openToolStaleMs) return { status: 'waiting', reason: 'stale' }
    const newest = rt.openTools.reduce((a, b) => (b.startedMs >= a.startedMs ? b : a))
    return { status: 'running', reason: 'tool', detail: newest.name }
  }

  if (rt.lastTurn === 'user' || rt.lastTurn === 'tool_result') {
    return quiet <= th.modelTurnStaleMs ? { status: 'running', reason: 'thinking' } : { status: 'waiting', reason: 'stale' }
  }

  if (reg?.status === 'busy') return { status: 'running', reason: 'busy' }

  if (rt.lastTurn === 'assistant_end') {
    if (rt.kind !== 'lead') return { status: 'done', reason: 'finished' }
    if (!reg && quiet > th.leadDoneMs) return { status: 'done', reason: 'ended' }
    return { status: 'waiting', reason: 'idle' }
  }
  if (rt.lastTurn === 'assistant_tool_use') {
    return quiet <= th.modelTurnStaleMs ? { status: 'running', reason: 'thinking' } : { status: 'waiting', reason: 'stale' }
  }

  if (rt.lastTurn === 'interrupted') return { status: 'waiting', reason: 'interrupted' }
  return { status: 'waiting', reason: 'no-activity' }
}

export function reasonLabel(reason: LiveReason, detail?: string): string {
  const d = detail ? `: ${detail}` : ''
  switch (reason) {
    case 'finished': return 'finished'
    case 'ended': return 'session ended'
    case 'waiting-for-you': return `waiting for you${d}`
    case 'question': return `asking you a question${d}`
    case 'api-error': return `API error${d}`
    case 'tool': return `running tool${d}`
    case 'thinking': return 'thinking'
    case 'busy': return 'busy'
    case 'idle': return 'idle, waiting for input'
    case 'interrupted': return 'interrupted'
    case 'stale': return 'no activity for a while'
    case 'no-activity': return 'no activity yet'
  }
}
