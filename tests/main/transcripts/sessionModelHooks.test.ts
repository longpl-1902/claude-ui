// T09 / R-11, R-12, R-18: session model gains tasks, activity spans and the realtime hook overlay.
// Own file so the existing sessionModel.test.ts stays untouched (T09 may fold these cases into it).
import { describe, expect, it } from 'vitest'
import { createSessionModel } from '../../../src/main/transcripts/sessionModel'
import { parseLine } from '../../../src/main/transcripts/parseLine'
import { deriveLiveStatus } from '../../../src/shared/liveStatus'
import { SESSION_ID, assistantBlocks, at, toLine, toolResult, toolUseBlock, userPrompt, textBlock } from '../../fixtures/transcripts/builders'

const T = (sec: number): number => Date.parse(at(sec))
const recs = (objs: unknown[]) => objs.map((o) => parseLine(toLine(o))).filter((r): r is NonNullable<typeof r> => r !== null)
const SUB = 'a1b2c3d4e5f6a7b81'
const OTHER_SESSION = '99999999-aaaa-4bbb-8ccc-000000000009'

let n = 0
const asst = (sec: number, blocks: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  assistantBlocks(blocks, { messageId: `msg_${++n}`, stopReason: 'tool_use', ts: at(sec), ...extra })
const use = (id: string, name: string, input: Record<string, unknown>) => toolUseBlock(id, name, input)

function mk(extra: unknown[] = [], subLines: unknown[] = []) {
  const m = createSessionModel({ sessionId: SESSION_ID, accountId: 'acme' })
  m.ingest('lead', recs([userPrompt('Start', { ts: at(0), parentUuid: null }), ...extra]))
  if (subLines.length) m.ingest(SUB, recs(subLines))
  return m
}
const snapAt = (m: ReturnType<typeof mk>, sec: number): any => m.snapshot(T(sec)) as any
const agent = (snap: any, id: string): any => snap.agents.find((a: any) => a.id === id)

const hook = (event: string, over: Record<string, unknown> = {}) => ({ event, sessionId: SESSION_ID, receivedMs: T(50), ...over }) as any

describe('R-11 TeamSnapshot.tasks from TaskCreate / TaskUpdate', () => {
  const taskLines = () => [
    ...asst(1, [use('tc1', 'TaskCreate', { subject: 'Write schema', description: 'v2' })]),
    toolResult('tc1', 'Task #1 created', { ts: at(2), toolUseResult: { task: { id: '1', subject: 'Write schema' } } }),
    ...asst(3, [use('tc2', 'TaskCreate', { subject: 'Add endpoints' })]),
    toolResult('tc2', 'Task #2 created', { ts: at(4), toolUseResult: { task: { id: '2', subject: 'Add endpoints' } } }),
    ...asst(5, [use('tu1', 'TaskUpdate', { taskId: '1', status: 'in_progress' })]),
    toolResult('tu1', 'Updated', { ts: at(6), toolUseResult: { success: true, taskId: '1' } }),
    ...asst(7, [use('tu2', 'TaskUpdate', { taskId: '2', addBlockedBy: ['1'] })]),
    toolResult('tu2', 'Updated', { ts: at(8), toolUseResult: { success: true, taskId: '2' } })
  ]
  it('R-11 the snapshot lists tasks with state, owner and blocker', () => {
    const snap = snapAt(mk(taskLines()), 20)
    expect(snap.tasks).toEqual([
      expect.objectContaining({ id: 1, title: 'Write schema', state: 'in_progress', ownerAgentId: 'lead' }),
      expect.objectContaining({ id: 2, title: 'Add endpoints', state: 'blocked', blockedBy: 1 })
    ])
  })
  it('R-11 completing the blocker unblocks the dependent task', () => {
    const lines = [
      ...taskLines(),
      ...asst(10, [use('tu3', 'TaskUpdate', { taskId: '1', status: 'completed' })]),
      toolResult('tu3', 'Updated', { ts: at(11), toolUseResult: { success: true, taskId: '1' } })
    ]
    const snap = snapAt(mk(lines), 20)
    expect(snap.tasks.map((t: any) => [t.id, t.state])).toEqual([[1, 'done'], [2, 'pending']])
  })
  it('R-11 a sub-agent that sets in_progress owns the task', () => {
    const m = mk(
      [
        ...asst(1, [use('tc1', 'TaskCreate', { subject: 'Review' })]),
        toolResult('tc1', 'Task #1 created', { ts: at(2), toolUseResult: { task: { id: '1', subject: 'Review' } } })
      ],
      [userPrompt('go', { ts: at(3), agentId: SUB, parentUuid: null }), ...asst(5, [use('tu1', 'TaskUpdate', { taskId: '1', status: 'in_progress' })], { agentId: SUB })]
    )
    expect(snapAt(m, 20).tasks[0]).toMatchObject({ id: 1, state: 'in_progress', ownerAgentId: SUB })
  })
  it('R-11 a transcript without task tools has an empty task list', () => {
    expect(snapAt(mk(), 20).tasks).toEqual([])
  })
  it('R-11 a failed Bash result of the owner marks its in_progress task failing', () => {
    const lines = [
      ...taskLines().slice(0, 6),
      ...asst(12, [use('b1', 'Bash', { command: 'npm test' })]),
      toolResult('b1', 'exit 1', { ts: at(14), isError: true, toolUseResult: 'Error: exit 1' })
    ]
    expect(snapAt(mk(lines), 20).tasks[0]).toMatchObject({ id: 1, state: 'failing', failingCount: 1 })
  })
  it('R-11 a TodoWrite-only session shows its todo list', () => {
    const lines = asst(1, [use('td1', 'TodoWrite', { todos: [{ content: 'step one', status: 'in_progress', activeForm: 'Doing one' }, { content: 'step two', status: 'pending', activeForm: 'x' }] })])
    expect(snapAt(mk(lines), 20).tasks.map((t: any) => [t.id, t.title, t.state])).toEqual([[1, 'step one', 'in_progress'], [2, 'step two', 'pending']])
  })
})

describe('R-12 Agent.spans', () => {
  it('R-12 the lead gets a read span from its tool_use / tool_result timestamps', () => {
    const m = mk([...asst(10, [use('r1', 'Read', { file_path: 'C:/Users/u/acme/a.ts' })]), toolResult('r1', 'file text', { ts: at(15) })])
    const spans = agent(snapAt(m, 30), 'lead').spans as any[]
    expect(spans).toEqual(expect.arrayContaining([{ kind: 'read', startMs: T(10), endMs: T(15) }]))
  })
  it('R-12 an open tool is an open span (endMs null); a failed one is an error span', () => {
    const m = mk([
      ...asst(10, [use('e1', 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' })]),
      ...asst(20, [use('b1', 'Bash', { command: 'x' })]),
      toolResult('b1', 'boom', { ts: at(22), isError: true, toolUseResult: 'Error: boom' })
    ])
    const spans = agent(snapAt(m, 30), 'lead').spans as any[]
    expect(spans).toEqual(expect.arrayContaining([{ kind: 'edit', startMs: T(10), endMs: null }, { kind: 'error', startMs: T(20), endMs: T(22) }]))
  })
  it('R-12 sub-agents get their own spans', () => {
    const m = mk([], [
      userPrompt('go', { ts: at(3), agentId: SUB, parentUuid: null }),
      ...asst(5, [use('s1', 'Grep', { pattern: 'x' })], { agentId: SUB }),
      toolResult('s1', 'hits', { ts: at(8), agentId: SUB })
    ])
    const snap = snapAt(m, 30)
    expect(agent(snap, SUB).spans).toEqual(expect.arrayContaining([{ kind: 'read', startMs: T(5), endMs: T(8) }]))
    expect((agent(snap, 'lead').spans as any[]).filter((s) => s.kind === 'read')).toEqual([])
  })
  it('R-12 spans are limited to the last 20 minutes of the snapshot clock', () => {
    const m = mk([...asst(10, [use('r1', 'Read', { file_path: 'a.ts' })]), toolResult('r1', 'x', { ts: at(12) })])
    expect(agent(snapAt(m, 10 + 25 * 60), 'lead').spans.filter((s: any) => s.kind === 'read')).toEqual([])
  })
  it('R-12 every agent has a spans array (possibly empty)', () => {
    const m = mk([], [userPrompt('go', { ts: at(3), agentId: SUB, parentUuid: null }), ...asst(5, [textBlock('hello')].map((b) => b), { agentId: SUB, stopReason: 'end_turn' })])
    for (const a of snapAt(m, 30).agents) expect(Array.isArray(a.spans)).toBe(true)
  })
})

describe('R-18 applyHook: needs-you overlay', () => {
  it('R-18 PermissionRequest sets hook.pendingPermission and returns true; derived status is needs-you / hook-permission', () => {
    const m = mk()
    expect(m.applyHook(hook('PermissionRequest', { toolName: 'Bash', receivedMs: T(40) }))).toBe(true)
    const a = agent(snapAt(m, 45), 'lead')
    expect(a.runtime.hook.pendingPermission).toEqual({ toolName: 'Bash', sinceMs: T(40) })
    expect(deriveLiveStatus(a.runtime, T(45))).toMatchObject({ status: 'needs-you', reason: 'hook-permission', detail: 'Bash' })
  })
  it('R-18 PreToolUse / PostToolUse / PostToolUseFailure / PermissionDenied / UserPromptSubmit / Stop / StopFailure / SessionEnd clear it', () => {
    for (const ev of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']) {
      const m = mk()
      m.applyHook(hook('PermissionRequest', { toolName: 'Bash', receivedMs: T(40) }))
      m.applyHook(hook(ev, { receivedMs: T(41) }))
      expect(agent(snapAt(m, 45), 'lead').runtime.hook?.pendingPermission, ev).toBeUndefined()
    }
  })
  it('R-18 Notification permission_prompt / agent_needs_input / elicitation_dialog set hook.notification', () => {
    for (const type of ['permission_prompt', 'agent_needs_input', 'elicitation_dialog']) {
      const m = mk()
      expect(m.applyHook(hook('Notification', { notificationType: type, receivedMs: T(40) }))).toBe(true)
      const a = agent(snapAt(m, 45), 'lead')
      expect(a.runtime.hook.notification).toEqual({ type, sinceMs: T(40) })
      expect(deriveLiveStatus(a.runtime, T(45))).toMatchObject({ status: 'needs-you', reason: 'hook-notification' })
    }
  })
  it('R-18 other notification types (idle_prompt, agent_completed) do not raise needs-you', () => {
    for (const type of ['idle_prompt', 'agent_completed', 'auth_success']) {
      const m = mk()
      m.applyHook(hook('Notification', { notificationType: type, receivedMs: T(40) }))
      const a = agent(snapAt(m, 45), 'lead')
      expect(a.runtime.hook?.notification, type).toBeUndefined()
    }
  })
  it('R-18 the notification is cleared by the next tool / stop event', () => {
    const m = mk()
    m.applyHook(hook('Notification', { notificationType: 'permission_prompt', receivedMs: T(40) }))
    m.applyHook(hook('PostToolUse', { receivedMs: T(42) }))
    expect(agent(snapAt(m, 45), 'lead').runtime.hook?.notification).toBeUndefined()
  })
  it('R-18 Stop and SessionEnd clear ALL agents; PostToolUse for one agent clears only that agent', () => {
    const subLines = [userPrompt('go', { ts: at(3), agentId: SUB, parentUuid: null })]
    const m = mk([], subLines)
    m.applyHook(hook('PermissionRequest', { toolName: 'Bash', receivedMs: T(40) }))
    m.applyHook(hook('PermissionRequest', { toolName: 'Write', agentId: SUB, receivedMs: T(41) }))
    m.applyHook(hook('PostToolUse', { agentId: SUB, receivedMs: T(42) }))
    let snap = snapAt(m, 45)
    expect(agent(snap, SUB).runtime.hook?.pendingPermission).toBeUndefined()
    expect(agent(snap, 'lead').runtime.hook.pendingPermission).toMatchObject({ toolName: 'Bash' })
    m.applyHook(hook('PermissionRequest', { toolName: 'Write', agentId: SUB, receivedMs: T(43) }))
    m.applyHook(hook('Stop', { receivedMs: T(44) }))
    snap = snapAt(m, 45)
    expect(agent(snap, SUB).runtime.hook?.pendingPermission).toBeUndefined()
    expect(agent(snap, 'lead').runtime.hook?.pendingPermission).toBeUndefined()
  })
})

describe('R-18 applyHook: routing and bookkeeping', () => {
  it('R-18 an event for a known sub-agent id lands on that sub-agent, not the lead', () => {
    const m = mk([], [userPrompt('go', { ts: at(3), agentId: SUB, parentUuid: null })])
    m.applyHook(hook('PermissionRequest', { toolName: 'Edit', agentId: SUB, receivedMs: T(40) }))
    const snap = snapAt(m, 45)
    expect(agent(snap, SUB).runtime.hook.pendingPermission).toMatchObject({ toolName: 'Edit' })
    expect(agent(snap, 'lead').runtime.hook?.pendingPermission).toBeUndefined()
  })
  it('R-18 an unknown agent id falls back to the lead (documented assumption)', () => {
    const m = mk()
    m.applyHook(hook('PermissionRequest', { toolName: 'Edit', agentId: 'nobody-knows', receivedMs: T(40) }))
    expect(agent(snapAt(m, 45), 'lead').runtime.hook.pendingPermission).toMatchObject({ toolName: 'Edit' })
  })
  it('R-18 SubagentStop marks that sub-agent finished', () => {
    const m = mk([], [userPrompt('go', { ts: at(3), agentId: SUB, parentUuid: null })])
    expect(agent(snapAt(m, 45), SUB).runtime.finished).toBeFalsy()
    expect(m.applyHook(hook('SubagentStop', { agentId: SUB, agentType: 'Explore', receivedMs: T(40) }))).toBe(true)
    expect(agent(snapAt(m, 45), SUB).runtime.finished).toBe(true)
  })
  it('R-18 events for another session id are ignored: false, no hook data, not dirty-changing', () => {
    const m = mk()
    const before = JSON.stringify(snapAt(m, 45))
    expect(m.applyHook(hook('PermissionRequest', { toolName: 'Bash', sessionId: OTHER_SESSION }))).toBe(false)
    expect(JSON.stringify(snapAt(m, 45))).toBe(before)
  })
  it('R-18 every event sets hook.lastEventMs and bumps lastActivityMs only when newer', () => {
    const m = mk()
    const base = agent(snapAt(m, 45), 'lead').runtime.lastActivityMs
    m.applyHook(hook('PreToolUse', { toolName: 'Read', receivedMs: base + 5000 }))
    let rt = agent(snapAt(m, 45), 'lead').runtime
    expect(rt.hook.lastEventMs).toBe(base + 5000)
    expect(rt.lastActivityMs).toBe(base + 5000)
    m.applyHook(hook('PreToolUse', { toolName: 'Read', receivedMs: base - 5000 }))
    rt = agent(snapAt(m, 45), 'lead').runtime
    expect(rt.lastActivityMs).toBe(base + 5000)
  })
  it('R-18 applyHook marks the model dirty so the service pushes a new snapshot', () => {
    const m = mk()
    m.snapshot(T(45))
    m.applyHook(hook('Notification', { notificationType: 'permission_prompt', receivedMs: T(40) }))
    expect(m.isDirty()).toBe(true)
  })
  it('R-18 snapshot.hooksActive is true only with a hook event in the last 10 minutes', () => {
    const m = mk()
    expect(snapAt(m, 45).hooksActive).toBeFalsy()
    m.applyHook(hook('PreToolUse', { receivedMs: T(40) }))
    expect(snapAt(m, 45).hooksActive).toBe(true)
    expect(snapAt(m, 40 + 9 * 60).hooksActive).toBe(true)
    expect(snapAt(m, 40 + 11 * 60).hooksActive).toBeFalsy()
  })
})
