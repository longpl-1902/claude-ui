import type { FileChange, TokenUsage, ToolResultRec, ToolUseRec, TranscriptRecord } from './records'

type Obj = Record<string, unknown>

const SKIP_PREFIXES = [
  '{"type":"api-request',
  '{"type":"file-history',
  '{"type":"queue-operation"',
  '{"type":"atis-latch"',
  '{"type":"session-owner"',
  '{"type":"tools-used"'
]

/** Cheap raw prefilter: true for line types we never use. */
export function shouldSkipRaw(line: string): boolean {
  for (const p of SKIP_PREFIXES) if (line.startsWith(p)) return true
  return false
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Cut at `max` UTF-16 units (never inside a surrogate pair) and append an ellipsis. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  let end = max
  const c = s.charCodeAt(end - 1)
  if (c >= 0xd800 && c <= 0xdbff) end--
  return s.slice(0, end) + '…'
}

const firstLine = (s: string): string => {
  const i = s.indexOf('\n')
  return (i < 0 ? s : s.slice(0, i)).replace(/\r$/, '')
}

export function targetFor(name: string, input: Record<string, unknown>): string {
  if (!isObj(input)) return ''
  let out = ''
  const fp = str(input.file_path) ?? str(input.notebook_path)
  if (fp !== undefined) out = fp
  else if (name === 'Bash' || name === 'PowerShell') out = truncate(firstLine(str(input.command) ?? ''), 120)
  else if (name === 'Grep' || name === 'Glob') {
    const p = str(input.pattern)
    if (p !== undefined) {
      const path = str(input.path)
      out = path ? `${p} in ${path}` : p
    }
  } else if (name === 'WebFetch') out = str(input.url) ?? ''
  else if (name === 'WebSearch') out = str(input.query) ?? ''
  else if (name === 'Agent') out = str(input.name) ?? str(input.subagent_type) ?? str(input.description) ?? ''
  else if (name === 'SendMessage') {
    const to = str(input.to) ?? str(input.recipient)
    out = to !== undefined ? `→ ${to}` : ''
  } else if (name === 'Skill') out = str(input.skill) ?? ''
  else if (name.startsWith('mcp__')) out = name.slice(name.lastIndexOf('__') + 2)
  return truncate(out, 160)
}

function parseToolUse(b: Obj): ToolUseRec | null {
  const id = str(b.id)
  const name = str(b.name)
  if (id === undefined || name === undefined) return null
  const input: Obj = isObj(b.input) ? b.input : {}
  const rec: ToolUseRec = { id, name, target: targetFor(name, input) }
  const fp = str(input.file_path) ?? str(input.notebook_path)
  if (fp !== undefined) rec.filePath = fp
  const cmd = str(input.command)
  if (cmd !== undefined) rec.command = cmd
  if (name === 'Agent') {
    const agent: NonNullable<ToolUseRec['agent']> = {}
    const d = str(input.description)
    if (d !== undefined) agent.description = d
    const st = str(input.subagent_type)
    if (st !== undefined) agent.subagentType = st
    const n = str(input.name)
    if (n !== undefined) agent.name = n
    if (typeof input.run_in_background === 'boolean') agent.background = input.run_in_background
    rec.agent = agent
  }
  if (name === 'SendMessage') {
    const to = str(input.to) ?? str(input.recipient)
    if (to !== undefined) {
      const send: NonNullable<ToolUseRec['send']> = { to, text: str(input.message) ?? str(input.content) ?? '' }
      const s = str(input.summary)
      if (s !== undefined) send.summary = s
      rec.send = send
    }
  }
  return rec
}

/** Text of a string content or the `text` items of an array content. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) if (isObj(b) && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  return parts.join('\n')
}

interface Env {
  uuid: string
  ts: string
  tsMs: number
  sessionId: string
  extra: { agentId?: string; cwd?: string; gitBranch?: string }
}

function envelope(o: Obj): Env | null {
  const uuid = str(o.uuid)
  const ts = str(o.timestamp)
  if (uuid === undefined || ts === undefined) return null
  const tsMs = Date.parse(ts)
  if (Number.isNaN(tsMs)) return null
  const extra: Env['extra'] = {}
  const agentId = str(o.agentId)
  if (agentId !== undefined) extra.agentId = agentId
  const cwd = str(o.cwd)
  if (cwd !== undefined) extra.cwd = cwd
  const gitBranch = str(o.gitBranch)
  if (gitBranch !== undefined) extra.gitBranch = gitBranch
  return { uuid, ts, tsMs, sessionId: str(o.sessionId) ?? '', extra }
}

function parseAssistant(o: Obj): TranscriptRecord | null {
  const env = envelope(o)
  const msg = o.message
  if (!env || !isObj(msg)) return null
  const messageId = str(msg.id)
  if (messageId === undefined) return null
  const model = str(msg.model) ?? ''
  const isApiError = o.isApiErrorMessage === true
  const toolUses: ToolUseRec[] = []
  const texts: string[] = []
  if (Array.isArray(msg.content)) {
    for (const b of msg.content) {
      if (!isObj(b)) continue
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
      else if (b.type === 'tool_use') {
        const tu = parseToolUse(b)
        if (tu) toolUses.push(tu)
      }
    }
  }
  const rec: TranscriptRecord & { t: 'assistant' } = {
    t: 'assistant',
    uuid: env.uuid,
    ts: env.ts,
    tsMs: env.tsMs,
    sessionId: env.sessionId,
    ...env.extra,
    messageId,
    model,
    stopReason: str(msg.stop_reason) ?? null,
    toolUses,
    isApiError
  }
  if (!isApiError && model !== '<synthetic>' && isObj(msg.usage)) {
    const u = msg.usage
    const usage: TokenUsage = {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheCreation: num(u.cache_creation_input_tokens),
      cacheRead: num(u.cache_read_input_tokens)
    }
    rec.usage = usage
  }
  const text = texts.join('\n')
  if (text !== '') rec.text = truncate(text, 300)
  const ek = str(o.error)
  if (ek !== undefined) rec.errorKind = ek
  return rec
}

function countPatch(patch: unknown[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of patch) {
    if (!isObj(h) || !Array.isArray(h.lines)) continue
    for (const l of h.lines) {
      if (typeof l !== 'string') continue
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

function parseFileChange(tur: Obj): FileChange | undefined {
  const path = str(tur.filePath)
  if (path === undefined || !Array.isArray(tur.structuredPatch)) return undefined
  const kind = tur.type === 'create' ? 'create' : 'update'
  let { added, removed } = countPatch(tur.structuredPatch)
  if (kind === 'create' && tur.structuredPatch.length === 0 && typeof tur.content === 'string' && tur.content !== '') {
    added = tur.content.split('\n').length
    removed = 0
  }
  return { path, kind, added, removed }
}

function parseToolResults(o: Obj, blocks: Obj[], env: Env): TranscriptRecord {
  const tur = o.toolUseResult
  const denialRaw = str(o.toolDenialKind)
  const results: ToolResultRec[] = []
  blocks.forEach((b, i) => {
    const first = i === 0
    const turHere = first ? tur : undefined
    const denial = first ? denialRaw : undefined
    let summary = ''
    for (const l of textOf(b.content).split('\n')) {
      const t = l.trim()
      if (t !== '') {
        summary = truncate(t, 200)
        break
      }
    }
    const rec: ToolResultRec = {
      toolUseId: str(b.tool_use_id) ?? '',
      isError: b.is_error === true || (typeof turHere === 'string' && turHere.startsWith('Error')) || denial !== undefined,
      interrupted: (isObj(turHere) && turHere.interrupted === true) || denial === 'interrupted' || denial === 'cancelled',
      summary
    }
    if (denial !== undefined) rec.denial = denial
    if (isObj(turHere)) {
      const fc = parseFileChange(turHere)
      if (fc) rec.fileChange = fc
      const agentId = str(turHere.agentId)
      if (agentId !== undefined) {
        const ar: NonNullable<ToolResultRec['agentResult']> = { agentId, status: str(turHere.status) ?? '' }
        if (typeof turHere.totalTokens === 'number') ar.totalTokens = turHere.totalTokens
        const text = textOf(Array.isArray(turHere.content) ? turHere.content.slice(0, 1) : [])
        if (text !== '') ar.text = truncate(text, 500)
        rec.agentResult = ar
      }
      if (typeof turHere.success === 'boolean') rec.sendOk = turHere.success
    }
    results.push(rec)
  })
  return { t: 'tool_results', uuid: env.uuid, ts: env.ts, tsMs: env.tsMs, sessionId: env.sessionId, ...env.extra, results }
}

function stripCommand(text: string): string {
  const tag = (n: string): string => {
    const m = new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(text)
    return m ? (m[1] ?? '').trim() : ''
  }
  let name = tag('command-name') || tag('command-message')
  const args = tag('command-args')
  if (name !== '' && !name.startsWith('/')) name = '/' + name
  if (name === '') return text.replace(/<[^>]+>/g, '').trim()
  return args !== '' ? `${name} ${args}` : name
}

function parseUser(o: Obj): TranscriptRecord | null {
  const env = envelope(o)
  const msg = o.message
  if (!env || !isObj(msg)) return null
  if (o.isMeta === true) return null
  const content = msg.content
  if (Array.isArray(content)) {
    const blocks = content.filter((b): b is Obj => isObj(b) && b.type === 'tool_result')
    if (blocks.length > 0) return parseToolResults(o, blocks, env)
  }
  const trimmed = textOf(content).trim()
  const head = { uuid: env.uuid, ts: env.ts, tsMs: env.tsMs, sessionId: env.sessionId, ...env.extra }
  if (trimmed.startsWith('[Request interrupted')) return { t: 'interrupted', ...head }
  let kind: 'user' | 'command' | 'task-notification' | 'compact-summary' | 'first-task' = 'user'
  let out = trimmed
  if (o.isCompactSummary === true) kind = 'compact-summary'
  else if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<command-message>')) {
    kind = 'command'
    out = stripCommand(trimmed)
  } else if (trimmed.startsWith('<task-notification>')) kind = 'task-notification'
  else {
    if (trimmed.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim() === '') return null
    if (env.extra.agentId !== undefined && o.parentUuid === null) kind = 'first-task'
  }
  return { t: 'prompt', ...head, text: truncate(out, 300), kind }
}

const SYSTEM_SUBTYPES = new Set(['api_error', 'compact_boundary', 'local_command', 'informational'])

function parseSystem(o: Obj): TranscriptRecord | null {
  const env = envelope(o)
  const subtype = str(o.subtype)
  if (!env || subtype === undefined || !SYSTEM_SUBTYPES.has(subtype)) return null
  const level = str(o.level)
  const fatal =
    (subtype === 'api_error' &&
      typeof o.retryAttempt === 'number' &&
      typeof o.maxRetries === 'number' &&
      o.retryAttempt >= o.maxRetries) ||
    (level === 'error' && subtype !== 'api_error')
  const rec: TranscriptRecord & { t: 'system' } = {
    t: 'system',
    uuid: env.uuid,
    ts: env.ts,
    tsMs: env.tsMs,
    sessionId: env.sessionId,
    ...env.extra,
    subtype,
    fatal
  }
  if (level !== undefined) rec.level = level
  return rec
}

export function parseRecord(obj: unknown): TranscriptRecord | null {
  try {
    if (!isObj(obj)) return null
    switch (obj.type) {
      case 'assistant':
        return parseAssistant(obj)
      case 'user':
        return parseUser(obj)
      case 'system':
        return parseSystem(obj)
      case 'ai-title':
      case 'custom-title':
      case 'agent-name': {
        const sessionId = str(obj.sessionId)
        const value = str(obj.type === 'ai-title' ? obj.aiTitle : obj.type === 'custom-title' ? obj.customTitle : obj.agentName)
        if (sessionId === undefined || value === undefined) return null
        const kind = obj.type === 'ai-title' ? 'ai' : obj.type === 'custom-title' ? 'custom' : 'agent-name'
        return { t: 'title', sessionId, kind, value }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

export function parseLine(line: string): TranscriptRecord | null {
  try {
    if (typeof line !== 'string' || line.trim() === '') return null
    return parseRecord(JSON.parse(line))
  } catch {
    return null
  }
}
