import type { ActivityKind, ActivitySpan } from '../../shared/types'

export const SPAN_WINDOW_MS = 20 * 60_000
const THINK_MAX_GAP_MS = 120_000
const MERGE_GAP_MS = 1000

const READ = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead'])
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const BASH = new Set(['Bash', 'PowerShell', 'BashOutput', 'Monitor'])
const WAIT = new Set(['AskUserQuestion', 'ExitPlanMode'])

export function kindForTool(name: string): ActivityKind {
  if (READ.has(name)) return 'read'
  if (EDIT.has(name)) return 'edit'
  if (BASH.has(name)) return 'bash'
  if (WAIT.has(name)) return 'wait'
  return 'think'
}

export interface SpanTracker {
  onAssistant(agentId: string, tsMs: number, toolUses: { id: string; name: string }[]): void
  onToolResult(agentId: string, toolUseId: string, tsMs: number, failed: boolean): void
  onPrompt(agentId: string, tsMs: number): void
  onInterrupted(agentId: string, tsMs: number): void
  spans(agentId: string, nowMs: number): ActivitySpan[]
}

interface AgentState {
  spans: ActivitySpan[]
  open: Map<string, ActivitySpan>
  /** Start of a potential think span (last prompt / tool_result); null when idle. */
  thinkFrom: number | null
}

export function createSpanTracker(o?: { maxPerAgent?: number }): SpanTracker {
  const max = o?.maxPerAgent ?? 200
  const agents = new Map<string, AgentState>()
  const get = (id: string): AgentState => {
    let a = agents.get(id)
    if (!a) {
      a = { spans: [], open: new Map(), thinkFrom: null }
      agents.set(id, a)
    }
    return a
  }
  const push = (a: AgentState, s: ActivitySpan): void => {
    a.spans.push(s)
    if (a.spans.length > max) a.spans.splice(0, a.spans.length - max)
  }

  return {
    onAssistant(agentId, tsMs, toolUses) {
      const a = get(agentId)
      if (a.thinkFrom !== null && tsMs >= a.thinkFrom && tsMs - a.thinkFrom <= THINK_MAX_GAP_MS) {
        push(a, { kind: 'think', startMs: a.thinkFrom, endMs: tsMs })
      }
      a.thinkFrom = null
      for (const t of toolUses) {
        const s: ActivitySpan = { kind: kindForTool(t.name), startMs: tsMs, endMs: null }
        a.open.set(t.id, s)
        push(a, s)
      }
    },
    onToolResult(agentId, toolUseId, tsMs, failed) {
      const a = get(agentId)
      const s = a.open.get(toolUseId)
      if (s) {
        s.endMs = tsMs
        if (failed) s.kind = 'error'
        a.open.delete(toolUseId)
      }
      a.thinkFrom = tsMs
    },
    onPrompt(agentId, tsMs) {
      get(agentId).thinkFrom = tsMs
    },
    onInterrupted(agentId, tsMs) {
      const a = get(agentId)
      for (const s of a.open.values()) s.endMs = tsMs
      a.open.clear()
      a.thinkFrom = null
    },
    spans(agentId, nowMs) {
      const a = agents.get(agentId)
      if (!a) return []
      const from = nowMs - SPAN_WINDOW_MS
      const visible = a.spans
        .filter((s) => s.startMs <= nowMs && (s.endMs === null || s.endMs >= from))
        .map((s) => ({ ...s }))
        .sort((x, y) => x.startMs - y.startMs)
      const out: ActivitySpan[] = []
      for (const s of visible) {
        const prev = out[out.length - 1]
        if (prev && prev.kind === s.kind && prev.endMs !== null && s.startMs - prev.endMs < MERGE_GAP_MS) {
          prev.endMs = s.endMs === null ? null : Math.max(prev.endMs, s.endMs)
        } else out.push(s)
      }
      return out
    }
  }
}
