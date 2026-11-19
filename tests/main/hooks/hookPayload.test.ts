// T04 / R-14: hook payload parser. Synthetic payloads (shapes from plan.md fact 10).
import { describe, expect, it } from 'vitest'
import { HOOK_EVENTS, parseHookPayload } from '../../../src/main/hooks/hookPayload'

const SID = '11111111-aaaa-4bbb-8ccc-000000000001'
const base = { session_id: SID, transcript_path: 'C:/Users/u/.claude/projects/x/y.jsonl', cwd: 'C:/Users/u/acme', permission_mode: 'default' }
const P = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({ ...base, hook_event_name, ...extra })
const NOW = 1_800_000_000_000

describe('R-14 HOOK_EVENTS', () => {
  it('R-14 lists the 16 verified events in D11 order', () => {
    expect([...HOOK_EVENTS]).toEqual([
      'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
      'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted'
    ])
  })
})

describe('R-14 parseHookPayload', () => {
  it.each([...['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted']])(
    'R-14 %s parses with the base fields',
    (name) => {
      const e = parseHookPayload(P(name), NOW)!
      expect(e).toMatchObject({ event: name, sessionId: SID, receivedMs: NOW, cwd: 'C:/Users/u/acme', permissionMode: 'default' })
    }
  )

  it('R-14 PreToolUse / PostToolUse carry tool name and id, never the input or response', () => {
    const e = parseHookPayload(P('PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'echo SECRET-VALUE' }, tool_response: { stdout: 'SECRET-OUT' } }), NOW)!
    expect(e).toMatchObject({ toolName: 'Bash', toolUseId: 'toolu_1' })
    expect(JSON.stringify(e)).not.toContain('SECRET')
  })
  it('R-14 PermissionRequest keeps the tool name only', () => {
    const e = parseHookPayload(P('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: 'C:/Users/u/acme/a.ts', content: 'SECRET-BODY' } }), NOW)!
    expect(e.toolName).toBe('Write')
    expect(JSON.stringify(e)).not.toContain('SECRET-BODY')
  })
  it('R-14 PostToolUseFailure keeps error and is_interrupt', () => {
    expect(parseHookPayload(P('PostToolUseFailure', { tool_name: 'Bash', error: 'exit 1', is_interrupt: true }), NOW)).toMatchObject({ error: 'exit 1', isInterrupt: true })
  })
  it('R-14 Notification keeps type and message', () => {
    expect(parseHookPayload(P('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash', title: 'x' }), NOW)).toMatchObject({
      notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash'
    })
  })
  it('R-14 sub-agent events carry agent id and type; SubagentStop drops transcript path and last message', () => {
    const e = parseHookPayload(P('SubagentStop', { agent_id: 'a1b2', agent_type: 'Explore', agent_transcript_path: 'C:/Users/u/.claude/x/agent-a1b2.jsonl', last_assistant_message: 'SECRET-LAST' }), NOW)!
    expect(e).toMatchObject({ agentId: 'a1b2', agentType: 'Explore' })
    const s = JSON.stringify(e)
    expect(s).not.toContain('SECRET-LAST')
    expect(s).not.toContain('agent-a1b2.jsonl')
  })
  it('R-14 TaskCreated / TaskCompleted / TeammateIdle fields', () => {
    expect(parseHookPayload(P('TaskCreated', { task_id: '3', task_subject: 'Write schema', teammate_name: 'rev' }), NOW)).toMatchObject({ taskId: '3', taskSubject: 'Write schema', teammateName: 'rev' })
    expect(parseHookPayload(P('TeammateIdle', { teammate_name: 'rev', team_name: 't' }), NOW)).toMatchObject({ teammateName: 'rev' })
  })
  it('R-14 SessionStart source and SessionEnd reason', () => {
    expect(parseHookPayload(P('SessionStart', { source: 'resume' }), NOW)).toMatchObject({ source: 'resume' })
    expect(parseHookPayload(P('SessionEnd', { reason: 'logout' }), NOW)).toMatchObject({ reason: 'logout' })
  })
  it('R-14 never copies prompt, transcript path, tool_input, tool_response or last_assistant_message', () => {
    const e = parseHookPayload(P('UserPromptSubmit', { prompt: 'SECRET-PROMPT', tool_input: { a: 'SECRET-IN' }, tool_response: 'SECRET-OUT', last_assistant_message: 'SECRET-LAST' }), NOW)!
    const s = JSON.stringify(e)
    for (const w of ['SECRET-PROMPT', 'SECRET-IN', 'SECRET-OUT', 'SECRET-LAST', 'transcript', '.jsonl']) expect(s).not.toContain(w)
  })
  it('R-14 strings are truncated at 300 chars', () => {
    const e = parseHookPayload(P('Notification', { message: 'm'.repeat(2000), notification_type: 'idle_prompt' }), NOW)!
    expect(e.message!.length).toBeLessThanOrEqual(301)
    expect(e.message!.length).toBeGreaterThan(200)
  })
  it('R-14 wrong field types are dropped, the event still parses', () => {
    const e = parseHookPayload(P('PreToolUse', { tool_name: 5, tool_use_id: {}, agent_id: [], is_interrupt: 'yes', cwd: 7 }), NOW)!
    expect(e.event).toBe('PreToolUse')
    expect(e.toolName).toBeUndefined()
    expect(e.toolUseId).toBeUndefined()
    expect(e.agentId).toBeUndefined()
    expect(e.isInterrupt).toBeUndefined()
    expect(e.cwd).toBeUndefined()
  })
  it('R-14 unknown event names, missing session_id and non-objects -> null', () => {
    expect(parseHookPayload(P('Whatever'), NOW)).toBeNull()
    expect(parseHookPayload({ hook_event_name: 'Stop' }, NOW)).toBeNull()
    expect(parseHookPayload({ ...base, session_id: 5, hook_event_name: 'Stop' }, NOW)).toBeNull()
    for (const v of [null, undefined, 'x', 3, [], true]) expect(parseHookPayload(v, NOW)).toBeNull()
  })
  it('R-14 never throws on hostile input', () => {
    const cyc: any = { ...base, hook_event_name: 'Stop' }
    cyc.self = cyc
    expect(() => parseHookPayload(cyc, NOW)).not.toThrow()
    const getter = { ...base, get hook_event_name(): string { throw new Error('boom') } }
    expect(() => parseHookPayload(getter, NOW)).not.toThrow()
    expect(parseHookPayload(getter, NOW)).toBeNull()
  })
})
