import { describe, expect, it } from 'vitest'
import type { Agent, AgentStatus } from '../../src/shared/types'
import { sortAgentsByStatus, STATUS_ORDER } from '../../src/renderer/src/components/team/AgentGrid'

const agent = (id: string): Agent => ({ id } as unknown as Agent)

describe('AgentGrid order (user request: running agents on top)', () => {
  it('orders needs-you, then running, then waiting, then done', () => {
    const agents = ['d1', 'w1', 'r1', 'n1', 'r2', 'd2'].map(agent)
    const statuses: Record<string, AgentStatus> = { d1: 'done', w1: 'waiting', r1: 'running', n1: 'needs-you', r2: 'running', d2: 'done' }
    expect(sortAgentsByStatus(agents, statuses).map((a) => a.id)).toEqual(['n1', 'r1', 'r2', 'w1', 'd1', 'd2'])
  })

  it('is stable: agents with the same status keep their original order', () => {
    const agents = ['lead', 'a', 'b', 'c'].map(agent)
    const statuses: Record<string, AgentStatus> = { lead: 'running', a: 'done', b: 'running', c: 'done' }
    expect(sortAgentsByStatus(agents, statuses).map((a) => a.id)).toEqual(['lead', 'b', 'a', 'c'])
  })

  it('treats an unknown status as waiting and ranks needs-you highest', () => {
    const agents = ['x', 'y'].map(agent)
    expect(sortAgentsByStatus(agents, { y: 'running' }).map((a) => a.id)).toEqual(['y', 'x'])
    expect(STATUS_ORDER['needs-you']).toBeLessThan(STATUS_ORDER.running)
  })
})
