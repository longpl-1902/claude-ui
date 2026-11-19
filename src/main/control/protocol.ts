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
  | { t: 'result'; subtype: string; isError: boolean; sessionId?: string; text?: string; costUsd?: number; denials: number; stopReason?: string | null }
  | { t: 'can-use-tool'; requestId: string; toolName: string; displayName: string; input: Record<string, unknown>; toolUseId?: string; description?: string; decisionReason?: string; blockedPath?: string; suggestions: unknown[] }
  | { t: 'control-request'; requestId: string; subtype: string }
  | { t: 'control-response'; requestId: string; ok: boolean; error?: string }
  | { t: 'other'; type: string; subtype?: string }

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
        return { t: 'user', parentToolUseId: parentOf(o) }
      case 'result':
        return parseResult(o)
      case 'control_request':
        return parseControlRequest(o)
      case 'control_response': {
        const r = isObj(o.response) ? o.response : {}
        const out: OutMsg = { t: 'control-response', requestId: str(r.request_id) ?? '', ok: r.subtype === 'success' }
        if (str(r.error) !== undefined) out.error = str(r.error)
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
