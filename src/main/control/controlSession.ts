// One controlled Claude Code session: child process, state machine, permission round-trip.
// R-19: nothing is spawned or written except as a direct consequence of send/answer/interrupt/setModel/setMode/stop
// (plus the automatic "unsupported" reply to unknown CLI control requests). No retries, no initialize, no keep-alive.
import type { ClaudeCommand } from '../pty/claudeBinary'
import { buildChildEnv } from '../pty/childEnv'
import type {
  ControlPermissionMode, ControlResume, ControlSessionInfo, ControlStreamEvent, ControlStreamState, OkResult, PermissionAnswer, PermissionPrompt
} from '../../shared/types'
import { buildControlArgs, MODEL_RE } from './args'
import {
  createLineSplitter, encodeAllow, encodeControlRequest, encodeDeny, encodeUnsupported, encodeUserTurn, inputPreview, parseOutputLine,
  sessionScopedSuggestions, type OutMsg
} from './protocol'

export interface ChildLike {
  pid?: number
  stdin: { write(s: string): boolean; end(): void }
  stdout: { on(ev: 'data', cb: (b: Buffer) => void): void }
  stderr: { on(ev: 'data', cb: (b: Buffer) => void): void }
  on(ev: 'exit', cb: (code: number | null) => void): void
  on(ev: 'error', cb: (e: Error) => void): void
  kill(): void
}
export type SpawnFn = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; windowsHide: true }) => ChildLike

export interface ControlSessionDeps {
  spawn: SpawnFn
  resolveClaude: () => ClaudeCommand | null
  baseEnv: Readonly<Record<string, string | undefined>>
  platform: NodeJS.Platform
  killTree: (pid: number) => Promise<void>
  now: () => Date
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
  nextRequestId: () => string
  emit: (e: ControlStreamEvent) => void
  changed: () => void
}

export interface ControlSessionInit {
  id: string
  cwd: string
  accountId: string
  configDirAbs: string | null
  model?: string
  permissionMode: ControlPermissionMode
  resume?: ControlResume
}

export interface ControlSession {
  readonly id: string
  info(): ControlSessionInfo
  streamState(): ControlStreamState
  send(text: string): Promise<OkResult>
  interrupt(): OkResult
  answer(requestId: string, a: PermissionAnswer): OkResult
  setModel(model: string | null): OkResult
  setMode(mode: ControlPermissionMode): OkResult
  stop(): Promise<OkResult>
  dispose(): void
}

const MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']
const STOP_GRACE_MS = 3000
const ERROR_MAX = 2048
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

interface Pending { prompt: PermissionPrompt; input: Record<string, unknown>; suggestions: unknown[] }
type EvBody = ControlStreamEvent extends infer E ? (E extends unknown ? Omit<E, 'controlId'> : never) : never

export function createControlSession(deps: ControlSessionDeps, init: ControlSessionInit): ControlSession {
  const s = {
    state: 'draft' as ControlSessionInfo['state'],
    model: init.model,
    mode: init.permissionMode,
    pid: undefined as number | undefined,
    sessionId: undefined as string | undefined,
    startedAt: undefined as string | undefined,
    exitCode: undefined as number | undefined,
    error: undefined as string | undefined,
    slashCommands: [] as string[],
    lastResult: undefined as ControlSessionInfo['lastResult'],
    outstanding: 0,
    interrupted: false,
    typing: undefined as { messageId: string; text: string } | undefined,
    currentMessageId: undefined as string | undefined,
    thinking: false,
    notices: [] as { level: 'info' | 'error'; text: string; time: string }[]
  }
  const pending = new Map<string, Pending>()
  let child: ChildLike | null = null
  let stderrBuf = ''
  let startWaiter: ((r: OkResult) => void) | null = null
  let stopWaiters: ((r: OkResult) => void)[] = []
  let stopTimer: unknown = null
  let stopPromise: Promise<OkResult> | null = null

  const info = (): ControlSessionInfo => {
    const i: ControlSessionInfo = {
      id: init.id, accountId: init.accountId, cwd: init.cwd, state: s.state, permissionMode: s.mode,
      slashCommands: [...s.slashCommands], pendingPermissions: pending.size, queuedTurns: Math.max(0, s.outstanding - 1)
    }
    if (s.model !== undefined) i.model = s.model
    if (init.resume) i.resume = init.resume
    if (s.pid !== undefined) i.pid = s.pid
    if (s.sessionId !== undefined) i.sessionId = s.sessionId
    if (s.startedAt !== undefined) i.startedAt = s.startedAt
    if (s.exitCode !== undefined) i.exitCode = s.exitCode
    if (s.error !== undefined) i.error = s.error
    if (s.lastResult !== undefined) i.lastResult = s.lastResult
    return i
  }
  const ev = (e: EvBody): void => deps.emit({ controlId: init.id, ...e } as ControlStreamEvent)
  const notice = (level: 'info' | 'error', text: string): void => {
    s.notices.push({ level, text, time: deps.now().toISOString() })
    if (s.notices.length > 50) s.notices.shift()
    ev({ kind: 'notice', level, text })
  }
  const write = (data: string): boolean => {
    if (!child) return false
    try {
      child.stdin.write(data)
      return true
    } catch {
      return false
    }
  }
  const live = (): boolean => child !== null && (s.state === 'starting' || s.state === 'idle' || s.state === 'busy')
  const clearTyping = (): void => {
    s.typing = undefined
    s.currentMessageId = undefined
    ev({ kind: 'typing-clear' })
  }
  const setThinking = (active: boolean): void => {
    if (s.thinking === active) return
    s.thinking = active
    ev({ kind: 'thinking', active })
  }

  const finish = (code: number | null, errText?: string): void => {
    if (s.state === 'exited') return
    if (stopTimer !== null) {
      deps.clearTimer(stopTimer)
      stopTimer = null
    }
    const wasStopping = s.state === 'stopping'
    child = null
    s.state = 'exited'
    s.pid = undefined
    s.outstanding = 0
    s.interrupted = false
    if (code !== null) s.exitCode = code
    if (errText !== undefined) s.error = errText
    else if (code !== null && code !== 0 && !wasStopping) {
      const t = stderrBuf.replace(ANSI_RE, '').trim()
      if (t !== '') s.error = t.slice(-ERROR_MAX)
    }
    if (pending.size > 0) {
      for (const id of [...pending.keys()]) ev({ kind: 'permission-resolved', requestId: id })
      pending.clear()
    }
    s.typing = undefined
    s.thinking = false
    ev({ kind: 'typing-clear' })
    if (errText === undefined) {
      if (code !== null && code !== 0 && !wasStopping) notice('error', `Session exited with code ${code}`)
      else notice('info', 'Session ended')
    }
    if (startWaiter) {
      const w = startWaiter
      startWaiter = null
      w({ ok: false, reason: 'exited' })
    }
    const ws = stopWaiters
    stopWaiters = []
    stopPromise = null
    for (const w of ws) w({ ok: true })
    deps.changed()
  }

  const onMessage = (m: OutMsg): void => {
    switch (m.t) {
      case 'init': {
        if (m.sessionId !== '') s.sessionId = m.sessionId
        if (m.model !== undefined && MODEL_RE.test(m.model)) s.model = m.model
        s.slashCommands = m.slashCommands
        if (s.state === 'starting') s.state = s.outstanding > 0 ? 'busy' : 'idle'
        if (startWaiter) {
          const w = startWaiter
          startWaiter = null
          w({ ok: true })
        }
        deps.changed()
        break
      }
      case 'status':
        if (m.status === 'requesting' && s.state === 'idle') {
          s.state = 'busy'
          deps.changed()
        }
        break
      case 'message-start':
        if (m.parentToolUseId === null) {
          s.currentMessageId = m.messageId
          s.typing = undefined
        }
        break
      case 'block-start':
        if (m.parentToolUseId === null) {
          if (m.messageId !== undefined) s.currentMessageId = m.messageId
          setThinking(m.blockType === 'thinking' || m.blockType === 'redacted_thinking')
        }
        break
      case 'delta': {
        if (m.parentToolUseId !== null || m.kind !== 'text') break
        const messageId = m.messageId ?? s.currentMessageId ?? ''
        s.typing = { messageId, text: (s.typing && s.typing.messageId === messageId ? s.typing.text : '') + m.text }
        ev({ kind: 'typing', messageId, text: s.typing.text })
        break
      }
      case 'message-stop':
        if (m.parentToolUseId === null) setThinking(false)
        break
      case 'assistant':
        if (m.parentToolUseId === null) {
          setThinking(false)
          clearTyping()
        }
        break
      case 'result': {
        if (m.sessionId !== undefined && m.sessionId !== '') s.sessionId = m.sessionId
        setThinking(false)
        clearTyping()
        s.outstanding = Math.max(0, s.outstanding - 1)
        const result: 'success' | 'interrupted' | 'error' =
          s.interrupted && m.subtype === 'error_during_execution' ? 'interrupted' : m.isError ? 'error' : 'success'
        s.interrupted = false
        s.lastResult = result
        const e: Extract<EvBody, { kind: 'turn-end' }> = { kind: 'turn-end', result, denials: m.denials }
        if (m.text !== undefined) e.text = m.text
        if (m.costUsd !== undefined) e.costUsd = m.costUsd
        ev(e)
        if (s.state === 'busy' || s.state === 'idle') s.state = s.outstanding > 0 ? 'busy' : 'idle'
        deps.changed()
        break
      }
      case 'can-use-tool': {
        const suggestions = sessionScopedSuggestions(m.suggestions)
        const prompt: PermissionPrompt = {
          requestId: m.requestId, toolName: m.toolName, displayName: m.displayName, inputPreview: inputPreview(m.toolName, m.input),
          receivedAt: deps.now().toISOString(), canAllowSession: suggestions.length > 0
        }
        if (m.toolUseId !== undefined) prompt.toolUseId = m.toolUseId
        if (m.description !== undefined) prompt.description = m.description
        if (m.decisionReason !== undefined) prompt.decisionReason = m.decisionReason
        if (m.blockedPath !== undefined) prompt.blockedPath = m.blockedPath
        pending.set(m.requestId, { prompt, input: m.input, suggestions: m.suggestions })
        ev({ kind: 'permission', prompt })
        deps.changed()
        break
      }
      case 'control-request':
        write(encodeUnsupported(m.requestId, m.subtype))
        break
      default:
        break
    }
  }

  const attach = (c: ChildLike): void => {
    const splitter = createLineSplitter((line) => {
      if (child !== c) return
      const m = parseOutputLine(line)
      if (m) onMessage(m)
    })
    c.stdout.on('data', (b) => {
      if (child === c) splitter.push(b)
    })
    c.stderr.on('data', (b) => {
      if (child !== c) return
      stderrBuf = (stderrBuf + b.toString('utf8')).slice(-ERROR_MAX * 2)
    })
    c.on('exit', (code) => {
      if (child !== c) return
      splitter.end()
      finish(code)
    })
    c.on('error', (e) => {
      if (child !== c) return
      notice('error', `Process error: ${e.message}`)
      finish(null, e.message)
    })
  }

  const spawnChild = (): OkResult => {
    const cmd = deps.resolveClaude()
    if (!cmd) return { ok: false, reason: 'claude-not-found' }
    const resume: ControlResume | undefined = s.sessionId !== undefined ? { kind: 'resume', sessionId: s.sessionId } : init.resume
    const args = buildControlArgs({ ...(s.model !== undefined ? { model: s.model } : {}), permissionMode: s.mode, ...(resume ? { resume } : {}) })
    if (!args) return { ok: false, reason: 'invalid-args' }
    let env: Record<string, string>
    try {
      env = buildChildEnv(deps.baseEnv, { configDirAbs: init.configDirAbs, platform: deps.platform })
    } catch {
      return { ok: false, reason: 'invalid-args' }
    }
    let c: ChildLike
    try {
      c = deps.spawn(cmd.file, [...cmd.argsPrefix, ...args], { cwd: init.cwd, env, windowsHide: true })
    } catch (e) {
      return { ok: false, reason: `spawn-failed: ${(e as Error).message}` }
    }
    child = c
    stderrBuf = ''
    s.state = 'starting'
    s.pid = c.pid
    s.startedAt = deps.now().toISOString()
    s.exitCode = undefined
    s.error = undefined
    s.lastResult = undefined
    s.outstanding = 0
    s.interrupted = false
    attach(c)
    return { ok: true }
  }

  const send = (text: string): Promise<OkResult> => {
    if (s.state === 'stopping') return Promise.resolve({ ok: false, reason: 'stopping' })
    let waitInit = false
    if (s.state === 'draft' || s.state === 'exited') {
      const r = spawnChild()
      if (!r.ok) return Promise.resolve(r)
      waitInit = true
    }
    if (!write(encodeUserTurn(text))) return Promise.resolve({ ok: false, reason: 'write-failed' })
    s.outstanding++
    if (s.state === 'idle') s.state = 'busy'
    deps.changed()
    if (!waitInit) return Promise.resolve({ ok: true })
    return new Promise<OkResult>((resolve) => {
      startWaiter = resolve
    })
  }

  const interrupt = (): OkResult => {
    if (s.state !== 'busy') return { ok: false, reason: 'not-busy' }
    if (!write(encodeControlRequest(deps.nextRequestId(), { subtype: 'interrupt' }))) return { ok: false, reason: 'write-failed' }
    s.interrupted = true
    return { ok: true }
  }

  const answer = (requestId: string, a: PermissionAnswer): OkResult => {
    const p = pending.get(requestId)
    if (!p) return { ok: false, reason: 'unknown-request' }
    if (!live()) return { ok: false, reason: 'not-running' }
    let frame: string
    if (a.behavior === 'allow') {
      if (a.scope === 'session') {
        const rules = sessionScopedSuggestions(p.suggestions)
        if (rules.length === 0) return { ok: false, reason: 'no-session-rule' }
        frame = encodeAllow(requestId, p.input, rules)
      } else frame = encodeAllow(requestId, p.input)
    } else frame = encodeDeny(requestId, a.message ?? 'Denied in Agent Console')
    if (!write(frame)) return { ok: false, reason: 'write-failed' }
    pending.delete(requestId)
    ev({ kind: 'permission-resolved', requestId })
    deps.changed()
    return { ok: true }
  }

  const setModel = (model: string | null): OkResult => {
    if (model !== null && (!MODEL_RE.test(model) || model.startsWith('-'))) return { ok: false, reason: 'invalid-args' }
    if (s.state === 'stopping') return { ok: false, reason: 'stopping' }
    if (live() && !write(encodeControlRequest(deps.nextRequestId(), { subtype: 'set_model', model }))) return { ok: false, reason: 'write-failed' }
    s.model = model ?? undefined
    deps.changed()
    return { ok: true }
  }

  const setMode = (mode: ControlPermissionMode): OkResult => {
    if (!MODES.includes(mode)) return { ok: false, reason: 'invalid-args' }
    if (s.state === 'stopping') return { ok: false, reason: 'stopping' }
    if (live() && !write(encodeControlRequest(deps.nextRequestId(), { subtype: 'set_permission_mode', mode }))) return { ok: false, reason: 'write-failed' }
    s.mode = mode
    deps.changed()
    return { ok: true }
  }

  const killNow = (c: ChildLike): void => {
    if (c.pid !== undefined) {
      const done = (): void => {
        if (child === c) finish(null)
      }
      void deps.killTree(c.pid).then(done, done)
    } else {
      try {
        c.kill()
      } catch {
        /* ignore */
      }
      if (child === c) finish(null)
    }
  }

  const stop = (): Promise<OkResult> => {
    if (s.state === 'stopping' && stopPromise) return stopPromise
    if (s.state === 'draft' || s.state === 'exited' || !child) return Promise.resolve({ ok: true })
    const c = child
    for (const id of [...pending.keys()]) {
      write(encodeDeny(id, 'Session stopped'))
      pending.delete(id)
      ev({ kind: 'permission-resolved', requestId: id })
    }
    if (s.state === 'busy') write(encodeControlRequest(deps.nextRequestId(), { subtype: 'interrupt' }))
    s.state = 'stopping'
    try {
      c.stdin.end()
    } catch {
      /* ignore */
    }
    stopTimer = deps.setTimer(() => {
      stopTimer = null
      if (child === c) killNow(c)
    }, STOP_GRACE_MS)
    deps.changed()
    stopPromise = new Promise<OkResult>((resolve) => stopWaiters.push(resolve))
    return stopPromise
  }

  const dispose = (): void => {
    if (child) killNow(child)
  }

  return {
    id: init.id,
    info,
    streamState: () => ({
      controlId: init.id,
      ...(s.typing ? { typing: { ...s.typing } } : {}),
      thinking: s.thinking,
      permissions: [...pending.values()].map((p) => p.prompt),
      notices: s.notices.map((n) => ({ ...n }))
    }),
    send, interrupt, answer, setModel, setMode, stop, dispose
  }
}
