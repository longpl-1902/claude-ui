import { describe, expect, it } from 'vitest'
import type { Agent, TeamSnapshot } from '@shared/types'
import { formatElapsed, formatTokens, sumTokens, teamCounters } from '@shared/format'

describe('formatTokens', () => {
  it('formats the documented examples', () => {
    expect(formatTokens(412000)).toBe('412k')
    expect(formatTokens(58000)).toBe('58k')
    expect(formatTokens(1125000)).toBe('1.12M')
    expect(formatTokens(950)).toBe('950')
  })

  it('rounds thousands to an integer k and trims trailing zeros for millions', () => {
    expect(formatTokens(186000)).toBe('186k')
    expect(formatTokens(1000000)).toBe('1M')
    expect(formatTokens(2500000)).toBe('2.5M')
  })
})

describe('formatElapsed', () => {
  it('formats the documented examples', () => {
    expect(formatElapsed(1122)).toBe('18m 42s')
    expect(formatElapsed(1160)).toBe('19m 20s')
    expect(formatElapsed(372)).toBe('6m 12s')
    expect(formatElapsed(3725)).toBe('1h 02m')
  })

  it('pads seconds for the other mockup values', () => {
    expect(formatElapsed(1025)).toBe('17m 05s')
    expect(formatElapsed(1201)).toBe('20m 01s')
    expect(formatElapsed(520)).toBe('8m 40s')
  })
})

function agent(id: string, tokens: number): Agent {
  return {
    id,
    name: id,
    initials: id.slice(0, 2).toUpperCase(),
    avatarColor: '#ffffff',
    role: 'r',
    model: 'm',
    worktree: 'main',
    taskTitle: 't',
    current: { tool: 'Read', target: 'x' },
    elapsedSec: 1,
    tokens,
    toolCalls: 1,
    timeline: [],
    activity: [],
    files: [],
    messages: []
  }
}

describe('sumTokens / teamCounters', () => {
  it('sumTokens adds agent tokens', () => {
    expect(sumTokens([agent('a', 1000), agent('b', 2500)])).toBe(3500)
    expect(sumTokens([])).toBe(0)
  })

  it('teamCounters derives running / needs-you from events', () => {
    const base = { sessionId: 's', accountId: 'c' }
    const snapshot: TeamSnapshot = {
      repo: 'r',
      teamName: 't',
      accountId: 'c',
      now: '2026-11-19T10:44:20.000Z',
      agents: [agent('a', 1000), agent('b', 2000), agent('c', 3000)],
      events: [
        { ...base, ts: '2026-11-19T10:44:10.000Z', agentId: 'a', kind: 'tool_start', tool: 'Bash' },
        { ...base, ts: '2026-11-19T10:40:00.000Z', agentId: 'b', kind: 'error', result: 'x' },
        { ...base, ts: '2026-11-19T10:30:00.000Z', agentId: 'c', kind: 'stop' }
      ],
      worktrees: [],
      tasks: [],
      overlaps: [],
      console: [],
      timelineTicks: []
    }
    expect(teamCounters(snapshot)).toEqual({ agents: 3, running: 1, needsYou: 1, tokens: 6000 })
  })
})
