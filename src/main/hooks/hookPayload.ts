import type { HookEvent, HookEventName } from '../../shared/types'

export const HOOK_EVENTS: readonly HookEventName[] = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
  'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted'
]

const MAX = 300
const str = (v: unknown): string | undefined => (typeof v === 'string' ? (v.length > MAX ? v.slice(0, MAX) + '…' : v) : undefined)

// Maps only a fixed allow-list of fields. tool_input, tool_response, prompt, last_assistant_message and transcript paths are never copied.
const STRING_FIELDS: ReadonlyArray<[string, keyof HookEvent]> = [
  ['cwd', 'cwd'], ['agent_id', 'agentId'], ['agent_type', 'agentType'], ['permission_mode', 'permissionMode'],
  ['tool_name', 'toolName'], ['tool_use_id', 'toolUseId'], ['notification_type', 'notificationType'], ['message', 'message'],
  ['error', 'error'], ['task_id', 'taskId'], ['task_subject', 'taskSubject'], ['teammate_name', 'teammateName'],
  ['source', 'source'], ['reason', 'reason']
]

export function parseHookPayload(body: unknown, receivedMs: number): HookEvent | null {
  try {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const b = body as Record<string, unknown>
    const name = b.hook_event_name
    const sid = b.session_id
    if (typeof name !== 'string' || !(HOOK_EVENTS as readonly string[]).includes(name)) return null
    if (typeof sid !== 'string' || sid === '') return null
    const out: Record<string, unknown> = { event: name, sessionId: sid, receivedMs }
    for (const [from, to] of STRING_FIELDS) {
      const v = str(b[from])
      if (v !== undefined) out[to] = v
    }
    if (typeof b.is_interrupt === 'boolean') out.isInterrupt = b.is_interrupt
    return out as unknown as HookEvent
  } catch {
    return null
  }
}
