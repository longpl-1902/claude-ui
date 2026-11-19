import type {
  AccountsSnapshot,
  AgentEvent,
  FolderResolution,
  FolderRule,
  LaunchCheck,
  LimitPolicy,
  LinkDetectedRequest,
  OkResult,
  OkWithId,
  ProfileInput,
  PtyBufferSnapshot,
  PtyDataEvent,
  PtyExitEvent,
  PtyInfo,
  PtySpawnRequest,
  PtySpawnResult,
  SafetySettings,
  SessionSummary,
  SignInStatus,
  TeamSelection,
  TeamSnapshot,
  UsageToday
} from './types'

export const IPC = {
  teamGetSnapshot: 'team:get-snapshot',
  teamEvent: 'team:event', // main -> renderer push
  accountsGetSnapshot: 'accounts:get-snapshot',
  accountsSetDefault: 'accounts:set-default',
  accountsStartSignIn: 'accounts:start-sign-in',
  accountsCheckSignIn: 'accounts:check-sign-in',
  accountsCancelSignIn: 'accounts:cancel-sign-in',
  agentSendMessage: 'agent:send-message',
  agentPause: 'agent:pause',
  agentStop: 'agent:stop',
  teamPauseAll: 'team:pause-all',
  worktreeOpenInEditor: 'worktree:open-in-editor',
  appGetVersion: 'app:get-version',
  accountsScan: 'accounts:scan',
  accountsLinkDetected: 'accounts:link-detected',
  accountsSaveProfile: 'accounts:save-profile',
  accountsRemoveProfile: 'accounts:remove-profile',
  accountsSetRules: 'accounts:set-rules',
  accountsSetSafety: 'accounts:set-safety',
  accountsSetLimitPolicy: 'accounts:set-limit-policy',
  accountsResolveFolder: 'accounts:resolve-folder',
  accountsCheckLaunch: 'accounts:check-launch',
  accountsReopenSignIn: 'accounts:reopen-sign-in',
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyGetBuffer: 'pty:get-buffer',
  appPickFolder: 'app:pick-folder',
  appGetDefaultCwd: 'app:get-default-cwd',
  transcriptsListSessions: 'transcripts:list-sessions',
  transcriptsSelect: 'transcripts:select',
  transcriptsGetSelection: 'transcripts:get-selection',
  usageGetToday: 'usage:get-today',
  // main -> renderer pushes (not invokable)
  accountsChanged: 'accounts:changed',
  accountsSignInStatus: 'accounts:sign-in-status',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  teamChanged: 'team:changed',
  transcriptsSessionsChanged: 'transcripts:sessions-changed',
  usageChanged: 'usage:changed'
} as const
export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export const PUSH_CHANNELS = [
  IPC.teamEvent,
  IPC.accountsChanged,
  IPC.accountsSignInStatus,
  IPC.ptyData,
  IPC.ptyExit,
  IPC.teamChanged,
  IPC.transcriptsSessionsChanged,
  IPC.usageChanged
] as const

export interface IpcInvokeMap {
  'team:get-snapshot': { args: []; result: TeamSnapshot }
  'accounts:get-snapshot': { args: []; result: AccountsSnapshot }
  'accounts:set-default': { args: [accountId: string]; result: OkResult }
  'accounts:start-sign-in': { args: [configDir: string]; result: OkResult }
  'accounts:check-sign-in': { args: [configDir: string]; result: SignInStatus }
  'accounts:cancel-sign-in': { args: [configDir: string]; result: OkResult }
  'agent:send-message': { args: [agentId: string, text: string]; result: OkResult }
  'agent:pause': { args: [agentId: string]; result: OkResult }
  'agent:stop': { args: [agentId: string]; result: OkResult }
  'team:pause-all': { args: []; result: OkResult }
  'worktree:open-in-editor': { args: [path: string]; result: OkResult }
  'app:get-version': { args: []; result: string }
  'accounts:scan': { args: []; result: AccountsSnapshot }
  'accounts:link-detected': { args: [req: LinkDetectedRequest]; result: OkWithId }
  'accounts:save-profile': { args: [p: ProfileInput]; result: OkWithId }
  'accounts:remove-profile': { args: [accountId: string]; result: OkResult }
  'accounts:set-rules': { args: [rules: FolderRule[]]; result: OkResult }
  'accounts:set-safety': { args: [s: SafetySettings]; result: OkResult }
  'accounts:set-limit-policy': { args: [p: LimitPolicy]; result: OkResult }
  'accounts:resolve-folder': { args: [folder: string]; result: FolderResolution }
  'accounts:check-launch': { args: [folder: string, accountId: string]; result: LaunchCheck }
  'accounts:reopen-sign-in': { args: [configDir: string]; result: OkResult }
  'pty:spawn': { args: [req: PtySpawnRequest]; result: PtySpawnResult }
  'pty:write': { args: [ptyId: string, data: string]; result: OkResult }
  'pty:resize': { args: [ptyId: string, cols: number, rows: number]; result: OkResult }
  'pty:kill': { args: [ptyId: string]; result: OkResult }
  'pty:list': { args: []; result: PtyInfo[] }
  'pty:get-buffer': { args: [ptyId: string]; result: PtyBufferSnapshot }
  'app:pick-folder': { args: []; result: string | null }
  'app:get-default-cwd': { args: []; result: string }
  'transcripts:list-sessions': { args: []; result: SessionSummary[] }
  'transcripts:select': { args: [sel: TeamSelection]; result: TeamSnapshot }
  'transcripts:get-selection': { args: []; result: TeamSelection }
  'usage:get-today': { args: []; result: UsageToday }
}
export type InvokeChannel = keyof IpcInvokeMap

// Compile-time exhaustiveness: this errors if a key of IpcInvokeMap is missing from the list.
const invokeChannelList = [
  'team:get-snapshot',
  'accounts:get-snapshot',
  'accounts:set-default',
  'accounts:start-sign-in',
  'accounts:check-sign-in',
  'accounts:cancel-sign-in',
  'agent:send-message',
  'agent:pause',
  'agent:stop',
  'team:pause-all',
  'worktree:open-in-editor',
  'app:get-version',
  'accounts:scan',
  'accounts:link-detected',
  'accounts:save-profile',
  'accounts:remove-profile',
  'accounts:set-rules',
  'accounts:set-safety',
  'accounts:set-limit-policy',
  'accounts:resolve-folder',
  'accounts:check-launch',
  'accounts:reopen-sign-in',
  'pty:spawn',
  'pty:write',
  'pty:resize',
  'pty:kill',
  'pty:list',
  'pty:get-buffer',
  'app:pick-folder',
  'app:get-default-cwd',
  'transcripts:list-sessions',
  'transcripts:select',
  'transcripts:get-selection',
  'usage:get-today'
] as const satisfies readonly InvokeChannel[]
type MissingChannels = Exclude<InvokeChannel, (typeof invokeChannelList)[number]>
const _exhaustive: [MissingChannels] extends [never] ? true : never = true
void _exhaustive

export const INVOKE_CHANNELS: InvokeChannel[] = [...invokeChannelList]

// Push channels must never be invokable: compile-time check that the two sets are disjoint.
type PushChannel = (typeof PUSH_CHANNELS)[number]
const _disjoint: [Extract<InvokeChannel, PushChannel>] extends [never] ? true : never = true
void _disjoint

export interface ConsoleApi {
  team: {
    getSnapshot(): Promise<TeamSnapshot>
    pauseAll(): Promise<OkResult>
    onEvent(cb: (e: AgentEvent) => void): () => void
    onChanged(cb: (s: TeamSnapshot) => void): () => void
  }
  accounts: {
    getSnapshot(): Promise<AccountsSnapshot>
    setDefault(id: string): Promise<OkResult>
    startSignIn(dir: string): Promise<OkResult>
    checkSignIn(dir: string): Promise<SignInStatus>
    cancelSignIn(dir: string): Promise<OkResult>
    scan(): Promise<AccountsSnapshot>
    linkDetected(req: LinkDetectedRequest): Promise<OkWithId>
    saveProfile(p: ProfileInput): Promise<OkWithId>
    removeProfile(id: string): Promise<OkResult>
    setRules(r: FolderRule[]): Promise<OkResult>
    setSafety(s: SafetySettings): Promise<OkResult>
    setLimitPolicy(p: LimitPolicy): Promise<OkResult>
    resolveFolder(folder: string): Promise<FolderResolution>
    checkLaunch(folder: string, accountId: string): Promise<LaunchCheck>
    reopenSignIn(dir: string): Promise<OkResult>
    onChanged(cb: (s: AccountsSnapshot) => void): () => void
    onSignInStatus(cb: (s: SignInStatus) => void): () => void
  }
  pty: {
    spawn(req: PtySpawnRequest): Promise<PtySpawnResult>
    write(id: string, data: string): Promise<OkResult>
    resize(id: string, cols: number, rows: number): Promise<OkResult>
    kill(id: string): Promise<OkResult>
    list(): Promise<PtyInfo[]>
    getBuffer(id: string): Promise<PtyBufferSnapshot>
    onData(cb: (e: PtyDataEvent) => void): () => void
    onExit(cb: (e: PtyExitEvent) => void): () => void
  }
  transcripts: {
    listSessions(): Promise<SessionSummary[]>
    select(sel: TeamSelection): Promise<TeamSnapshot>
    getSelection(): Promise<TeamSelection>
    onSessionsChanged(cb: (s: SessionSummary[]) => void): () => void
  }
  usage: {
    getToday(): Promise<UsageToday>
    onChanged(cb: (u: UsageToday) => void): () => void
  }
  agent: {
    sendMessage(id: string, text: string): Promise<OkResult>
    pause(id: string): Promise<OkResult>
    stop(id: string): Promise<OkResult>
  }
  worktree: { openInEditor(path: string): Promise<OkResult> }
  app: { getVersion(): Promise<string>; pickFolder(): Promise<string | null>; getDefaultCwd(): Promise<string> }
}
