import { describe, expect, it } from 'vitest'
import { LIVE_THRESHOLDS, NEEDS_YOU_TOOLS, deriveLiveStatus, reasonLabel, type LiveReason } from '@shared/liveStatus'
import type { AgentRuntime } from '@shared/types'

const NOW = 1_800_000_000_000
const MIN = 60_000

/** Build a runtime whose last activity was `quietMs` before NOW. */
function rt(over: Partial<AgentRuntime> & { quietMs?: number } = {}): AgentRuntime {
  const { quietMs = 0, ...rest } = over
  return {
    kind: 'subagent',
    startedMs: NOW - 3_600_000,
    lastActivityMs: NOW - quietMs,
    openTools: [],
    lastTurn: 'none',
    ...rest
  }
}
const tool = (name: string, ago = 1000) => ({ id: `toolu_${name}`, name, startedMs: NOW - ago })

describe('R-07 thresholds', () => {
  it('R-07 exports the documented thresholds', () => {
    expect(LIVE_THRESHOLDS.modelTurnStaleMs).toBe(5 * MIN)
    expect(LIVE_THRESHOLDS.openToolStaleMs).toBe(30 * MIN)
    expect(LIVE_THRESHOLDS.leadDoneMs).toBe(30 * MIN)
  })
  it('R-07 only AskUserQuestion and ExitPlanMode count as needs-you tools', () => {
    expect([...NEEDS_YOU_TOOLS].sort()).toEqual(['AskUserQuestion', 'ExitPlanMode'])
  })
})

type Row = [name: string, runtime: AgentRuntime, status: string, reason: LiveReason, detail?: string]

describe('R-07 deriveLiveStatus table (evaluation order)', () => {
  const rows: Row[] = [
    // 1 finished wins over everything
    ['finished', rt({ finished: true, lastTurn: 'assistant_end' }), 'done', 'finished'],
    ['finished beats registry waiting / open question / api error', rt({ finished: true, openTools: [tool('AskUserQuestion')], lastTurn: 'api_error', kind: 'lead', registry: { status: 'waiting', waitingFor: 'x', updatedMs: NOW } }), 'done', 'finished'],
    // 2 registry waiting
    ['registry waiting', rt({ kind: 'lead', lastTurn: 'assistant_end', registry: { status: 'waiting', waitingFor: 'dialog open', updatedMs: NOW } }), 'needs-you', 'waiting-for-you', 'dialog open'],
    ['registry waiting beats an open question tool', rt({ kind: 'lead', openTools: [tool('AskUserQuestion')], registry: { status: 'waiting', waitingFor: 'input needed', updatedMs: NOW } }), 'needs-you', 'waiting-for-you', 'input needed'],
    ['registry waiting beats api error', rt({ kind: 'lead', lastTurn: 'api_error', errorKind: 'rate_limit', registry: { status: 'waiting', waitingFor: 'sandbox request', updatedMs: NOW } }), 'needs-you', 'waiting-for-you', 'sandbox request'],
    // 3 question tools
    ['open AskUserQuestion', rt({ openTools: [tool('AskUserQuestion')], lastTurn: 'assistant_tool_use' }), 'needs-you', 'question', 'AskUserQuestion'],
    ['open ExitPlanMode', rt({ openTools: [tool('Read'), tool('ExitPlanMode')], lastTurn: 'assistant_tool_use' }), 'needs-you', 'question', 'ExitPlanMode'],
    ['open question tool stays needs-you however long it is quiet', rt({ openTools: [tool('AskUserQuestion')], quietMs: 5 * 60 * MIN }), 'needs-you', 'question', 'AskUserQuestion'],
    // 4 api error
    ['api error', rt({ lastTurn: 'api_error', errorKind: 'rate_limit' }), 'needs-you', 'api-error', 'rate_limit'],
    ['api error beats busy registry', rt({ kind: 'lead', lastTurn: 'api_error', errorKind: 'server_error', registry: { status: 'busy', updatedMs: NOW } }), 'needs-you', 'api-error', 'server_error'],
    // 5 open tools
    ['open tool, fresh', rt({ openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', quietMs: 1000 }), 'running', 'tool', 'Bash'],
    ['open tool names the newest one', rt({ openTools: [tool('Read', 5000), tool('Grep', 100), tool('Glob', 3000)], lastTurn: 'assistant_tool_use' }), 'running', 'tool', 'Grep'],
    ['open tool, exactly at openToolStaleMs counts as within', rt({ openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', quietMs: LIVE_THRESHOLDS.openToolStaleMs }), 'running', 'tool', 'Bash'],
    ['open tool, 1 ms past openToolStaleMs', rt({ openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', quietMs: LIVE_THRESHOLDS.openToolStaleMs + 1 }), 'waiting', 'stale'],
    // user decision: the quiet-open-tool needs-you heuristic is OFF
    ['quiet open tool while registry busy is NOT needs-you (heuristic off)', rt({ kind: 'lead', openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', quietMs: 25_000, registry: { status: 'busy', updatedMs: NOW } }), 'running', 'tool', 'Bash'],
    ['quiet open tool 10 minutes while busy is still running', rt({ kind: 'lead', openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', quietMs: 10 * MIN, registry: { status: 'busy', updatedMs: NOW } }), 'running', 'tool', 'Bash'],
    // 6 model turn
    ['user turn, fresh', rt({ lastTurn: 'user', quietMs: 1000 }), 'running', 'thinking'],
    ['tool_result turn, fresh', rt({ lastTurn: 'tool_result', quietMs: 1000 }), 'running', 'thinking'],
    ['model turn exactly at modelTurnStaleMs counts as within', rt({ lastTurn: 'tool_result', quietMs: LIVE_THRESHOLDS.modelTurnStaleMs }), 'running', 'thinking'],
    ['model turn 1 ms past modelTurnStaleMs', rt({ lastTurn: 'user', quietMs: LIVE_THRESHOLDS.modelTurnStaleMs + 1 }), 'waiting', 'stale'],
    // 7 registry busy
    ['registry busy with a finished lead turn', rt({ kind: 'lead', lastTurn: 'assistant_end', quietMs: 60 * MIN, registry: { status: 'busy', updatedMs: NOW } }), 'running', 'busy'],
    ['registry busy with no transcript turn yet', rt({ kind: 'lead', lastTurn: 'none', registry: { status: 'busy', updatedMs: NOW } }), 'running', 'busy'],
    // 8 assistant turn ended
    ['sub-agent end_turn -> done', rt({ kind: 'subagent', lastTurn: 'assistant_end' }), 'done', 'finished'],
    ['teammate end_turn -> done', rt({ kind: 'teammate', lastTurn: 'assistant_end' }), 'done', 'finished'],
    ['lead end_turn, recent, no registry -> idle', rt({ kind: 'lead', lastTurn: 'assistant_end', quietMs: MIN }), 'waiting', 'idle'],
    ['lead end_turn exactly at leadDoneMs, no registry -> still idle', rt({ kind: 'lead', lastTurn: 'assistant_end', quietMs: LIVE_THRESHOLDS.leadDoneMs }), 'waiting', 'idle'],
    ['lead end_turn 1 ms past leadDoneMs, no registry -> done/ended', rt({ kind: 'lead', lastTurn: 'assistant_end', quietMs: LIVE_THRESHOLDS.leadDoneMs + 1 }), 'done', 'ended'],
    ['lead end_turn long quiet but a live registry entry -> idle', rt({ kind: 'lead', lastTurn: 'assistant_end', quietMs: 90 * MIN, registry: { status: 'idle', updatedMs: NOW } }), 'waiting', 'idle'],
    ['assistant_tool_use with no open tool, fresh', rt({ lastTurn: 'assistant_tool_use', quietMs: 1000 }), 'running', 'thinking'],
    ['assistant_tool_use with no open tool, exactly at modelTurnStaleMs', rt({ lastTurn: 'assistant_tool_use', quietMs: LIVE_THRESHOLDS.modelTurnStaleMs }), 'running', 'thinking'],
    ['assistant_tool_use with no open tool, stale', rt({ lastTurn: 'assistant_tool_use', quietMs: LIVE_THRESHOLDS.modelTurnStaleMs + 1 }), 'waiting', 'stale'],
    // 9 / 10
    ['interrupted', rt({ lastTurn: 'interrupted' }), 'waiting', 'interrupted'],
    ['no activity', rt({ lastTurn: 'none' }), 'waiting', 'no-activity'],
    ['registry idle with no turn is just no-activity', rt({ kind: 'lead', lastTurn: 'none', registry: { status: 'idle', updatedMs: NOW } }), 'waiting', 'no-activity']
  ]

  it.each(rows)('R-07 %s', (_name, runtime, status, reason, detail) => {
    const r = deriveLiveStatus(runtime, NOW)
    expect(r.status).toBe(status)
    expect(r.reason).toBe(reason)
    if (detail !== undefined) expect(r.detail).toBe(detail)
  })

  it('R-07 clock skew (now earlier than the last activity) is treated as quiet = 0', () => {
    const r = deriveLiveStatus(rt({ lastTurn: 'user', lastActivityMs: NOW + 10 * MIN }), NOW)
    expect(r).toMatchObject({ status: 'running', reason: 'thinking' })
    const t = deriveLiveStatus(rt({ openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', lastActivityMs: NOW + 99 * MIN }), NOW)
    expect(t).toMatchObject({ status: 'running', reason: 'tool' })
  })

  it('R-07 custom thresholds are honoured', () => {
    const th = { modelTurnStaleMs: 1000, openToolStaleMs: 2000, leadDoneMs: 3000 }
    expect(deriveLiveStatus(rt({ lastTurn: 'user', quietMs: 1001 }), NOW, th)).toMatchObject({ status: 'waiting', reason: 'stale' })
    expect(deriveLiveStatus(rt({ openTools: [tool('Bash')], lastTurn: 'assistant_tool_use', quietMs: 2001 }), NOW, th).reason).toBe('stale')
    expect(deriveLiveStatus(rt({ kind: 'lead', lastTurn: 'assistant_end', quietMs: 3001 }), NOW, th).reason).toBe('ended')
  })

  it('R-07 never throws for a minimal runtime', () => {
    expect(() => deriveLiveStatus(rt(), NOW)).not.toThrow()
  })
})

describe('R-07 reasonLabel', () => {
  const reasons: LiveReason[] = ['finished', 'ended', 'waiting-for-you', 'question', 'api-error', 'tool', 'thinking', 'busy', 'idle', 'interrupted', 'stale', 'no-activity']
  it.each(reasons)('R-07 %s has a short non-empty English label', (reason) => {
    const label = reasonLabel(reason)
    expect(label.length).toBeGreaterThan(0)
    expect(label.length).toBeLessThan(80)
  })
  it('R-07 waiting-for-you includes the detail', () => {
    expect(reasonLabel('waiting-for-you', 'dialog open')).toBe('waiting for you: dialog open')
  })
  it('R-07 detail-carrying reasons show it', () => {
    expect(reasonLabel('tool', 'Bash')).toContain('Bash')
    expect(reasonLabel('api-error', 'rate_limit')).toContain('rate_limit')
    expect(reasonLabel('question', 'AskUserQuestion')).toContain('AskUserQuestion')
  })
})
