// T02 / R-06: message formatting and console input routing (D2).
import { describe, expect, it } from 'vitest'
import { formatAgentMessage, routeConsoleInput } from '@shared/agentMessage'

const agents = [
  { id: 'lead', name: 'Lead' },
  { id: 'a1', name: 'reviewer' },
  { id: 'a2', name: 'Code Reviewer' },
  { id: 'a3', name: 'Code' }
]

describe('R-06 formatAgentMessage (D2 format)', () => {
  it('R-06 first line is "@<name>: <text>", then one forwarding hint naming the agent and SendMessage', () => {
    const s = formatAgentMessage('reviewer', 'please check the schema')
    const lines = s.split('\n')
    expect(lines[0]).toBe('@reviewer: please check the schema')
    expect(s).toContain('Agent Console')
    expect(s).toContain('"reviewer"')
    expect(s).toContain('SendMessage')
    expect(s).toContain('if it is still running')
    expect(s).toContain('otherwise handle it yourself')
  })
  it('R-06 multi-line text stays together before the hint', () => {
    const s = formatAgentMessage('rev', 'a\nb')
    expect(s.startsWith('@rev: a\nb')).toBe(true)
    expect(s.trimEnd().endsWith(')')).toBe(true)
  })
})

describe('R-06 routeConsoleInput', () => {
  it('R-06 plain text is sent as-is (trimmed) to the lead', () => {
    expect(routeConsoleInput('  hello there \n', agents)).toEqual({ kind: 'send', text: 'hello there' })
  })
  it('R-06 empty / whitespace -> error empty', () => {
    expect(routeConsoleInput('', agents)).toEqual({ kind: 'error', reason: 'empty' })
    expect(routeConsoleInput(' \n\t ', agents)).toEqual({ kind: 'error', reason: 'empty' })
  })
  it('R-06 over 32000 chars -> too-long; exactly 32000 is fine', () => {
    expect(routeConsoleInput('x'.repeat(32001), agents)).toEqual({ kind: 'error', reason: 'too-long' })
    expect(routeConsoleInput('x'.repeat(32000), agents).kind).toBe('send')
  })
  it('R-06 slash commands are sent verbatim', () => {
    expect(routeConsoleInput('/compact keep decisions', agents)).toEqual({ kind: 'send', text: '/compact keep decisions' })
  })
  it('R-06 @name text routes to the agent with the formatted lead prompt', () => {
    const r = routeConsoleInput('@reviewer look at a.ts', agents) as any
    expect(r.kind).toBe('send')
    expect(r.targetAgentId).toBe('a1')
    expect(r.text).toBe(formatAgentMessage('reviewer', 'look at a.ts'))
  })
  it('R-06 agent names match case-insensitively and the formatted name is the agent real name', () => {
    const r = routeConsoleInput('@REVIEWER hi', agents) as any
    expect(r.targetAgentId).toBe('a1')
    expect(r.text).toBe(formatAgentMessage('reviewer', 'hi'))
  })
  it('R-06 names with spaces: the longest match wins', () => {
    const r = routeConsoleInput('@Code Reviewer fix it', agents) as any
    expect(r.targetAgentId).toBe('a2')
    expect(r.text).toBe(formatAgentMessage('Code Reviewer', 'fix it'))
    const r2 = routeConsoleInput('@code fix it', agents) as any
    expect(r2.targetAgentId).toBe('a3')
  })
  it('R-06 @lead is a plain message to the lead (no wrapper, no target)', () => {
    expect(routeConsoleInput('@lead do the thing', agents)).toEqual({ kind: 'send', text: 'do the thing' })
  })
  it('R-06 unknown agent -> error unknown-agent', () => {
    expect(routeConsoleInput('@ghost hi', agents)).toEqual({ kind: 'error', reason: 'unknown-agent' })
  })
  it('R-06 "@name" with no message is an error, not an empty send', () => {
    expect(routeConsoleInput('@reviewer', agents).kind).toBe('error')
  })
  it('R-06 an @ in the middle of text is not routing', () => {
    expect(routeConsoleInput('mail me at a@b.example', agents)).toEqual({ kind: 'send', text: 'mail me at a@b.example' })
  })
  it('R-06 a custom lead id is honoured', () => {
    expect(routeConsoleInput('@boss go', [{ id: 'main', name: 'boss' }], 'main')).toEqual({ kind: 'send', text: 'go' })
  })
})
