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
  tokens?: { input: number; output: number }
  worktree?: string
  accountId: string
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
}
export interface Worktree {
  branch: string
  path: string
  agentIds: string[]
  changedFiles: number
  ahead: number
  overlapsWith?: string[]
}
export type SharedTaskState = 'done' | 'in_progress' | 'blocked' | 'failing'
export interface SharedTask {
  id: number
  title: string
  state: SharedTaskState
  ownerAgentId: string
  blockedBy?: number
  failingCount?: number
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
}
export interface FolderRule {
  pattern: string
  accountId: string | 'ask'
  note: string
}
export interface AccountProfile {
  id: string
  name: string
  color: string
  configDir: string
  folderRules: FolderRule[]
}
export interface AccountView extends AccountProfile {
  email?: string
  org?: string
  plan?: string
  signedIn: boolean
  tokensToday?: number
}
export interface DetectedLogin {
  configDir: string
  email?: string
  org?: string
  sources: string[]
  linkedAccountId?: string
  signedIn: boolean
  suggestedAccountId?: string
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
}
export type SignInStep = 'none' | 'waiting' | 'done'
export interface OkResult {
  ok: boolean
  reason?: string
}
