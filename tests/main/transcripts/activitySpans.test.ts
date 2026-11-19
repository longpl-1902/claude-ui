// T06 / R-12: per-agent activity spans for the timeline swimlanes (last 20 min).
import { describe, expect, it } from 'vitest'
import { SPAN_WINDOW_MS, createSpanTracker, kindForTool } from '../../../src/main/transcripts/activitySpans'

const T = 1_800_000_000_000
const S = 1000
const spansOf = (tr: ReturnType<typeof createSpanTracker>, agent: string, now: number, kind?: string) =>
  tr.spans(agent, now).filter((s) => kind === undefined || s.kind === kind)

describe('R-12 kindForTool', () => {
  it('R-12 maps the documented tool names', () => {
    for (const n of ['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead']) expect(kindForTool(n)).toBe('read')
    for (const n of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect(kindForTool(n)).toBe('edit')
    for (const n of ['Bash', 'PowerShell', 'BashOutput', 'Monitor']) expect(kindForTool(n)).toBe('bash')
    for (const n of ['AskUserQuestion', 'ExitPlanMode']) expect(kindForTool(n)).toBe('wait')
    for (const n of ['Agent', 'TodoWrite', 'SomethingNew', '']) expect(kindForTool(n)).toBe('think')
  })
  it('R-12 SPAN_WINDOW_MS is 20 minutes', () => expect(SPAN_WINDOW_MS).toBe(20 * 60_000))
})

describe('R-12 tool spans', () => {
  it('R-12 tool_use ts -> matching result ts; kind from the tool name', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 't1', name: 'Read' }])
    tr.onToolResult('lead', 't1', T + 5 * S, false)
    expect(spansOf(tr, 'lead', T + 10 * S, 'read')).toEqual([{ kind: 'read', startMs: T, endMs: T + 5 * S }])
  })
  it('R-12 a failed result makes the span an error span', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 't1', name: 'Bash' }])
    tr.onToolResult('lead', 't1', T + 3 * S, true)
    expect(spansOf(tr, 'lead', T + 10 * S, 'error')).toEqual([{ kind: 'error', startMs: T, endMs: T + 3 * S }])
    expect(spansOf(tr, 'lead', T + 10 * S, 'bash')).toEqual([])
  })
  it('R-12 a tool without a result yet is an open span (endMs null)', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 't1', name: 'Edit' }])
    expect(spansOf(tr, 'lead', T + 10 * S, 'edit')).toEqual([{ kind: 'edit', startMs: T, endMs: null }])
  })
  it('R-12 a question tool is a wait span', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 'q', name: 'AskUserQuestion' }])
    tr.onToolResult('lead', 'q', T + 60 * S, false)
    expect(spansOf(tr, 'lead', T + 70 * S, 'wait')).toHaveLength(1)
  })
  it('R-12 several tools in one assistant message all start at the message ts', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 'a', name: 'Read' }, { id: 'b', name: 'Bash' }])
    tr.onToolResult('lead', 'a', T + 2 * S, false)
    tr.onToolResult('lead', 'b', T + 8 * S, false)
    expect(spansOf(tr, 'lead', T + 10 * S, 'read')[0]).toMatchObject({ startMs: T, endMs: T + 2 * S })
    expect(spansOf(tr, 'lead', T + 10 * S, 'bash')[0]).toMatchObject({ startMs: T, endMs: T + 8 * S })
  })
  it('R-12 an unknown tool id result is ignored', () => {
    const tr = createSpanTracker()
    expect(() => tr.onToolResult('lead', 'nope', T, false)).not.toThrow()
    expect(tr.spans('lead', T)).toEqual([])
  })
  it('R-12 agents are independent', () => {
    const tr = createSpanTracker()
    tr.onAssistant('a1', T, [{ id: 't1', name: 'Read' }])
    tr.onToolResult('a1', 't1', T + S, false)
    expect(tr.spans('a2', T + 5 * S)).toEqual([])
    expect(tr.spans('a1', T + 5 * S).length).toBeGreaterThan(0)
  })
})

describe('R-12 think spans', () => {
  it('R-12 prompt -> next assistant is a think span when the gap is <= 120 s', () => {
    const tr = createSpanTracker()
    tr.onPrompt('lead', T)
    tr.onAssistant('lead', T + 30 * S, [])
    expect(spansOf(tr, 'lead', T + 60 * S, 'think')).toEqual([{ kind: 'think', startMs: T, endMs: T + 30 * S }])
  })
  it('R-12 tool result -> next assistant is also a think span', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 't1', name: 'Read' }])
    tr.onToolResult('lead', 't1', T + 2 * S, false)
    tr.onAssistant('lead', T + 12 * S, [])
    expect(spansOf(tr, 'lead', T + 20 * S, 'think')).toEqual([{ kind: 'think', startMs: T + 2 * S, endMs: T + 12 * S }])
  })
  it('R-12 a gap over 120 s is not thinking (the agent was idle)', () => {
    const tr = createSpanTracker()
    tr.onPrompt('lead', T)
    tr.onAssistant('lead', T + 121 * S, [])
    expect(spansOf(tr, 'lead', T + 200 * S, 'think')).toEqual([])
  })
  it('R-12 exactly 120 s still counts', () => {
    const tr = createSpanTracker()
    tr.onPrompt('lead', T)
    tr.onAssistant('lead', T + 120 * S, [])
    expect(spansOf(tr, 'lead', T + 200 * S, 'think')).toHaveLength(1)
  })
})

describe('R-12 window, merge, cap, interrupt', () => {
  it('R-12 only spans overlapping [now-20min, now] are returned', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 'old', name: 'Read' }])
    tr.onToolResult('lead', 'old', T + S, false)
    const now = T + SPAN_WINDOW_MS + 5 * 60_000
    tr.onAssistant('lead', now - 10 * S, [{ id: 'new', name: 'Edit' }])
    tr.onToolResult('lead', 'new', now - 5 * S, false)
    const kinds = tr.spans('lead', now).map((s) => s.kind)
    expect(kinds).toContain('edit')
    expect(kinds).not.toContain('read')
  })
  it('R-12 a span that started before the window but ends inside it is kept', () => {
    const tr = createSpanTracker()
    const now = T + SPAN_WINDOW_MS + 60 * S
    tr.onAssistant('lead', T + 30 * S, [{ id: 'long', name: 'Bash' }])
    tr.onToolResult('lead', 'long', now - 30 * S, false)
    expect(spansOf(tr, 'lead', now, 'bash')).toHaveLength(1)
  })
  it('R-12 adjacent same-kind spans with a gap under 1 s are merged', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 'a', name: 'Read' }])
    tr.onToolResult('lead', 'a', T + 2000, false)
    tr.onAssistant('lead', T + 2500, [{ id: 'b', name: 'Grep' }])
    tr.onToolResult('lead', 'b', T + 4000, false)
    expect(spansOf(tr, 'lead', T + 10 * S, 'read')).toEqual([{ kind: 'read', startMs: T, endMs: T + 4000 }])
  })
  it('R-12 a gap of 1 s or more, or a different kind, is not merged', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 'a', name: 'Read' }])
    tr.onToolResult('lead', 'a', T + 2000, false)
    tr.onAssistant('lead', T + 3500, [{ id: 'b', name: 'Read' }])
    tr.onToolResult('lead', 'b', T + 4000, false)
    expect(spansOf(tr, 'lead', T + 10 * S, 'read')).toHaveLength(2)
    const tr2 = createSpanTracker()
    tr2.onAssistant('lead', T, [{ id: 'a', name: 'Read' }])
    tr2.onToolResult('lead', 'a', T + 2000, false)
    tr2.onAssistant('lead', T + 2100, [{ id: 'b', name: 'Edit' }])
    tr2.onToolResult('lead', 'b', T + 3000, false)
    expect(tr2.spans('lead', T + 10 * S).filter((s) => s.kind === 'read' || s.kind === 'edit')).toHaveLength(2)
  })
  it('R-12 spans are returned oldest first', () => {
    const tr = createSpanTracker()
    for (let i = 0; i < 4; i++) {
      tr.onAssistant('lead', T + i * 10 * S, [{ id: `t${i}`, name: i % 2 ? 'Edit' : 'Read' }])
      tr.onToolResult('lead', `t${i}`, T + i * 10 * S + S, false)
    }
    const starts = tr.spans('lead', T + 60 * S).map((s) => s.startMs)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
  it('R-12 the per-agent cap drops the oldest spans (default 200, configurable)', () => {
    const small = createSpanTracker({ maxPerAgent: 3 })
    for (let i = 0; i < 6; i++) {
      small.onAssistant('lead', T + i * 10 * S, [{ id: `t${i}`, name: i % 2 ? 'Edit' : 'Read' }])
      small.onToolResult('lead', `t${i}`, T + i * 10 * S + S, false)
    }
    const got = small.spans('lead', T + 100 * S)
    expect(got.length).toBeLessThanOrEqual(3)
    expect(got[got.length - 1]!.startMs).toBe(T + 50 * S)

    const big = createSpanTracker()
    for (let i = 0; i < 260; i++) {
      big.onAssistant('lead', T + i * 2000, [{ id: `t${i}`, name: i % 2 ? 'Edit' : 'Read' }])
      big.onToolResult('lead', `t${i}`, T + i * 2000 + 500, false)
    }
    expect(big.spans('lead', T + 260 * 2000).length).toBeLessThanOrEqual(200)
  })
  it('R-12 onInterrupted closes open spans at the interrupt time', () => {
    const tr = createSpanTracker()
    tr.onAssistant('lead', T, [{ id: 't1', name: 'Bash' }])
    tr.onInterrupted('lead', T + 4 * S)
    const all = tr.spans('lead', T + 10 * S)
    expect(all.length).toBeGreaterThan(0)
    for (const s of all) expect(s.endMs).not.toBeNull()
    expect(Math.max(...all.map((s) => s.endMs as number))).toBeLessThanOrEqual(T + 4 * S)
  })
  it('R-12 an interrupted agent does not produce a long think span afterwards', () => {
    const tr = createSpanTracker()
    tr.onPrompt('lead', T)
    tr.onInterrupted('lead', T + 2 * S)
    tr.onAssistant('lead', T + 100 * S, [])
    const think = spansOf(tr, 'lead', T + 120 * S, 'think')
    for (const s of think) expect((s.endMs ?? Infinity) - s.startMs).toBeLessThan(90 * S)
  })
})
