export interface TokenUsage {
  input: number
  output: number
  cacheCreation: number
  cacheRead: number
}
export interface ToolUseRec {
  id: string
  name: string
  /** See targetFor in parseLine.ts, max 160 chars. */
  target: string
  filePath?: string
  command?: string
  agent?: { description?: string; subagentType?: string; name?: string; background?: boolean }
  /** SendMessage: to = input.to ?? input.recipient. */
  send?: { to: string; text: string; summary?: string }
  /** Line counts from the tool input (Write/Edit/MultiEdit/NotebookEdit); sub-agent results carry no toolUseResult. */
  edit?: { added: number; removed: number; kind: 'create' | 'update' | 'unknown' }
  /** TaskCreate / TaskUpdate / TaskList / TodoWrite inputs (strings max 200, arrays max 100). */
  task?:
    | { op: 'create'; subject: string; description?: string }
    | { op: 'update'; taskId: string; status?: string; subject?: string; owner?: string; addBlockedBy?: string[] }
    | { op: 'list' }
    | { op: 'todo'; todos: { content: string; status: string }[] }
}
export interface FileChange {
  path: string
  kind: 'create' | 'update'
  added: number
  removed: number
}
export interface ToolResultRec {
  toolUseId: string
  /** tool_result.is_error === true, a string toolUseResult starting 'Error', or a denial. */
  isError: boolean
  /** toolUseResult.interrupted === true or denial in {interrupted, cancelled}. */
  interrupted: boolean
  /** line.toolDenialKind */
  denial?: string
  /** First non-empty line of the result text, max 200 chars ('' if none). */
  summary: string
  fileChange?: FileChange
  /** text max 500 */
  agentResult?: { agentId: string; status: string; totalTokens?: number; text?: string }
  /** SendMessage toolUseResult.success */
  sendOk?: boolean
  /** TaskCreate result id (toolUseResult.task.id) / TaskList result (toolUseResult.tasks). */
  task?: { createdId?: string; list?: { id: string; subject: string; status: string; owner?: string; blockedBy: string[] }[] }
}
interface Base {
  uuid: string
  ts: string
  tsMs: number
  sessionId: string
  agentId?: string
  cwd?: string
  gitBranch?: string
}
export type TranscriptRecord =
  | (Base & {
      t: 'assistant'
      messageId: string
      model: string
      stopReason: string | null
      usage?: TokenUsage
      toolUses: ToolUseRec[]
      text?: string
      isApiError: boolean
      errorKind?: string
    })
  | (Base & { t: 'tool_results'; results: ToolResultRec[] })
  | (Base & { t: 'prompt'; text: string; kind: 'user' | 'command' | 'task-notification' | 'compact-summary' | 'first-task' })
  | (Base & { t: 'interrupted' })
  | (Base & { t: 'system'; subtype: string; level?: string; fatal: boolean })
  | { t: 'title'; sessionId: string; kind: 'ai' | 'custom' | 'agent-name'; value: string }
