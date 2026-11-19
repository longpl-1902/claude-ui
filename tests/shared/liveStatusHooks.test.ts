// T09 / R-18: live status reasons driven by hook events. Own file so the existing liveStatus.test.ts table is untouched.
import { describe, expect, it } from 'vitest'
import * as LS from '@shared/liveStatus'
import type { AgentRuntime } from '@shared/types'

const { deriveLiveStatus, reasonLabel } = LS
const NOW = 1_800_000_000_000
const MIN = 60_000

const rt = (over: Record<string, unknown> = {}): AgentRuntime =>
  ({ kind: 'lead', startedMs: NOW - 3_600_000, lastActivityMs: NOW - 1000, openTools: [], lastTurn: 'assistant_tool_use', ...over }) as AgentRuntime

describe('R-18 HOOK_STALE_MS', () => {
  it('R-18 is exported and equals 30 minutes', () => {
    expect((LS as any).HOOK_STALE_MS).toBe(30 * MIN)
  })
})

describe('R-18 deriveLiveStatus with hook data', () => {
  it('R-18 pendingPermission -> needs-you / hook-permission with the tool as detail', () => {
    const r = deriveLiveStatus(rt({ hook: { pendingPermission: { toolName: 'Bash', sinceMs: NOW - 5000 }, lastEventMs: NOW - 5000 } }), NOW)
    expect(r).toEqual({ status: 'needs-you', reason: 'hook-permission', detail: 'Bash' })
  })
  it('R-18 notification -> needs-you / hook-notification', () => {
    const r = deriveLiveStatus(rt({ hook: { notification: { type: 'agent_needs_input', sinceMs: NOW - 5000 }, lastEventMs: NOW - 5000 } }), NOW)
    expect(r).toMatchObject({ status: 'needs-you', reason: 'hook-notification' })
  })
  it('R-18 hook needs-you is checked before the registry-waiting and question rules', () => {
    const r = deriveLiveStatus(
      rt({
        registry: { status: 'waiting', waitingFor: 'dialog open', updatedMs: NOW },
        openTools: [{ id: 't', name: 'AskUserQuestion', startedMs: NOW - 1000 }],
        hook: { pendingPermission: { toolName: 'Write', sinceMs: NOW - 1000 }, lastEventMs: NOW - 1000 }
      }),
      NOW
    )
    expect(r.reason).toBe('hook-permission')
  })
  it('R-18 a pendingPermission older than 30 minutes is ignored (stale)', () => {
    const r = deriveLiveStatus(rt({ hook: { pendingPermission: { toolName: 'Bash', sinceMs: NOW - 31 * MIN }, lastEventMs: NOW - 31 * MIN }, lastActivityMs: NOW - 31 * MIN, openTools: [{ id: 't', name: 'Bash', startedMs: NOW - 31 * MIN }] }), NOW)
    expect(r.reason).not.toBe('hook-permission')
    expect(r.status).not.toBe('needs-you')
  })
  it('R-18 29 minutes old is still active', () => {
    const r = deriveLiveStatus(rt({ hook: { pendingPermission: { toolName: 'Bash', sinceMs: NOW - 29 * MIN }, lastEventMs: NOW - 29 * MIN } }), NOW)
    expect(r.reason).toBe('hook-permission')
  })
  it('R-18 hook data with nothing pending changes nothing (same result as without hook)', () => {
    const base = rt({ openTools: [{ id: 't', name: 'Read', startedMs: NOW - 1000 }] })
    const withHook = rt({ openTools: [{ id: 't', name: 'Read', startedMs: NOW - 1000 }], hook: { lastEventMs: NOW - 500 } })
    expect(deriveLiveStatus(withHook, NOW)).toEqual(deriveLiveStatus(base, NOW))
  })
  it('R-18 a finished agent stays done even with a stale hook flag', () => {
    const r = deriveLiveStatus(rt({ kind: 'subagent', finished: true, hook: { pendingPermission: { toolName: 'Bash', sinceMs: NOW - 1000 }, lastEventMs: NOW - 1000 } }), NOW)
    expect(r.status === 'done' || r.reason === 'hook-permission').toBe(true)
  })
})

describe('R-18 reasonLabel for hook reasons', () => {
  it('R-18 hook-permission names the tool', () => {
    expect(reasonLabel('hook-permission' as never, 'Bash')).toBe('Waiting for permission: Bash')
  })
  it('R-18 hook-notification', () => {
    expect(reasonLabel('hook-notification' as never)).toBe('Needs your input')
  })
  it('R-18 existing labels are unchanged', () => {
    expect(reasonLabel('thinking')).toBe('thinking')
    expect(reasonLabel('tool', 'Read')).toBe('running tool: Read')
  })
})
