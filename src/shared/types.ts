export type AgentEventKind = 'tool_start' | 'tool_end' | 'message' | 'status' | 'error' | 'spawn' | 'stop'
export type AgentEvent = {
  ts: string
  sessionId: string
  agentId: string
  parentAgentId?: string
  kind: AgentEventKind
  tool?: string
  target?: string
  result?: string
  tokens?: { input: number; output: number; cacheCreation?: number; cacheRead?: number }
  worktree?: string
  accountId: string
  toolUseId?: string
  uuid?: string
  failed?: boolean
}
export type AgentStatus = 'running' | 'waiting' | 'needs-you' | 'done'
export type ActivityKind = 'think' | 'read' | 'edit' | 'bash' | 'wait' | 'error'
export interface TimelineSegment {
  kind: ActivityKind
  startPct: number
  widthPct: number
}
export interface ActivityItem {
  time: string
  tool: string
  target: string
  result: string
  failed?: boolean
}
export interface ChangedFile {
  path: string
  added: number
  removed: number
}
export interface MailboxMessage {
  direction: 'in' | 'out'
  peer: string
  time: string
  text: string
}
export type TeamSource = 'live' | 'demo' | 'empty'
export type LiveAgentKind = 'lead' | 'subagent' | 'teammate'
export type LastTurn = 'none' | 'user' | 'tool_result' | 'assistant_tool_use' | 'assistant_end' | 'interrupted' | 'api_error'
export interface OpenTool { id: string; name: string; startedMs: number }
export type RegistryStatus = 'busy' | 'idle' | 'waiting'
export interface AgentRuntime {
  kind: LiveAgentKind
  startedMs: number // first line ts of this agent
  lastActivityMs: number // newest timestamped line of this agent
  openTools: OpenTool[] // tool_use without a tool_result yet (matched by id)
  lastTurn: LastTurn
  errorKind?: string // assistant.error ('rate_limit', ...) when lastTurn === 'api_error'
  finished?: boolean // sub-agent finished (meta.finished | parent got 'completed' | end_turn w/o open tool)
  background?: boolean // meta.requestShape === 'background' or Agent result status 'async_launched'
  registry?: { status: RegistryStatus; waitingFor?: string; updatedMs: number } // lead only, live pid
  hook?: { pendingPermission?: { toolName: string; sinceMs: number }; notification?: { type: string; sinceMs: number }; lastEventMs: number }
}
export interface Agent {
  id: string
  name: string
  initials: string
  avatarColor: string
  role: string
  model: string
  worktree: string // branch name, e.g. 'feat/api-schema'
  taskTitle: string // '#2 Schema v2 for SheetDto'
  current: { tool: string; target: string }
  elapsedSec: number
  tokens: number
  toolCalls: number
  timeline: TimelineSegment[]
  activity: ActivityItem[]
  files: ChangedFile[]
  messages: MailboxMessage[]
  parentId?: string
  depth?: number
  runtime?: AgentRuntime
  cwd?: string
  spans?: ActivitySpan[]
}
export interface Worktree {
  branch: string
  path: string
  agentIds: string[]
  changedFiles: number
  ahead: number
  overlapsWith?: string[]
  behind?: number
  files?: string[]
  isMain?: boolean
  error?: string
}
export type SharedTaskState = 'done' | 'in_progress' | 'blocked' | 'failing' | 'pending'
export interface SharedTask {
  id: number
  title: string
  state: SharedTaskState
  ownerAgentId: string
  blockedBy?: number
  failingCount?: number
  blockers?: number[]
  source?: 'task' | 'todo'
  description?: string
}
export interface FileOverlap {
  path: string
  agentIds: string[]
  worktrees: string[]
}
export interface ConsoleLine {
  time: string
  who: string // 'you' or an agent id
  text: string
}
export interface TeamSnapshot {
  repo: string
  teamName: string
  accountId: string
  now: string // ISO timestamp used as "now" for derivation
  agents: Agent[]
  events: AgentEvent[]
  worktrees: Worktree[]
  tasks: SharedTask[]
  overlaps: FileOverlap[]
  console: ConsoleLine[]
  timelineTicks: string[]
  source?: TeamSource
  sessionId?: string
  cwd?: string
  title?: string
  historyTruncated?: boolean
  waitingForSession?: boolean
  hooksActive?: boolean
}
export interface FolderRule {
  pattern: string
  accountId: string | 'ask'
  note: string
}
export type AccountKind = 'company' | 'personal'
export interface AccountProfile {
  id: string
  name: string
  color: string
  configDir: string
  kind?: AccountKind
  folderRules: FolderRule[]
}
export interface AccountView extends AccountProfile {
  email?: string
  org?: string
  plan?: string
  signedIn: boolean
  tokensToday?: number
  locked?: boolean
  isDefaultDir?: boolean
}
export interface DetectedLogin {
  configDir: string
  email?: string
  org?: string
  sources: string[]
  linkedAccountId?: string
  signedIn: boolean
  suggestedAccountId?: string
  isDefaultDir?: boolean
  exists?: boolean
  warnings?: string[]
}
export type LimitPolicy = 'pause' | 'wait' | 'switch'
export interface SafetySettings {
  warnPersonalInCompanyFolder: boolean
  showAccountColorEdge: boolean
  lockAccountOnTeamStart: boolean
}
export interface RunningSession {
  teamName: string
  path: string
  accountId: string
  agentCount: number
  ptyId?: string
}
export interface AccountsSnapshot {
  accounts: AccountView[]
  defaultAccountId: string
  activeAccountId: string
  detected: DetectedLogin[]
  rules: FolderRule[]
  safety: SafetySettings
  limitPolicy: LimitPolicy
  sessions: RunningSession[]
  ptyAvailable?: boolean
  claudeFound?: boolean
}
export type SignInStep = 'none' | 'waiting' | 'done' | 'error'
export interface SignInStatus {
  configDir: string
  step: SignInStep
  email?: string
  org?: string
  ptyId?: string
  reason?: string
}
export interface AccountsFile {
  version: 1
  profiles: AccountProfile[]
  rules: FolderRule[]
  defaultAccountId: string | null
  safety: SafetySettings
  limitPolicy: LimitPolicy
}
export interface ProfileInput {
  id?: string
  name: string
  color: string
  configDir: string
  kind?: AccountKind
}
export interface LinkDetectedRequest {
  configDir: string
  accountId?: string
  name?: string
  color?: string
  kind?: AccountKind
}
export interface OkResult {
  ok: boolean
  reason?: string
}
export interface OkWithId extends OkResult {
  accountId?: string
}
export interface FolderResolution {
  accountId: string | 'ask'
  ruleIndex: number // -1 = fallback
  pattern?: string
}
export type LaunchWarning = 'personal-in-company-folder'
export type LaunchBlock = 'account-locked' | 'unknown-account' | 'pty-unavailable' | 'claude-not-found' | 'invalid-folder'
export interface LaunchCheck {
  allowed: boolean
  warnings: LaunchWarning[]
  blockedReason?: LaunchBlock
  matched: FolderResolution
}
export type PtyPurpose = 'claude' | 'login'
export interface PtyInfo {
  id: string
  purpose: PtyPurpose
  cwd: string
  accountId?: string
  configDir: string
  pid: number
  startedAt: string
  exitCode?: number
}
export interface PtySpawnRequest {
  cwd: string
  accountId: string
  cols: number
  rows: number
  confirmed?: boolean
}
export interface PtySpawnResult {
  ok: boolean
  ptyId?: string
  reason?: LaunchBlock | 'needs-confirmation' | 'invalid-args' | 'spawn-failed'
  warnings?: LaunchWarning[]
}
export interface PtyDataEvent {
  ptyId: string
  data: string
  /** Running output offset (UTF-16 units written since spawn) after this chunk. */
  end: number
}
/** Ring-buffer contents plus the running offset they end at. */
export interface PtyBufferSnapshot {
  data: string
  end: number
}
export interface PtyExitEvent {
  ptyId: string
  exitCode: number
}

export interface SessionProject {
  key: string // normalized root (forward slashes, lower-cased on win32)
  name: string // basename of root
  root: string // display path
  git: boolean
}
export interface SessionSummary {
  sessionId: string
  accountId: string // '' when the config dir is not linked to a profile
  configDir: string // absolute
  projectDir: string // encoded folder name under projects/
  cwd?: string // from the first line carrying cwd (real folder)
  title?: string // last custom-title ?? ai-title ?? agent-name
  mtimeMs: number
  sizeBytes: number
  live?: boolean // registry entry with a live pid
  registryStatus?: RegistryStatus
  project?: SessionProject // git project (linked worktrees map to the main repo); provisional until git answers
  controlled?: boolean
  controlId?: string
  entrypoint?: string
  registryPid?: number
}
export type TeamSelection = { mode: 'auto'; projectKey?: string } | { mode: 'session'; accountId: string; sessionId: string }
export interface TokenTotals { input: number; output: number; cacheCreation: number; cacheRead: number }
export interface UsageToday {
  day: string // local YYYY-MM-DD
  byAccount: Record<string, TokenTotals> // key '' = unlinked default dir
}

// ---- Contract v4 (control sessions, worktrees, hooks, attention) ----
export type ControlPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk'
export type ControlState = 'draft' | 'starting' | 'idle' | 'busy' | 'stopping' | 'exited'
export type ControlResume = { kind: 'resume'; sessionId: string; fork?: boolean } | { kind: 'continue' }
export interface ControlStartRequest { cwd: string; accountId: string; confirmed?: boolean; resume?: ControlResume; model?: string; permissionMode?: ControlPermissionMode; effort?: Effort; outputStyle?: string; resumeAt?: string /* user message uuid, requires resume.fork */ }
export interface ControlStartResult { ok: boolean; controlId?: string; reason?: LaunchBlock | 'needs-confirmation' | 'invalid-args' | 'session-live-elsewhere'; warnings?: LaunchWarning[] }
export interface PermissionPrompt { requestId: string; toolName: string; displayName: string; toolUseId?: string; description?: string; inputPreview: string; decisionReason?: string; blockedPath?: string; receivedAt: string; canAllowSession?: boolean }
export interface PermissionAnswer { behavior: 'allow' | 'deny'; message?: string; scope?: 'once' | 'session'; answers?: Record<string, string> /* AskUserQuestion */ }
export interface ControlSessionInfo { id: string; accountId: string; cwd: string; state: ControlState; permissionMode: ControlPermissionMode; model?: string; resume?: ControlResume; pid?: number; sessionId?: string; startedAt?: string; exitCode?: number; error?: string; slashCommands: string[]; pendingPermissions: number; lastResult?: 'success' | 'interrupted' | 'error'; queuedTurns: number }
export type ControlStreamEvent =
  | { controlId: string; kind: 'typing'; messageId: string; text: string }
  | { controlId: string; kind: 'typing-clear' }
  | { controlId: string; kind: 'thinking'; active: boolean }
  | { controlId: string; kind: 'permission'; prompt: PermissionPrompt }
  | { controlId: string; kind: 'permission-resolved'; requestId: string }
  | { controlId: string; kind: 'turn-end'; result: 'success' | 'interrupted' | 'error'; text?: string; costUsd?: number; denials?: number }
  | { controlId: string; kind: 'notice'; level: 'info' | 'error'; text: string }
export interface ControlStreamState { controlId: string; typing?: { messageId: string; text: string }; thinking: boolean; permissions: PermissionPrompt[]; notices: { level: 'info' | 'error'; text: string; time: string }[] }
export interface KillExternalRequest { accountId: string; sessionId: string; pid: number }
export interface ChangedFileEntry { path: string; status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'; added?: number; removed?: number; committed: boolean; uncommitted: boolean }
export interface WorktreeInfo { path: string; branch?: string; head: string; detached: boolean; isMain: boolean; locked?: boolean; prunable?: boolean; ahead: number | null; behind: number | null; files: ChangedFileEntry[]; changedFiles: number; error?: string }
export interface WorktreeOverlap { path: string; worktrees: string[] } // worktree paths
export interface WorkspaceSnapshot { root: string | null; base: string | null; worktrees: WorktreeInfo[]; overlaps: WorktreeOverlap[]; updatedAt: string; error?: string }
export interface FileDiff { worktreePath: string; branch?: string; diff: string; truncated: boolean }
export type HookEventName = 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'PermissionRequest' | 'PermissionDenied' | 'Notification' | 'Stop' | 'StopFailure' | 'SubagentStart' | 'SubagentStop' | 'TeammateIdle' | 'TaskCreated' | 'TaskCompleted'
export interface HookEvent { event: HookEventName; sessionId: string; receivedMs: number; cwd?: string; agentId?: string; agentType?: string; permissionMode?: string; toolName?: string; toolUseId?: string; notificationType?: string; message?: string; error?: string; isInterrupt?: boolean; taskId?: string; taskSubject?: string; teammateName?: string; source?: string; reason?: string }
export type HooksState = 'not-installed' | 'installed' | 'partial' | 'outdated' | 'unavailable'
export interface HooksStatus { projectRoot: string | null; settingsPath: string | null; state: HooksState; nodePath?: string; reason?: string; server: { listening: boolean; port?: number }; eventsReceived: number; lastEventAt?: string }
export interface HooksPreview { previewId: string; action: 'install' | 'uninstall'; settingsPath: string; before: string | null; after: string | null; backupPath?: string; scriptPath: string; notes: string[] }
export interface ActivitySpan { kind: ActivityKind; startMs: number; endMs: number | null } // null = still open
export type AttentionKind = 'permission' | 'question' | 'plan' | 'api-error' | 'input'
export type AttentionSeverity = 'blocked' | 'idle'
export interface AttentionItem { id: string; kind: AttentionKind; severity: AttentionSeverity; projectKey: string; projectName: string; accountId: string; sessionId: string; agentId: string; agentName: string; detail: string; sinceMs: number; external: boolean; cwd?: string; controlId?: string; requestId?: string; canAllowSession?: boolean; toolName?: string; input?: string }
export interface ProjectStatus { key: string; name: string; root: string; git: boolean; accountIds: string[]; mixedAccounts: boolean; liveSessions: number; running: number; waiting: number; needsYou: number; tokensToday: number; lastActivityMs: number; hooksActive: boolean }
export interface AttentionSnapshot { items: AttentionItem[]; projects: ProjectStatus[]; updatedAt: string }
export interface AttentionPrefs { mutedProjects: string[]; dnd: boolean; notifyErrors: boolean; notifyIdle?: boolean; viewedProjectKey?: string }

// ---- Contract v5: VS Code parity (T23) ----
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CommandSource = 'builtin' | 'user' | 'project' | 'plugin' | 'skill' | 'mcp' | 'unknown'
export interface SlashCommandInfo { name: string; description: string; argumentHint?: string; source: CommandSource; aliases?: string[] }
export type McpLiveStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
export interface McpServerLive { name: string; status: McpLiveStatus; serverInfo?: { name: string; version: string }; error?: string }
export interface ContextUsage { totalTokens: number; maxTokens: number; percentage: number; categories: { name: string; tokens: number; percentage: number }[]; model?: string; fetchedAt: string }
export interface TurnCost { costUsd?: number; input: number; output: number; cacheCreation: number; cacheRead: number; durationMs?: number }
export interface UserTurnRef { uuid: string; text: string; time: string } // text <= 120 chars
export interface ControlDetails {
  controlId: string
  commands: SlashCommandInfo[]
  agents: { name: string; description?: string }[]
  models: { value: string; displayName: string; description?: string }[]
  outputStyle?: string
  availableOutputStyles: string[]
  effort?: Effort
  mcp: McpServerLive[]
  tools: string[]
  context?: ContextUsage
  lastTurn?: TurnCost
  sessionCostUsd: number
  userTurns: UserTurnRef[]
  checkpointing: boolean
  title?: string
}
export interface ImageAttachment { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string; name?: string } // <= 5 MiB decoded each, <= 5 per turn
export interface RewindPreview { canRewind: boolean; filesChanged: string[]; insertions: number; deletions: number; error?: string }
export interface FileSuggestion { path: string; score?: number }
export type CatalogKind = 'skill' | 'agent' | 'command' | 'output-style'
export interface CatalogItem { kind: CatalogKind; name: string; description?: string; scope: 'user' | 'project' | 'plugin'; plugin?: string; path: string; argumentHint?: string; model?: string }
export interface PluginInfo { id: string; name: string; marketplace?: string; version?: string; enabled: boolean; scope?: string; description?: string }
export interface McpConfigured { name: string; scope: 'local' | 'user' | 'project' | 'plugin' | 'unknown'; transport?: string; target: string; status: string; pendingApproval?: boolean } // target masked
export interface McpAddRequest { projectRoot: string; accountId: string; name: string; scope: 'local' | 'user' | 'project'; transport: 'stdio' | 'http' | 'sse'; commandOrUrl: string; args: string[]; env: Record<string, string>; headers: Record<string, string> }
export interface CliPreview { previewId: string; argvDisplay: string[]; cwd: string; configDir: string; effect: string; warnings: string[] } // secrets masked in argvDisplay
export interface CliRunResult { ok: boolean; reason?: string; output?: string } // output masked, <= 4 KiB

// ---- Theme (T31) ----

/** The user's choice: follow Windows, or force one theme. */
export type ThemeSource = 'system' | 'light' | 'dark'

/** What the renderer applies: pushed by the main process on every Windows theme / accent / contrast change. */
export interface ThemeState {
  mode: 'light' | 'dark'
  /** Windows accent colour as #RRGGBB, or null when unavailable. The renderer decides whether it is usable. */
  accent: string | null
  highContrast: boolean
}
