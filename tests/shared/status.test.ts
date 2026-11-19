import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentEventKind } from '@shared/types'
import {
  NEEDS_YOU_SIGNALS,
  RECENT_ACTIVITY_MS,
  WAITING_SIGNALS,
  deriveAgentStatus,
  eventsForAgent,
  hasOpenTool
} from '@shared/status'

const NOW = '2026-11-19T10:44:20.000Z'
const nowMs = Date.parse(NOW)

function ev(
  secondsBeforeNow: number,
  kind: AgentEventKind,
  extra: Partial<AgentEvent> = {},
  agentId = 'a1'
): AgentEvent {
  return {
    ts: new Date(nowMs - secondsBeforeNow * 1000).toISOString(),
    sessionId: 's1',
    agentId,
    kind,
    accountId: 'company',
    ...extra
  }
}

describe('status constants', () => {
  it('R-04 exposes the documented signal lists and window', () => {
    expect(RECENT_ACTIVITY_MS).toBe(60_000)
    expect([...WAITING_SIGNALS]).toEqual(['blocked', 'idle', 'waiting'])
    expect([...NEEDS_YOU_SIGNALS]).toEqual(['permission', 'notification'])
  })
})

describe('R-04 deriveAgentStatus rules', () => {
  it('rule 1: no events -> waiting', () => {
    expect(deriveAgentStatus([], 'a1', NOW)).toBe('waiting')
  })

  it('rule 1: events of other agents are ignored -> waiting', () => {
    const events = [ev(5, 'tool_start', { tool: 'Edit' }, 'other')]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('waiting')
  })

  it('rule 2: last event stop -> done', () => {
    const events = [ev(300, 'spawn'), ev(200, 'tool_end', { tool: 'Read' }), ev(100, 'stop')]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('done')
  })

  it('rule 3: last event error -> needs-you', () => {
    const events = [ev(300, 'spawn'), ev(100, 'error', { result: 'boom' })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('needs-you')
  })

  it.each(['permission', 'notification'])('rule 3: status event with result %s -> needs-you', (result) => {
    const events = [ev(300, 'spawn'), ev(100, 'status', { result })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('needs-you')
  })

  it('rule 4: an open tool_start -> running even when old', () => {
    const events = [ev(3000, 'spawn'), ev(2000, 'tool_start', { tool: 'Bash' })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('running')
  })

  it('rule 4: tool_start followed by tool_end of the same tool is not open', () => {
    const events = [ev(3000, 'tool_start', { tool: 'Bash' }), ev(2900, 'tool_end', { tool: 'Bash' })]
    expect(hasOpenTool(events)).toBe(false)
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('waiting')
  })

  it('rule 4: tool_end matches by tool name', () => {
    const events = [
      ev(500, 'tool_start', { tool: 'Bash' }),
      ev(490, 'tool_start', { tool: 'Edit' }),
      ev(480, 'tool_end', { tool: 'Bash' })
    ]
    expect(hasOpenTool(events)).toBe(true)
    const closedAll = [...events, ev(470, 'tool_end', { tool: 'Edit' })]
    expect(hasOpenTool(closedAll)).toBe(false)
  })

  it('rule 4 beats rule 5: open tool then a blocked status -> running', () => {
    const events = [ev(900, 'tool_start', { tool: 'Bash' }), ev(800, 'status', { result: 'blocked' })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('running')
  })

  it.each(['blocked', 'idle', 'waiting'])('rule 5: last status %s (even if recent) -> waiting', (result) => {
    const events = [ev(900, 'tool_end', { tool: 'Edit' }), ev(5, 'status', { result })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('waiting')
  })

  it('rule 6: recent activity within 60 s -> running', () => {
    const events = [ev(500, 'spawn'), ev(30, 'message')]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('running')
  })

  it('rule 6: boundary exactly 60 s is still running', () => {
    const events = [ev(60, 'message')]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('running')
  })

  it('rule 7: stale activity -> waiting', () => {
    const events = [ev(500, 'spawn'), ev(120, 'message')]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('waiting')
  })

  it('opts.recentMs overrides the window', () => {
    const events = [ev(120, 'message')]
    expect(deriveAgentStatus(events, 'a1', NOW, { recentMs: 300_000 })).toBe('running')
    expect(deriveAgentStatus(events, 'a1', NOW, { recentMs: 1000 })).toBe('waiting')
  })

  it('accepts now as Date, number or ISO string', () => {
    const events = [ev(10, 'message')]
    expect(deriveAgentStatus(events, 'a1', new Date(nowMs))).toBe('running')
    expect(deriveAgentStatus(events, 'a1', nowMs)).toBe('running')
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('running')
  })
})

describe('R-04 deriveAgentStatus ordering', () => {
  it('an error followed by a new tool_start means running', () => {
    const events = [ev(300, 'error', { result: 'x' }), ev(100, 'tool_start', { tool: 'Bash' })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('running')
  })

  it('a stop beats an open tool', () => {
    const events = [ev(300, 'tool_start', { tool: 'Bash' }), ev(100, 'stop')]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('done')
  })

  it('an error as last event beats an open tool', () => {
    const events = [ev(300, 'tool_start', { tool: 'Bash' }), ev(100, 'error', { result: 'x' })]
    expect(deriveAgentStatus(events, 'a1', NOW)).toBe('needs-you')
  })

  it('accepts unsorted input (sorted by ts internally)', () => {
    const sorted = [ev(300, 'tool_start', { tool: 'Bash' }), ev(100, 'stop')]
    const shuffled = [sorted[1]!, sorted[0]!]
    expect(deriveAgentStatus(shuffled, 'a1', NOW)).toBe('done')
  })

  it('does not mutate the input array', () => {
    const events = [ev(100, 'stop'), ev(300, 'tool_start', { tool: 'Bash' })]
    const snapshot = JSON.parse(JSON.stringify(events))
    const first = events[0]
    const second = events[1]
    deriveAgentStatus(events, 'a1', NOW)
    expect(events).toEqual(snapshot)
    expect(events[0]).toBe(first)
    expect(events[1]).toBe(second)
  })
})

describe('eventsForAgent', () => {
  it('filters by agent and sorts by ts ascending without mutating', () => {
    const e1 = ev(10, 'message', {}, 'a1')
    const e2 = ev(100, 'spawn', {}, 'a1')
    const e3 = ev(50, 'message', {}, 'a2')
    const input = [e1, e3, e2]
    const out = eventsForAgent(input, 'a1')
    expect(out).toEqual([e2, e1])
    expect(input).toEqual([e1, e3, e2])
  })
})
