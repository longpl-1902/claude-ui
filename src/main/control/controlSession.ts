// One controlled Claude Code session: child process, state machine, permission round-trip, control requests.
// R-19: the process is spawned, and a user frame written, only from send/sendRich (the user's Send). Inside a running
// session the app also sends LOCAL control requests (initialize, mcp_status, get_context_usage, ...); none of them makes
// a model call. No retries, no keep-alive, no prompt suggestions.
import type { ClaudeCommand } from '../pty/claudeBinary'
import { buildChildEnv } from '../pty/childEnv'
import type {
  ContextUsage, ControlDetails, ControlPermissionMode, ControlResume, ControlSessionInfo, ControlStreamEvent, ControlStreamState, Effort,
  FileSuggestion, ImageAttachment, McpLiveStatus, McpServerLive, OkResult, PermissionAnswer, PermissionPrompt, RewindPreview, SlashCommandInfo, TurnCost
} from '../../shared/types'
import { buildControlArgs, CHECKPOINT_ENV, EFFORTS, MODEL_RE, OUTPUT_STYLE_RE } from './args'
import {
  commandSource, createLineSplitter, encodeAllow, encodeAllowWithAnswers, encodeControlRequest, encodeDeny, encodeRequest, encodeUnsupported,
  encodeUserTurn, encodeUserTurnRich, inputPreview, parseContextUsage, parseFileSuggestions, parseInitializeResponse,
  parseMcpStatus, parseOutputLine, parsePlan, parseRewind, sessionScopedSuggestions, type CommandInfo, type CtlReq, type OutMsg
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
  /** Throttled (250 ms) push of the session details. */
  onDetails?: (d: ControlDetails) => void
}

export interface ControlSessionInit {
  id: string
  cwd: string
  accountId: string
  configDirAbs: string | null
  model?: string
  permissionMode: ControlPermissionMode
  resume?: ControlResume
  effort?: Effort
  outputStyle?: string
  /** Fork point (user message uuid); only used with resume.fork on the first spawn. */
  resumeAt?: string
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
  /** Generic control request with correlation. Resolves with the response body; rejects on error, timeout or exit. */
  request(req: CtlReq, timeoutMs?: number): Promise<unknown>
  details(): ControlDetails
  sendRich(text: string, images: ImageAttachment[]): Promise<OkResult>
  refreshContext(): Promise<OkResult>
  mcpToggle(name: string, enabled: boolean): Promise<OkResult>
  mcpReconnect(name: string): Promise<OkResult>
  fileSuggestions(query: string): Promise<FileSuggestion[] | null>
  rewindPreview(uuid: string): Promise<RewindPreview>
  rewind(uuid: string): Promise<OkResult>
  setEffort(effort: Effort | null): Promise<OkResult>
  setOutputStyle(style: string | null): Promise<OkResult>
  rename(title: string): Promise<OkResult>
  getPlan(): Promise<{ exists: boolean; content?: string }>
}

const MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']
const STOP_GRACE_MS = 3000
const ERROR_MAX = 2048
export const REQUEST_TIMEOUT_MS = 10_000
const DETAILS_THROTTLE_MS = 250
const MAX_USER_TURNS = 200
const MAX_IMAGES = 5
const MCP_STATUSES: readonly string[] = ['connected', 'failed', 'needs-auth', 'pending', 'disabled']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_RUNNING: OkResult = { ok: false, reason: 'not-running' }
const asMcpStatus = (v: string): McpLiveStatus => (MCP_STATUSES.includes(v) ? (v as McpLiveStatus) : 'pending')
const toSlash = (c: CommandInfo): SlashCommandInfo => {
  const e: SlashCommandInfo = { name: c.name, description: c.description, source: commandSource(c) }
  if (c.argumentHint !== undefined) e.argumentHint = c.argumentHint
  if (c.aliases !== undefined) e.aliases = c.aliases
  return e
}
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
    notices: [] as { level: 'info' | 'error'; text: string; time: string }[],
    effort: init.effort,
    outputStyle: init.outputStyle,
    commands: [] as SlashCommandInfo[],
    agents: [] as ControlDetails['agents'],
    models: [] as ControlDetails['models'],
    availableOutputStyles: [] as string[],
    mcp: [] as McpServerLive[],
    tools: [] as string[],
    context: undefined as ContextUsage | undefined,
    lastTurn: undefined as TurnCost | undefined,
    sessionCostUsd: 0,
    userTurns: [] as ControlDetails['userTurns'],
    title: undefined as string | undefined
  }
  const waiters = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: unknown }>()
  const previewed = new Set<string>()
  let mcpAsked = false
  let detailsTimer: unknown = null
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

  const details = (): ControlDetails => {
    const d: ControlDetails = {
      controlId: init.id,
      commands: s.commands.map((c) => ({ ...c })),
      agents: s.agents.map((a) => ({ ...a })),
      models: s.models.map((m) => ({ ...m })),
      availableOutputStyles: [...s.availableOutputStyles],
      mcp: s.mcp.map((m) => ({ ...m })),
      tools: [...s.tools],
      sessionCostUsd: s.sessionCostUsd,
      userTurns: s.userTurns.map((u) => ({ ...u })),
      checkpointing: true
    }
    if (s.outputStyle !== undefined) d.outputStyle = s.outputStyle
    if (s.effort !== undefined) d.effort = s.effort
    if (s.context) d.context = { ...s.context, categories: s.context.categories.map((c) => ({ ...c })) }
    if (s.lastTurn) d.lastTurn = { ...s.lastTurn }
    if (s.title !== undefined) d.title = s.title
    return d
  }
  const touchDetails = (): void => {
    if (detailsTimer !== null || !deps.onDetails) return
    detailsTimer = deps.setTimer(() => {
      detailsTimer = null
      deps.onDetails?.(details())
    }, DETAILS_THROTTLE_MS)
  }

  /** Control request with correlation by request id (ac-<n>). Never makes a model call by itself. */
  const request = (req: CtlReq, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> => {
    if (!live()) return Promise.reject(new Error('not-running'))
    const id = deps.nextRequestId()
    return new Promise<unknown>((resolve, reject) => {
      const timer = deps.setTimer(() => {
        if (waiters.delete(id)) reject(new Error('timeout'))
      }, timeoutMs)
      waiters.set(id, { resolve, reject, timer })
      if (!write(encodeRequest(id, req))) {
        deps.clearTimer(timer)
        waiters.delete(id)
        reject(new Error('write-failed'))
      }
    })
  }
  const settle = (id: string, ok: boolean, body: unknown, error: string | undefined): void => {
    const w = waiters.get(id)
    if (!w) return
    waiters.delete(id)
    deps.clearTimer(w.timer)
    if (ok) w.resolve(body)
    else w.reject(new Error(error ?? 'error'))
  }
  const asOk = (p: Promise<unknown>, after?: (body: unknown) => void): Promise<OkResult> =>
    p.then(
      (body) => {
        after?.(body)
        return { ok: true } as OkResult
      },
      (e: unknown) => ({ ok: false, reason: e instanceof Error ? e.message : 'failed' }) as OkResult
    )
  const quiet = (p: Promise<unknown>, then: (body: unknown) => void): void => {
    p.then(then, () => undefined)
  }

  const refreshMcp = (): void =>
    quiet(request({ subtype: 'mcp_status' }), (body) => {
      s.mcp = parseMcpStatus(body).map((m): McpServerLive => {
        const e: McpServerLive = { name: m.name, status: asMcpStatus(m.status) }
        if (m.serverInfo) e.serverInfo = m.serverInfo
        if (m.error !== undefined) e.error = m.error
        return e
      })
      touchDetails()
    })
  const fetchContext = (): Promise<OkResult> =>
    asOk(request({ subtype: 'get_context_usage' }), (body) => {
      const u = parseContextUsage(body)
      if (u) {
        s.context = { ...u, fetchedAt: deps.now().toISOString() }
        touchDetails()
      }
    })

  const finish = (code: number | null, errText?: string): void => {
    if (s.state === 'exited') return
    for (const [id, w] of [...waiters]) {
      waiters.delete(id)
      deps.clearTimer(w.timer)
      w.reject(new Error('exited'))
    }
    mcpAsked = false
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
        if (!mcpAsked && live()) {
          mcpAsked = true
          refreshMcp()
        }
        touchDetails()
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
        const turn: TurnCost = {
          input: m.usage?.inputTokens ?? 0, output: m.usage?.outputTokens ?? 0,
          cacheCreation: m.usage?.cacheCreationTokens ?? 0, cacheRead: m.usage?.cacheReadTokens ?? 0
        }
        if (m.costUsd !== undefined) {
          turn.costUsd = m.costUsd
          s.sessionCostUsd += m.costUsd
        }
        if (m.durationMs !== undefined) turn.durationMs = m.durationMs
        s.lastTurn = turn
        touchDetails()
        if (live()) void fetchContext()
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
      case 'control-response':
        settle(m.requestId, m.ok, m.body, m.error)
        break
      case 'commands':
        s.commands = m.commands.map(toSlash)
        touchDetails()
        break
      case 'user-echo':
        if (!s.userTurns.some((u) => u.uuid === m.uuid)) {
          s.userTurns.push({ uuid: m.uuid, text: m.text.slice(0, 120), time: deps.now().toISOString() })
          if (s.userTurns.length > MAX_USER_TURNS) s.userTurns.shift()
          touchDetails()
        }
        break
      default:
        break
    }
  }

  /** tools and mcp_servers of system/init (the typed parser keeps only the slash command names). */
  const readInitExtras = (line: string): void => {
    try {
      const o: unknown = JSON.parse(line)
      if (typeof o !== 'object' || o === null) return
      const r = o as Record<string, unknown>
      if (Array.isArray(r.tools)) s.tools = r.tools.filter((x): x is string => typeof x === 'string')
      if (Array.isArray(r.mcp_servers)) {
        const known = new Set(s.mcp.map((x) => x.name))
        for (const e of r.mcp_servers) {
          if (typeof e !== 'object' || e === null) continue
          const { name, status } = e as { name?: unknown; status?: unknown }
          if (typeof name !== 'string' || name === '' || known.has(name)) continue
          s.mcp.push({ name, status: asMcpStatus(typeof status === 'string' ? status : 'pending') })
        }
      }
    } catch {
      /* tolerant */
    }
  }

  const attach = (c: ChildLike): void => {
    const splitter = createLineSplitter((line) => {
      if (child !== c) return
      const m = parseOutputLine(line)
      if (m) {
        if (m.t === 'init') readInitExtras(line)
        onMessage(m)
      }
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
    const args = buildControlArgs({
      ...(s.model !== undefined ? { model: s.model } : {}),
      permissionMode: s.mode,
      ...(s.effort !== undefined ? { effort: s.effort } : {}),
      ...(s.outputStyle !== undefined ? { outputStyle: s.outputStyle } : {}),
      ...(resume ? { resume } : {}),
      ...(s.sessionId === undefined && init.resumeAt !== undefined ? { resumeAt: init.resumeAt } : {})
    })
    if (!args) return { ok: false, reason: 'invalid-args' }
    let env: Record<string, string>
    try {
      env = { ...buildChildEnv(deps.baseEnv, { configDirAbs: init.configDirAbs, platform: deps.platform }), [CHECKPOINT_ENV]: '1' }
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

  const sendFrame = (frame: string): Promise<OkResult> => {
    if (s.state === 'stopping') return Promise.resolve({ ok: false, reason: 'stopping' })
    let waitInit = false
    if (s.state === 'draft' || s.state === 'exited') {
      const r = spawnChild()
      if (!r.ok) return Promise.resolve(r)
      waitInit = true
      // Local request (no model call) written before the user turn; fills commands / models / output styles.
      quiet(request({ subtype: 'initialize' }), (body) => {
        const r2 = parseInitializeResponse(body)
        s.commands = r2.commands.map(toSlash)
        s.agents = r2.agents
        s.models = r2.models
        s.availableOutputStyles = r2.availableOutputStyles
        if (r2.outputStyle !== undefined && s.outputStyle === undefined) s.outputStyle = r2.outputStyle
        touchDetails()
      })
    }
    if (!write(frame)) return Promise.resolve({ ok: false, reason: 'write-failed' })
    s.outstanding++
    if (s.state === 'idle') s.state = 'busy'
    deps.changed()
    if (!waitInit) return Promise.resolve({ ok: true })
    return new Promise<OkResult>((resolve) => {
      startWaiter = resolve
    })
  }

  const send = (text: string): Promise<OkResult> => sendFrame(encodeUserTurn(text))

  const sendRich = (text: string, images: ImageAttachment[]): Promise<OkResult> => {
    if (!Array.isArray(images) || images.length > MAX_IMAGES) return Promise.resolve({ ok: false, reason: 'invalid-args' })
    return sendFrame(encodeUserTurnRich(text, images))
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
    if (a.answers !== undefined) {
      const entries = Object.entries(a.answers)
      if (p.prompt.toolName !== 'AskUserQuestion' || a.behavior !== 'allow' || !entries.every(([, v]) => typeof v === 'string' && v.length <= 2000)) {
        return { ok: false, reason: 'invalid-args' }
      }
      frame = encodeAllowWithAnswers(requestId, p.input, a.answers)
    } else if (a.behavior === 'allow') {
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

  const mcpToggle = (name: string, enabled: boolean): Promise<OkResult> => {
    if (!live()) return Promise.resolve(NOT_RUNNING)
    return asOk(request({ subtype: 'mcp_toggle', serverName: name, enabled }), () => refreshMcp())
  }
  const mcpReconnect = (name: string): Promise<OkResult> => {
    if (!live()) return Promise.resolve(NOT_RUNNING)
    return asOk(request({ subtype: 'mcp_reconnect', serverName: name }), () => refreshMcp())
  }
  const refreshContext = (): Promise<OkResult> => (live() ? fetchContext() : Promise.resolve(NOT_RUNNING))

  const fileSuggestions = async (query: string): Promise<FileSuggestion[] | null> => {
    if (!live()) return null
    try {
      return parseFileSuggestions(await request({ subtype: 'file_suggestions', query })).slice(0, 50)
    } catch {
      return null
    }
  }

  const rewindPreview = async (uuid: string): Promise<RewindPreview> => {
    const fail = (error: string): RewindPreview => ({ canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error })
    if (!UUID_RE.test(uuid)) return fail('invalid-args')
    if (!live()) return fail('not-running')
    try {
      const r = parseRewind(await request({ subtype: 'rewind_files', user_message_id: uuid, dry_run: true }))
      if (r.canRewind) previewed.add(uuid)
      else previewed.delete(uuid)
      return r
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'failed')
    }
  }

  /** Real rewind: only after a dry-run for the same uuid said canRewind, and never while a turn runs. */
  const rewind = async (uuid: string): Promise<OkResult> => {
    if (!UUID_RE.test(uuid)) return { ok: false, reason: 'invalid-args' }
    if (!live()) return NOT_RUNNING
    if (s.state === 'busy') return { ok: false, reason: 'busy' }
    if (!previewed.has(uuid)) return { ok: false, reason: 'preview-required' }
    try {
      const r = parseRewind(await request({ subtype: 'rewind_files', user_message_id: uuid }))
      previewed.delete(uuid)
      return r.canRewind || r.error === undefined ? { ok: true } : { ok: false, reason: r.error }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'failed' }
    }
  }

  /** Running: apply_flag_settings; if the CLI rejects it the value is kept for the next start. */
  const applyFlag = async (key: 'effortLevel' | 'outputStyle', value: string | null): Promise<OkResult> => {
    if (!live()) return NOT_RUNNING
    if (value === null) return { ok: true, reason: 'applies-on-next-start' }
    try {
      await request({ subtype: 'apply_flag_settings', settings: { [key]: value } })
      return { ok: true }
    } catch {
      return { ok: true, reason: 'applies-on-next-start' }
    }
  }
  const setEffort = async (effort: Effort | null): Promise<OkResult> => {
    if (effort !== null && !EFFORTS.includes(effort)) return { ok: false, reason: 'invalid-args' }
    if (s.state === 'stopping') return { ok: false, reason: 'stopping' }
    s.effort = effort ?? undefined
    touchDetails()
    if (s.state === 'draft' || s.state === 'exited') return { ok: true }
    return applyFlag('effortLevel', effort)
  }
  const setOutputStyle = async (style: string | null): Promise<OkResult> => {
    if (style !== null && !OUTPUT_STYLE_RE.test(style)) return { ok: false, reason: 'invalid-args' }
    if (s.state === 'stopping') return { ok: false, reason: 'stopping' }
    s.outputStyle = style ?? undefined
    touchDetails()
    if (s.state === 'draft' || s.state === 'exited') return { ok: true }
    return applyFlag('outputStyle', style)
  }

  const rename = async (title: string): Promise<OkResult> => {
    const t = typeof title === 'string' ? title.trim() : ''
    if (t === '' || t.length > 200) return { ok: false, reason: 'invalid-args' }
    if (!live()) return NOT_RUNNING
    return asOk(request({ subtype: 'rename_session', title: t }), () => {
      s.title = t
      touchDetails()
    })
  }

  const getPlan = async (): Promise<{ exists: boolean; content?: string }> => {
    if (!live()) return { exists: false }
    try {
      return parsePlan(await request({ subtype: 'get_plan' }))
    } catch {
      return { exists: false }
    }
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
    send, interrupt, answer, setModel, setMode, stop, dispose,
    request, details, sendRich, refreshContext, mcpToggle, mcpReconnect, fileSuggestions, rewindPreview, rewind, setEffort, setOutputStyle, rename, getPlan
  }
}
