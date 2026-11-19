// stream-json protocol: parse CLI stdout lines, encode stdin frames. Pure; parsing never throws.
import { StringDecoder } from 'node:string_decoder'

export type OutMsg =
  | { t: 'init'; sessionId: string; model?: string; permissionMode?: string; cwd?: string; slashCommands: string[]; version?: string }
  | { t: 'status'; status: string }
  | { t: 'delta'; messageId?: string; index: number; kind: 'text' | 'thinking' | 'input_json'; text: string; parentToolUseId: string | null }
  | { t: 'block-start'; messageId?: string; index: number; blockType: string; toolName?: string; toolUseId?: string; parentToolUseId: string | null }
  | { t: 'message-start'; messageId: string; parentToolUseId: string | null }
  | { t: 'message-stop'; parentToolUseId: string | null; stopReason?: string | null }
  | { t: 'assistant'; messageId: string; aborted: boolean; parentToolUseId: string | null; text?: string }
  | { t: 'user'; parentToolUseId: string | null }
  | { t: 'result'; subtype: string; isError: boolean; sessionId?: string; text?: string; costUsd?: number; denials: number; stopReason?: string | null; usage?: ResultUsage; durationMs?: number }
  | { t: 'can-use-tool'; requestId: string; toolName: string; displayName: string; input: Record<string, unknown>; toolUseId?: string; description?: string; decisionReason?: string; blockedPath?: string; suggestions: unknown[] }
  | { t: 'control-request'; requestId: string; subtype: string }
  | { t: 'control-response'; requestId: string; ok: boolean; error?: string; body?: unknown }
  | { t: 'commands'; commands: CommandInfo[] }
  | { t: 'user-echo'; uuid: string; text: string }
  | { t: 'other'; type: string; subtype?: string }

export interface ResultUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
export interface CommandInfo { name: string; description: string; argumentHint?: string; aliases?: string[]; builtin?: boolean }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  let end = max
  const c = s.charCodeAt(end - 1)
  if (c >= 0xd800 && c <= 0xdbff) end--
  return s.slice(0, end) + '…'
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

const parentOf = (o: Obj): string | null => str(o.parent_tool_use_id) ?? null

function parseStreamEvent(o: Obj): OutMsg {
  const parentToolUseId = parentOf(o)
  const ev = o.event
  if (!isObj(ev)) return { t: 'other', type: 'stream_event' }
  const evType = str(ev.type)
  const messageId = str(o.api_message_id)
  const index = typeof ev.index === 'number' ? ev.index : 0
  switch (evType) {
    case 'message_start': {
      const id = (isObj(ev.message) ? str(ev.message.id) : undefined) ?? messageId
      return id !== undefined ? { t: 'message-start', messageId: id, parentToolUseId } : { t: 'other', type: 'stream_event', subtype: evType }
    }
    case 'content_block_start': {
      const b = isObj(ev.content_block) ? ev.content_block : {}
      const out: OutMsg = { t: 'block-start', index, blockType: str(b.type) ?? 'unknown', parentToolUseId }
      if (messageId !== undefined) out.messageId = messageId
      if (str(b.name) !== undefined) out.toolName = str(b.name)
      if (str(b.id) !== undefined) out.toolUseId = str(b.id)
      return out
    }
    case 'content_block_delta': {
      const d = isObj(ev.delta) ? ev.delta : {}
      const dt = str(d.type)
      let kind: 'text' | 'thinking' | 'input_json' | null = null
      let text: string | undefined
      if (dt === 'text_delta') {
        kind = 'text'
        text = str(d.text)
      } else if (dt === 'thinking_delta') {
        kind = 'thinking'
        text = str(d.thinking)
      } else if (dt === 'input_json_delta') {
        kind = 'input_json'
        text = str(d.partial_json)
      }
      if (kind === null || text === undefined) return { t: 'other', type: 'stream_event', subtype: evType }
      const out: OutMsg = { t: 'delta', index, kind, text, parentToolUseId }
      if (messageId !== undefined) out.messageId = messageId
      return out
    }
    case 'message_stop':
      return { t: 'message-stop', parentToolUseId }
    default:
      return evType !== undefined ? { t: 'other', type: 'stream_event', subtype: evType } : { t: 'other', type: 'stream_event' }
  }
}

function parseControlRequest(o: Obj): OutMsg {
  const requestId = str(o.request_id) ?? ''
  const req = isObj(o.request) ? o.request : {}
  const subtype = str(req.subtype) ?? ''
  if (subtype === 'can_use_tool') {
    const toolName = str(req.tool_name)
    if (!toolName) return { t: 'control-request', requestId, subtype }
    const out: OutMsg = {
      t: 'can-use-tool',
      requestId,
      toolName,
      displayName: str(req.display_name) ?? toolName,
      input: isObj(req.input) ? req.input : {},
      suggestions: Array.isArray(req.permission_suggestions) ? req.permission_suggestions : []
    }
    if (str(req.tool_use_id) !== undefined) out.toolUseId = str(req.tool_use_id)
    const desc = str(req.description)
    if (desc !== undefined) out.description = truncate(desc, 500)
    const reason = str(req.decision_reason)
    if (reason !== undefined) out.decisionReason = truncate(stripAnsi(reason), 500)
    if (str(req.blocked_path) !== undefined) out.blockedPath = str(req.blocked_path)
    return out
  }
  return { t: 'control-request', requestId, subtype }
}

function parseSystem(o: Obj): OutMsg {
  const subtype = str(o.subtype)
  if (subtype === 'init') {
    const out: OutMsg = {
      t: 'init',
      sessionId: str(o.session_id) ?? '',
      slashCommands: Array.isArray(o.slash_commands) ? o.slash_commands.filter((c): c is string => typeof c === 'string') : []
    }
    if (str(o.model) !== undefined) out.model = str(o.model)
    if (str(o.permissionMode) !== undefined) out.permissionMode = str(o.permissionMode)
    if (str(o.cwd) !== undefined) out.cwd = str(o.cwd)
    if (str(o.claude_code_version) !== undefined) out.version = str(o.claude_code_version)
    return out
  }
  if (subtype === 'commands_changed') return { t: 'commands', commands: parseCommandList(o.commands) }
  const status = str(o.status)
  if (subtype === 'status' && status !== undefined) return { t: 'status', status }
  return subtype !== undefined ? { t: 'other', type: 'system', subtype } : { t: 'other', type: 'system' }
}

function parseAssistant(o: Obj): OutMsg {
  const m = isObj(o.message) ? o.message : {}
  const out: OutMsg = { t: 'assistant', messageId: str(m.id) ?? '', aborted: o.aborted === true, parentToolUseId: parentOf(o) }
  if (Array.isArray(m.content)) {
    const text = m.content
      .map((b) => (isObj(b) && b.type === 'text' ? str(b.text) ?? '' : ''))
      .filter((t) => t !== '')
      .join('\n')
    if (text !== '') out.text = truncate(text, 4000)
  }
  return out
}

/** Plain user prompt echoed back (--replay-user-messages) -> user-echo; tool_result turns stay 'user'. */
function parseUser(o: Obj): OutMsg {
  const plain: OutMsg = { t: 'user', parentToolUseId: parentOf(o) }
  const uuid = str(o.uuid)
  const m = isObj(o.message) ? o.message : null
  if (uuid === undefined || m === null) return plain
  const c = m.content
  if (typeof c === 'string') return { t: 'user-echo', uuid, text: c }
  if (!Array.isArray(c)) return plain
  let text = ''
  for (const b of c) {
    if (!isObj(b)) continue
    if (b.type === 'tool_result') return plain
    if (b.type === 'text' && typeof b.text === 'string') text += (text ? '\n' : '') + b.text
  }
  return { t: 'user-echo', uuid, text }
}

function parseResult(o: Obj): OutMsg {
  const out: OutMsg = {
    t: 'result',
    subtype: str(o.subtype) ?? '',
    isError: o.is_error === true,
    denials: Array.isArray(o.permission_denials) ? o.permission_denials.length : 0
  }
  if (str(o.session_id) !== undefined) out.sessionId = str(o.session_id)
  const text = str(o.result)
  if (text !== undefined) out.text = truncate(text, 4000)
  if (typeof o.total_cost_usd === 'number' && Number.isFinite(o.total_cost_usd)) out.costUsd = o.total_cost_usd
  if (typeof o.stop_reason === 'string' || o.stop_reason === null) out.stopReason = o.stop_reason
  if (typeof o.duration_ms === 'number' && Number.isFinite(o.duration_ms)) out.durationMs = o.duration_ms
  if (isObj(o.usage)) {
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    out.usage = {
      inputTokens: n(o.usage.input_tokens),
      outputTokens: n(o.usage.output_tokens),
      cacheReadTokens: n(o.usage.cache_read_input_tokens),
      cacheCreationTokens: n(o.usage.cache_creation_input_tokens)
    }
  }
  return out
}

/** One stdout line -> typed message. null for blank / invalid JSON / non-objects. Never throws. */
export function parseOutputLine(line: string): OutMsg | null {
  try {
    const trimmed = line.trim()
    if (trimmed === '') return null
    const o: unknown = JSON.parse(trimmed)
    if (!isObj(o)) return null
    const type = str(o.type)
    if (type === undefined) return { t: 'other', type: '' }
    switch (type) {
      case 'system':
        return parseSystem(o)
      case 'stream_event':
        return parseStreamEvent(o)
      case 'assistant':
        return parseAssistant(o)
      case 'user':
        return parseUser(o)
      case 'result':
        return parseResult(o)
      case 'control_request':
        return parseControlRequest(o)
      case 'control_response': {
        const r = isObj(o.response) ? o.response : {}
        const out: OutMsg = { t: 'control-response', requestId: str(r.request_id) ?? '', ok: r.subtype === 'success' }
        if (str(r.error) !== undefined) out.error = str(r.error)
        if (r.response !== undefined) out.body = r.response
        return out
      }
      default:
        return { t: 'other', type }
    }
  } catch {
    return null
  }
}

/** Short one-line description of a tool input: command / file_path / url / pattern first, else compact JSON. */
export function inputPreview(_toolName: string, input: Record<string, unknown>): string {
  try {
    if (isObj(input)) {
      for (const k of ['command', 'file_path', 'url', 'pattern']) {
        const v = input[k]
        if (typeof v === 'string' && v !== '') return truncate(v, 1999)
      }
      return truncate(JSON.stringify(input) ?? '', 1999)
    }
  } catch {
    /* fall through */
  }
  return ''
}

const frame = (o: unknown): string => JSON.stringify(o) + '\n'

export function encodeUserTurn(text: string): string {
  return frame({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' })
}

export function encodeAllow(requestId: string, input: Record<string, unknown>, sessionRules?: unknown[]): string {
  const response: Obj = { behavior: 'allow', updatedInput: input }
  if (sessionRules) response.updatedPermissions = sessionRules
  return frame({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
}

const SUGGESTION_TYPES = ['addRules', 'replaceRules', 'addDirectories', 'setMode']

/** Keep only known suggestion types and force destination 'session' (never a settings file). */
export function sessionScopedSuggestions(suggestions: unknown): unknown[] {
  if (!Array.isArray(suggestions)) return []
  const out: unknown[] = []
  for (const s of suggestions) {
    if (isObj(s) && typeof s.type === 'string' && SUGGESTION_TYPES.includes(s.type)) out.push({ ...s, destination: 'session' })
  }
  return out
}

export function encodeDeny(requestId: string, message: string): string {
  return frame({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'deny', message } } })
}

export function encodeUnsupported(requestId: string, subtype: string): string {
  return frame({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: `unsupported: ${subtype}` } })
}

export function encodeControlRequest(
  requestId: string,
  req: { subtype: 'interrupt' } | { subtype: 'set_model'; model: string | null } | { subtype: 'set_permission_mode'; mode: string }
): string {
  return frame({ type: 'control_request', request_id: requestId, request: req })
}

/** Splits a byte/string stream into lines (UTF-8 safe, CRLF ok); over-long lines are dropped and counted. */
export function createLineSplitter(
  onLine: (l: string) => void,
  maxLine = 16 * 1024 * 1024
): { push(chunk: Buffer | string): void; end(): void; dropped(): number } {
  const decoder = new StringDecoder('utf8')
  let buf = ''
  let skipping = false
  let drops = 0

  const append = (piece: string): void => {
    if (skipping) return
    buf += piece
    if (buf.length > maxLine) {
      skipping = true
      drops++
      buf = ''
    }
  }
  const emit = (): void => onLine(buf.endsWith('\r') ? buf.slice(0, -1) : buf)
  const feed = (text: string): void => {
    let start = 0
    for (;;) {
      const nl = text.indexOf('\n', start)
      if (nl < 0) break
      append(text.slice(start, nl))
      if (skipping) skipping = false
      else emit()
      buf = ''
      start = nl + 1
    }
    append(text.slice(start))
  }
  return {
    push(chunk) {
      feed(typeof chunk === 'string' ? chunk : decoder.write(chunk))
    },
    end() {
      feed(decoder.end())
      if (!skipping && buf !== '') emit()
      buf = ''
      skipping = false
    },
    dropped: () => drops
  }
}

// ---- protocol v2: control requests, rich turns, response parsers ----

export type CtlReq =
  | { subtype: 'initialize' }
  | { subtype: 'interrupt' }
  | { subtype: 'set_model'; model: string | null }
  | { subtype: 'set_permission_mode'; mode: string }
  | { subtype: 'set_max_thinking_tokens'; max_thinking_tokens: number | null }
  | { subtype: 'mcp_status' }
  | { subtype: 'mcp_toggle'; serverName: string; enabled: boolean }
  | { subtype: 'mcp_reconnect'; serverName: string }
  | { subtype: 'get_context_usage'; detail?: 'summary' }
  | { subtype: 'rewind_files'; user_message_id: string; dry_run?: boolean }
  | { subtype: 'file_suggestions'; query: string }
  | { subtype: 'apply_flag_settings'; settings: { effortLevel?: string; outputStyle?: string } }
  | { subtype: 'rename_session'; title: string }
  | { subtype: 'get_plan' }
  | { subtype: 'get_session_cost' }

export function encodeRequest(requestId: string, req: CtlReq): string {
  return frame({ type: 'control_request', request_id: requestId, request: req })
}

/** ASSUMPTION: image blocks use the Anthropic API shape. Isolated here so it is a one-place fix. */
const imageBlock = (i: { mediaType: string; dataBase64: string }): Obj => ({
  type: 'image',
  source: { type: 'base64', media_type: i.mediaType, data: i.dataBase64 }
})

export function encodeUserTurnRich(text: string, images: { mediaType: string; dataBase64: string }[]): string {
  return frame({
    type: 'user',
    message: { role: 'user', content: [...images.map(imageBlock), { type: 'text', text }] },
    parent_tool_use_id: null,
    session_id: ''
  })
}

export function encodeAllowWithAnswers(requestId: string, input: Record<string, unknown>, answers: Record<string, string>): string {
  return encodeAllow(requestId, { ...input, answers })
}

/** Accepts either the control_response envelope or its inner payload. */
function payload(r: unknown): Obj {
  if (!isObj(r)) return {}
  if (isObj(r.response) && (r.subtype !== undefined || r.request_id !== undefined)) return r.response
  return r
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function parseCommandList(v: unknown): CommandInfo[] {
  const out: CommandInfo[] = []
  for (const c of arr(v)) {
    if (!isObj(c)) continue
    const name = str(c.name)
    if (!name) continue
    const e: CommandInfo = { name, description: str(c.description) ?? '' }
    const hint = str(c.argumentHint) ?? str(c.argument_hint)
    if (hint) e.argumentHint = hint
    if (Array.isArray(c.aliases)) e.aliases = c.aliases.filter((a): a is string => typeof a === 'string')
    if (typeof c.builtin === 'boolean') e.builtin = c.builtin
    out.push(e)
  }
  return out
}

export function parseInitializeResponse(r: unknown): {
  commands: CommandInfo[]
  agents: { name: string; description?: string }[]
  models: { value: string; displayName: string; description?: string }[]
  outputStyle?: string
  availableOutputStyles: string[]
} {
  const p = payload(r)
  const agents: { name: string; description?: string }[] = []
  for (const a of arr(p.agents)) {
    if (!isObj(a)) continue
    const name = str(a.name)
    if (!name) continue
    const e: { name: string; description?: string } = { name }
    if (str(a.description) !== undefined) e.description = str(a.description)
    agents.push(e)
  }
  const models: { value: string; displayName: string; description?: string }[] = []
  for (const m of arr(p.models)) {
    if (!isObj(m)) continue
    const value = str(m.value)
    if (!value) continue
    const e: { value: string; displayName: string; description?: string } = { value, displayName: str(m.displayName) ?? str(m.display_name) ?? value }
    if (str(m.description) !== undefined) e.description = str(m.description)
    models.push(e)
  }
  const out: ReturnType<typeof parseInitializeResponse> = {
    commands: parseCommandList(p.commands),
    agents,
    models,
    availableOutputStyles: arr(p.available_output_styles ?? p.availableOutputStyles).filter((s): s is string => typeof s === 'string')
  }
  const os = str(p.output_style) ?? str(p.outputStyle)
  if (os !== undefined) out.outputStyle = os
  return out
}

export function parseMcpStatus(r: unknown): { name: string; status: string; serverInfo?: { name: string; version: string }; error?: string }[] {
  const p = payload(r)
  const out: ReturnType<typeof parseMcpStatus> = []
  for (const s of arr(p.mcpServers ?? p.mcp_servers)) {
    if (!isObj(s)) continue
    const name = str(s.name)
    if (!name) continue
    const e: ReturnType<typeof parseMcpStatus>[number] = { name, status: str(s.status) ?? 'unknown' }
    if (isObj(s.serverInfo) && str(s.serverInfo.name) !== undefined) {
      e.serverInfo = { name: str(s.serverInfo.name)!, version: str(s.serverInfo.version) ?? '' }
    }
    if (str(s.error) !== undefined) e.error = str(s.error)
    out.push(e)
  }
  return out
}

export function parseContextUsage(
  r: unknown
): { totalTokens: number; maxTokens: number; percentage: number; categories: { name: string; tokens: number; percentage: number }[]; model?: string } | null {
  const p = payload(r)
  const totalTokens = num(p.totalTokens)
  const maxTokens = num(p.maxTokens)
  if (totalTokens === undefined || maxTokens === undefined) return null
  const categories: { name: string; tokens: number; percentage: number }[] = []
  for (const c of arr(p.categories)) {
    if (!isObj(c)) continue
    const name = str(c.name)
    if (!name) continue
    const tokens = num(c.tokens) ?? 0
    categories.push({ name, tokens, percentage: num(c.percentage) ?? (maxTokens > 0 ? (tokens / maxTokens) * 100 : 0) })
  }
  const out: NonNullable<ReturnType<typeof parseContextUsage>> = {
    totalTokens,
    maxTokens,
    percentage: num(p.percentage) ?? (maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0),
    categories
  }
  if (str(p.model) !== undefined) out.model = str(p.model)
  return out
}

export function parseRewind(r: unknown): { canRewind: boolean; filesChanged: string[]; insertions: number; deletions: number; error?: string } {
  const p = payload(r)
  const out: ReturnType<typeof parseRewind> = {
    canRewind: p.canRewind === true,
    filesChanged: arr(p.filesChanged).filter((f): f is string => typeof f === 'string'),
    insertions: num(p.insertions) ?? 0,
    deletions: num(p.deletions) ?? 0
  }
  if (str(p.error) !== undefined) out.error = str(p.error)
  return out
}

export function parseFileSuggestions(r: unknown): { path: string; score?: number }[] {
  const p = payload(r)
  const out: { path: string; score?: number }[] = []
  for (const s of arr(p.suggestions)) {
    const path = typeof s === 'string' ? s : isObj(s) ? str(s.path) : undefined
    if (!path) continue
    const e: { path: string; score?: number } = { path }
    if (isObj(s) && num(s.score) !== undefined) e.score = num(s.score)
    out.push(e)
  }
  return out
}

export function parsePlan(r: unknown): { exists: boolean; content?: string } {
  const p = payload(r)
  const out: { exists: boolean; content?: string } = { exists: p.exists === true }
  if (str(p.content) !== undefined) out.content = str(p.content)
  return out
}

export type CommandSource = 'builtin' | 'plugin' | 'mcp' | 'unknown'

export function commandSource(c: { name: string; builtin?: boolean }): CommandSource {
  if (c.builtin === true) return 'builtin'
  if (c.name.startsWith('mcp__')) return 'mcp'
  const i = c.name.indexOf(':')
  if (i > 0 && i < c.name.length - 1) return 'plugin'
  return 'unknown'
}
