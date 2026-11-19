// Synthetic transcript line builders. They follow the VERIFIED SCHEMA in the Phase 3 plan
// (facts 6-11). Every id, path and text here is invented; nothing is copied from a real transcript.
// Builders return plain objects with `type` as the FIRST key (so JSON.stringify output starts with
// `{"type":"..."` like the real files do, which the raw prefilter relies on). Use `toLine` / `jsonl` to serialise.

export const T0_MS = Date.parse('2026-11-18T10:00:00.000Z')
/** ISO timestamp `sec` seconds after T0 (may be negative). */
export const at = (sec: number): string => new Date(T0_MS + sec * 1000).toISOString()

export const SESSION_ID = '11111111-aaaa-4bbb-8ccc-000000000001'
export const CWD = 'd:\\work\\demo'
export const MODEL = 'claude-test-opus'

let counter = 0
export function resetBuilderIds(): void {
  counter = 0
}
const nextUuid = (): string => `uuid-${String(++counter).padStart(5, '0')}`

export interface UsageSpec {
  input: number
  output: number
  cacheCreation: number
  cacheRead: number
}
export const usage = (input: number, output: number, cacheCreation = 0, cacheRead = 0): UsageSpec => ({
  input,
  output,
  cacheCreation,
  cacheRead
})
export const rawUsage = (u: UsageSpec): Record<string, unknown> => ({
  input_tokens: u.input,
  output_tokens: u.output,
  cache_creation_input_tokens: u.cacheCreation,
  cache_read_input_tokens: u.cacheRead,
  cache_creation: { ephemeral_5m_input_tokens: u.cacheCreation, ephemeral_1h_input_tokens: 0 },
  output_tokens_details: { thinking_tokens: 0 },
  server_tool_use: { web_search_requests: 0 },
  service_tier: 'standard',
  speed: 'standard'
})

export interface LineOpts {
  uuid?: string
  /** null = first line of a file; undefined = a made-up parent id. */
  parentUuid?: string | null
  /** ISO timestamp; default T0. */
  ts?: string
  sessionId?: string
  /** Sub-agent id: sets agentId and isSidechain:true. */
  agentId?: string
  cwd?: string
  gitBranch?: string
}

function envelope(type: string, o: LineOpts): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type,
    uuid: o.uuid ?? nextUuid(),
    parentUuid: o.parentUuid === undefined ? 'parent-00000' : o.parentUuid,
    isSidechain: o.agentId !== undefined,
    userType: 'external',
    entrypoint: 'cli',
    cwd: o.cwd ?? CWD,
    sessionId: o.sessionId ?? SESSION_ID,
    version: '0.0.0-test',
    gitBranch: o.gitBranch ?? 'main',
    timestamp: o.ts ?? at(0)
  }
  if (o.agentId !== undefined) out.agentId = o.agentId
  return out
}

// ---- content blocks ----
export type Block = Record<string, unknown>
export const textBlock = (text: string): Block => ({ type: 'text', text })
export const thinkingBlock = (thinking: string): Block => ({ type: 'thinking', thinking, signature: 'FAKE-SIGNATURE' })
export const toolUseBlock = (id: string, name: string, input: Record<string, unknown>): Block => ({
  type: 'tool_use',
  id,
  name,
  input,
  caller: { type: 'direct' }
})
export const agentToolUse = (
  id: string,
  input: {
    description: string
    prompt?: string
    subagent_type?: string
    name?: string
    model?: string
    run_in_background?: boolean
    isolation?: string
  }
): Block => toolUseBlock(id, 'Agent', { prompt: 'Do the task.', subagent_type: 'general-purpose', ...input })
export const sendMessageUse = (id: string, input: { to: string; message: string; summary?: string }): Block =>
  toolUseBlock(id, 'SendMessage', {
    to: input.to,
    recipient: input.to,
    recipient_kind: 'agent',
    message: input.message,
    content: input.message,
    summary: input.summary ?? input.message.slice(0, 20),
    type: 'message'
  })
export const askUserQuestionUse = (id: string, question: string): Block =>
  toolUseBlock(id, 'AskUserQuestion', {
    questions: [
      {
        question,
        header: 'Choice',
        multiSelect: false,
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' }
        ]
      }
    ]
  })
export const exitPlanModeUse = (id: string, plan: string): Block => toolUseBlock(id, 'ExitPlanMode', { plan })

// ---- assistant ----
export interface AssistantOpts extends LineOpts {
  messageId: string
  model?: string
  stopReason?: 'tool_use' | 'end_turn' | 'stop_sequence' | null
  usage?: UsageSpec
}
/** One transcript line PER content block; every line repeats the same message.id, usage and stop_reason (fact 8). */
export function assistantBlocks(blocks: Block[], o: AssistantOpts): Record<string, unknown>[] {
  const u = o.usage ?? usage(1, 1)
  return blocks.map((b, i) => ({
    ...envelope('assistant', { ...o, uuid: i === 0 ? o.uuid : undefined }),
    requestId: `req_${o.messageId}`,
    apiBlockIndex: i,
    message: {
      id: o.messageId,
      type: 'message',
      role: 'assistant',
      model: o.model ?? MODEL,
      content: [b],
      stop_reason: o.stopReason === undefined ? null : o.stopReason,
      usage: rawUsage(u)
    }
  }))
}
/** Convenience: a one-line assistant message. */
export function assistantLine(block: Block, o: AssistantOpts): Record<string, unknown> {
  return assistantBlocks([block], o)[0]!
}
export function apiErrorLine(errorKind: string, o: LineOpts = {}): Record<string, unknown> {
  return {
    ...envelope('assistant', o),
    isApiErrorMessage: true,
    error: errorKind,
    message: {
      id: `msg_synthetic_${nextUuid()}`,
      type: 'message',
      role: 'assistant',
      model: '<synthetic>',
      content: [textBlock(`API Error: ${errorKind} (fake)`)],
      stop_reason: 'stop_sequence',
      usage: rawUsage(usage(0, 0))
    }
  }
}

// ---- user ----
export function userPrompt(text: string, o: LineOpts = {}): Record<string, unknown> {
  return { ...envelope('user', o), message: { role: 'user', content: text } }
}
export function userPromptArray(text: string, o: LineOpts = {}): Record<string, unknown> {
  return { ...envelope('user', o), message: { role: 'user', content: [textBlock(text)] } }
}
export const commandPrompt = (name: string, args: string, o: LineOpts = {}): Record<string, unknown> =>
  userPrompt(
    `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`,
    o
  )
export const taskNotification = (text: string, o: LineOpts = {}): Record<string, unknown> =>
  userPrompt(`<task-notification>\n<status>completed</status>\n<summary>${text}</summary>\n</task-notification>`, o)
export const systemReminderPrompt = (o: LineOpts = {}): Record<string, unknown> =>
  userPrompt('<system-reminder>\nFake reminder text.\n</system-reminder>', o)
export const metaPrompt = (text: string, o: LineOpts = {}): Record<string, unknown> => ({ ...userPrompt(text, o), isMeta: true })
export const compactSummaryPrompt = (text: string, o: LineOpts = {}): Record<string, unknown> => ({
  ...userPrompt(text, o),
  isCompactSummary: true
})
export const interruptedLine = (o: LineOpts = {}): Record<string, unknown> => ({
  ...envelope('user', o),
  message: { role: 'user', content: [textBlock('[Request interrupted by user]')] }
})

export interface ToolResultOpts extends LineOpts {
  isError?: boolean
  toolUseResult?: unknown
  toolDenialKind?: string
  permissionDecision?: Record<string, unknown>
  /**
   * Model a SUB-AGENT result line: real sub-agent files carry no `toolUseResult` on successful results
   * (only error strings carry it). Default false keeps the main-file behaviour.
   */
  omitToolUseResult?: boolean
}
export function toolResult(toolUseId: string, content: string | Block[], o: ToolResultOpts = {}): Record<string, unknown> {
  const block: Block = { type: 'tool_result', tool_use_id: toolUseId, content }
  if (o.isError !== undefined) block.is_error = o.isError
  const line: Record<string, unknown> = { ...envelope('user', o), message: { role: 'user', content: [block] } }
  if (o.toolUseResult !== undefined && o.omitToolUseResult !== true) line.toolUseResult = o.toolUseResult
  if (o.toolDenialKind !== undefined) line.toolDenialKind = o.toolDenialKind
  if (o.permissionDecision !== undefined) line.permissionDecision = o.permissionDecision
  return line
}
export const bashResult = (toolUseId: string, stdout: string, o: ToolResultOpts = {}): Record<string, unknown> =>
  toolResult(toolUseId, stdout, {
    ...o,
    toolUseResult: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false }
  })
export const errorResult = (toolUseId: string, message: string, o: LineOpts = {}): Record<string, unknown> =>
  toolResult(toolUseId, message, { ...o, isError: true, toolUseResult: message })
export const rejectedResult = (toolUseId: string, o: LineOpts = {}): Record<string, unknown> =>
  toolResult(toolUseId, 'The user declined this tool use (fake).', {
    ...o,
    isError: true,
    toolUseResult: 'User rejected tool use',
    toolDenialKind: 'user-rejected',
    permissionDecision: { decision: 'reject', source: 'user' }
  })
export const interruptedToolResult = (toolUseId: string, o: LineOpts = {}): Record<string, unknown> =>
  toolResult(toolUseId, 'Tool interrupted (fake).', {
    ...o,
    isError: true,
    toolUseResult: { stdout: '', stderr: '', interrupted: true, isImage: false, noOutputExpected: false },
    toolDenialKind: 'interrupted'
  })
/** Edit result. `patchLines` are hunk lines whose first char is ' ', '+', '-' or a backslash. */
export function editResult(toolUseId: string, filePath: string, patchLines: string[], o: ToolResultOpts = {}): Record<string, unknown> {
  const removed = patchLines.filter((l) => l.startsWith('-')).length
  const added = patchLines.filter((l) => l.startsWith('+')).length
  return toolResult(toolUseId, `The file ${filePath} has been updated.`, {
    ...o,
    toolUseResult: {
      type: 'update',
      filePath,
      structuredPatch: [
        { oldStart: 1, oldLines: patchLines.length - added, newStart: 1, newLines: patchLines.length - removed, lines: patchLines }
      ],
      originalFile: 'fake original\n'
    }
  })
}
/** Write (create) result: empty structuredPatch, `content` holds the new file. */
export const writeCreateResult = (toolUseId: string, filePath: string, content: string, o: ToolResultOpts = {}): Record<string, unknown> =>
  toolResult(toolUseId, `File created successfully at: ${filePath}`, {
    ...o,
    toolUseResult: { type: 'create', filePath, content, structuredPatch: [], originalFile: null }
  })
/** Result of an `Agent` tool call as the PARENT sees it (fact 4). */
export function agentResult(
  toolUseId: string,
  r: { agentId: string; status: 'completed' | 'async_launched' | string; text?: string; totalTokens?: number },
  o: ToolResultOpts = {}
): Record<string, unknown> {
  const content = r.text === undefined ? [] : [textBlock(r.text)]
  return toolResult(toolUseId, r.text ?? 'Async agent launched (fake).', {
    ...o,
    toolUseResult: {
      status: r.status,
      agentId: r.agentId,
      agentType: 'general-purpose',
      content,
      totalTokens: r.totalTokens ?? 0,
      totalDurationMs: 1234,
      toolStats: { readCount: 1 },
      usage: rawUsage(usage(1, 1))
    }
  })
}

// ---- system / titles / bookkeeping ----
export const systemLine = (
  subtype: string,
  o: LineOpts & { level?: string; extra?: Record<string, unknown> } = {}
): Record<string, unknown> => ({
  ...envelope('system', o),
  subtype,
  level: o.level ?? 'info',
  content: `fake ${subtype}`,
  ...(o.extra ?? {})
})
export const systemApiError = (retryAttempt: number, maxRetries: number, o: LineOpts = {}): Record<string, unknown> =>
  systemLine('api_error', { ...o, level: 'error', extra: { retryAttempt, maxRetries, retryInMs: 500, error: { status: 529 } } })

export const aiTitle = (title: string, sessionId = SESSION_ID): Record<string, unknown> => ({ type: 'ai-title', aiTitle: title, sessionId })
export const customTitle = (title: string, sessionId = SESSION_ID): Record<string, unknown> => ({
  type: 'custom-title',
  customTitle: title,
  sessionId
})
export const agentNameLine = (name: string, sessionId = SESSION_ID): Record<string, unknown> => ({ type: 'agent-name', agentName: name, sessionId })
export const relocatedLine = (relocatedCwd: string, sessionId = SESSION_ID): Record<string, unknown> => ({
  type: 'relocated',
  relocatedCwd,
  sessionId
})
export const attachmentLine = (o: LineOpts = {}): Record<string, unknown> => ({
  ...envelope('attachment', o),
  attachment: { type: 'fake_attachment', note: 'ignored' }
})

/** Types the parser must ignore (fact 6). */
export const IGNORABLE_TYPES = [
  'queue-operation',
  'api-request',
  'api-request-shape',
  'api-request-blob',
  'file-history-snapshot',
  'file-history-delta',
  'session-owner',
  'atis-latch',
  'last-prompt',
  'cost-state',
  'mode',
  'tools-used',
  'frame-link',
  'pr-link',
  'bridge-session',
  'isolation-latch',
  'artifact-snapshot',
  'totally-unknown-type'
] as const
export const bookkeepingLine = (type: string, sessionId = SESSION_ID): Record<string, unknown> => ({
  type,
  sessionId,
  note: 'fake bookkeeping payload',
  timestamp: at(0)
})

// ---- sub-agent meta + registry + secrets ----
export function subMeta(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentType: 'Explore',
    description: 'Explore repo',
    toolUseId: 'toolu_lead_agent1',
    spawnDepth: 1,
    isBuiltIn: true,
    requestShape: 'foreground',
    futureField: 'ignored',
    ...o
  }
}
/** A registry file as the CLI writes it, INCLUDING fields we must not copy (socket path, version...). */
export function registryEntry(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pid: 4242,
    sessionId: SESSION_ID,
    cwd: CWD,
    startedAt: T0_MS,
    updatedAt: T0_MS + 30_000,
    statusUpdatedAt: T0_MS + 40_000,
    status: 'idle',
    kind: 'interactive',
    entrypoint: 'cli',
    version: '0.0.0-test',
    name: 'demo session',
    messagingSocketPath: '\\\\.\\pipe\\fake-socket-do-not-copy',
    ...o
  }
}
export const FAKE_KEY_CONTENT = 'FAKE-KEY-0000-NOT-A-REAL-SECRET'
export const fakeKeyFile = (): string => FAKE_KEY_CONTENT
export const FAKE_CREDENTIALS_CONTENT = JSON.stringify({ fake: 'FAKE-TOKEN-NOT-REAL' })

// ---- serialisation ----
export const toLine = (o: unknown): string => JSON.stringify(o)
/** Join objects (or raw strings) into jsonl text. */
export function jsonl(items: unknown[], opts: { eol?: '\n' | '\r\n'; trailing?: boolean } = {}): string {
  const eol = opts.eol ?? '\n'
  const body = items.map((i) => (typeof i === 'string' ? i : toLine(i))).join(eol)
  return opts.trailing === false ? body : body + eol
}

// ---- sub-agent flavoured helpers (no toolUseResult on success, like real sub-agent files) ----
/** Successful sub-agent result for any tool: plain text, no toolUseResult. */
export const subOkResult = (toolUseId: string, text: string, o: LineOpts = {}): Record<string, unknown> => toolResult(toolUseId, text, o)
