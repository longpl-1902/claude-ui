// Test helper for T07: a fake stream-json child process, a manual timer queue and a manager factory.
// Nothing here spawns a real process. Lines are hand-written from plan.md facts 3-6 (synthetic ids).
import { vi } from 'vitest'
import { createControlManager } from '../../../src/main/control/controlManager'

export const SID = '11111111-aaaa-4bbb-8ccc-000000000001'
export const SID2 = '22222222-aaaa-4bbb-8ccc-000000000002'

export interface FakeChild {
  pid: number
  /** Raw stdin strings written, in order. */
  writes: string[]
  /** Parsed stdin frames. */
  frames(): any[]
  stdinEnded: boolean
  killed: number
  emit(obj: unknown): void
  emitRaw(data: string | Buffer): void
  emitStderr(text: string): void
  exit(code: number | null): void
  fail(err: Error): void
  /** The object handed to the manager (ChildLike). */
  child: any
}

export function createFakeChild(pid: number): FakeChild {
  const out: ((b: Buffer) => void)[] = []
  const err: ((b: Buffer) => void)[] = []
  const exitCbs: ((c: number | null) => void)[] = []
  const errCbs: ((e: Error) => void)[] = []
  const f: FakeChild = {
    pid,
    writes: [],
    stdinEnded: false,
    killed: 0,
    frames: () => f.writes.flatMap((w) => w.split('\n').filter(Boolean)).map((l) => JSON.parse(l)),
    emit: (o) => out.forEach((cb) => cb(Buffer.from(JSON.stringify(o) + '\n'))),
    emitRaw: (d) => out.forEach((cb) => cb(typeof d === 'string' ? Buffer.from(d) : d)),
    emitStderr: (t) => err.forEach((cb) => cb(Buffer.from(t))),
    exit: (c) => exitCbs.forEach((cb) => cb(c)),
    fail: (e) => errCbs.forEach((cb) => cb(e)),
    child: undefined
  }
  f.child = {
    pid,
    stdin: { write: (s: string) => (f.writes.push(s), true), end: () => void (f.stdinEnded = true) },
    stdout: { on: (_ev: string, cb: (b: Buffer) => void) => void out.push(cb) },
    stderr: { on: (_ev: string, cb: (b: Buffer) => void) => void err.push(cb) },
    on: (ev: string, cb: any) => void (ev === 'exit' ? exitCbs.push(cb) : errCbs.push(cb)),
    kill: () => void f.killed++
  }
  return f
}

// ---- message builders (CLI stdout) ----
export const initMsg = (sessionId = SID, extra: Record<string, unknown> = {}) => ({
  type: 'system', subtype: 'init', session_id: sessionId, cwd: 'C:/Users/u/acme', model: 'claude-test-opus', permissionMode: 'default',
  tools: ['Read', 'Bash'], slash_commands: ['compact', 'review'], claude_code_version: '0.0.0-test', ...extra
})
export const statusMsg = () => ({ type: 'system', subtype: 'status', status: 'requesting', session_id: SID })
export const resultMsg = (o: { subtype?: string; isError?: boolean; text?: string; denials?: number; cost?: number } = {}) => ({
  type: 'result', subtype: o.subtype ?? 'success', is_error: o.isError ?? false, result: o.text ?? 'Done.', session_id: SID, stop_reason: 'end_turn',
  total_cost_usd: o.cost ?? 0.01, usage: {}, num_turns: 1, permission_denials: Array.from({ length: o.denials ?? 0 }, () => ({ tool_name: 'Bash' }))
})
export const assistantMsg = (id = 'msg_1', text = 'Hello') => ({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: SID })
export const se = (event: unknown, parent: string | null = null) => ({ type: 'stream_event', event, parent_tool_use_id: parent, api_message_id: 'msg_1', session_id: SID })
export const messageStart = (id = 'msg_1', parent: string | null = null) => se({ type: 'message_start', message: { id, role: 'assistant' } }, parent)
export const textStart = (index = 0, parent: string | null = null) => se({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, parent)
export const thinkingStart = (index = 0) => se({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } })
export const textDelta = (text: string, index = 0, parent: string | null = null) => se({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }, parent)
export const canUseTool = (requestId = 'req_1', o: { tool?: string; input?: Record<string, unknown>; suggestions?: unknown[]; reason?: string } = {}) => ({
  type: 'control_request', request_id: requestId,
  request: {
    subtype: 'can_use_tool', tool_name: o.tool ?? 'Bash', display_name: o.tool ?? 'Bash', input: o.input ?? { command: 'npm test' }, tool_use_id: 'toolu_1',
    description: 'Run the tests', ...(o.suggestions ? { permission_suggestions: o.suggestions } : {}), ...(o.reason ? { decision_reason: o.reason } : {})
  }
})

export interface Harness {
  mgr: ReturnType<typeof createControlManager>
  children: FakeChild[]
  spawnCalls: { file: string; args: string[]; opts: any }[]
  killTree: ReturnType<typeof vi.fn>
  /** Fire due timers after moving the clock forward. */
  advance(ms: number): void
  pendingTimers(): number
  /** Let queued microtasks / setImmediate callbacks run. */
  settle(): Promise<void>
  /** Flush the 50 ms stream batch. */
  flush(): void
  streams: any[][]
  changes: any[][]
  lastChild(): FakeChild
}

export function createHarness(over: Record<string, unknown> = {}): Harness {
  let nowMs = Date.parse('2026-11-19T10:00:00.000Z')
  let timerSeq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const children: FakeChild[] = []
  const spawnCalls: Harness['spawnCalls'] = []
  const killTree = vi.fn(async (_pid: number) => {})
  let idSeq = 0
  const deps: any = {
    spawn: (file: string, args: string[], opts: unknown) => {
      spawnCalls.push({ file, args, opts })
      const c = createFakeChild(4000 + children.length)
      children.push(c)
      return c.child
    },
    resolveClaude: () => ({ file: 'C:/Users/u/AppData/Roaming/npm/claude.exe', argsPrefix: [], via: 'exe' }),
    baseEnv: { PATH: 'C:/bin', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: 'C:/Users/u/.claude-parent', ELECTRON_RUN_AS_NODE: '1' },
    platform: 'win32',
    killTree,
    now: () => new Date(nowMs),
    newId: () => `c${++idSeq}`,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++timerSeq
      timers.set(id, { at: nowMs + ms, fn })
      return id
    },
    clearTimer: (t: unknown) => void timers.delete(t as number),
    ...over
  }
  const mgr = createControlManager(deps)
  const streams: any[][] = []
  const changes: any[][] = []
  mgr.onStream((e: any[]) => void streams.push(e))
  mgr.onChanged((l: any[]) => void changes.push(l))
  const advance = (ms: number): void => {
    const target = nowMs + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      nowMs = Math.max(nowMs, due[1].at)
      due[1].fn()
    }
    nowMs = target
  }
  return {
    mgr, children, spawnCalls, killTree, advance, streams, changes,
    pendingTimers: () => timers.size,
    settle: async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)) },
    flush: () => advance(60),
    lastChild: () => children[children.length - 1]!
  }
}

export const DRAFT = { cwd: 'C:/Users/u/acme', accountId: 'acme', configDirAbs: 'C:/Users/u/.claude-acme', permissionMode: 'default' as const }

/** Create a draft, send the first message and answer with `system/init`; returns the live child. */
export async function startSession(h: Harness, over: Record<string, unknown> = {}, text = 'hello') {
  const info = h.mgr.create({ ...DRAFT, ...over } as never)
  const p = h.mgr.send(info.id, text)
  await h.settle()
  const child = h.lastChild()
  child.emit(initMsg(over.sessionId as string | undefined ?? SID))
  child.emit(statusMsg())
  const r = await p
  h.flush()
  return { id: info.id, child, sendResult: r }
}
