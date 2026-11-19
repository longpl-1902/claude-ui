import type {
  AccountsSnapshot,
  AgentEvent,
  AttentionPrefs,
  AttentionSnapshot,
  CatalogItem,
  CliPreview,
  CliRunResult,
  ControlDetails,
  Effort,
  FileSuggestion,
  ImageAttachment,
  McpAddRequest,
  McpConfigured,
  PluginInfo,
  RewindPreview,
  ControlPermissionMode,
  ControlSessionInfo,
  ControlStartRequest,
  ControlStartResult,
  ControlStreamEvent,
  ControlStreamState,
  FileDiff,
  HooksPreview,
  HooksStatus,
  KillExternalRequest,
  PermissionAnswer,
  WorkspaceSnapshot,
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
  ThemeSource,
  ThemeState,
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
  appOpenExternal: 'app:open-external',
  transcriptsListSessions: 'transcripts:list-sessions',
  transcriptsSelect: 'transcripts:select',
  transcriptsGetSelection: 'transcripts:get-selection',
  usageGetToday: 'usage:get-today',
  controlStart: 'control:start',
  controlSend: 'control:send',
  controlInterrupt: 'control:interrupt',
  controlStop: 'control:stop',
  controlAnswer: 'control:answer',
  controlSetModel: 'control:set-model',
  controlSetMode: 'control:set-mode',
  controlList: 'control:list',
  controlGetStream: 'control:get-stream',
  sessionKillExternal: 'session:kill-external',
  gitWatch: 'git:watch',
  gitCompare: 'git:compare',
  hooksStatus: 'hooks:status',
  hooksPreview: 'hooks:preview',
  hooksApply: 'hooks:apply',
  attentionGet: 'attention:get',
  attentionGetPrefs: 'attention:get-prefs',
  attentionSetPrefs: 'attention:set-prefs',
  controlDetails: 'control:details',
  controlSendRich: 'control:send-rich',
  controlRefreshContext: 'control:refresh-context',
  controlMcpToggle: 'control:mcp-toggle',
  controlMcpReconnect: 'control:mcp-reconnect',
  controlFileSuggestions: 'control:file-suggestions',
  controlRewindPreview: 'control:rewind-preview',
  controlRewind: 'control:rewind',
  controlForkAt: 'control:fork-at',
  controlSetEffort: 'control:set-effort',
  controlSetOutputStyle: 'control:set-output-style',
  controlRename: 'control:rename',
  controlGetPlan: 'control:get-plan',
  catalogList: 'catalog:list',
  catalogOpen: 'catalog:open',
  mcpList: 'mcp:list',
  mcpPreviewAdd: 'mcp:preview-add',
  mcpPreviewRemove: 'mcp:preview-remove',
  pluginsList: 'plugins:list',
  pluginsPreview: 'plugins:preview',
  cliApply: 'cli:apply',
  // main -> renderer pushes (not invokable)
  accountsChanged: 'accounts:changed',
  accountsSignInStatus: 'accounts:sign-in-status',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  teamChanged: 'team:changed',
  transcriptsSessionsChanged: 'transcripts:sessions-changed',
  usageChanged: 'usage:changed',
  controlChanged: 'control:changed',
  controlStream: 'control:stream',
  gitChanged: 'git:changed',
  hooksChanged: 'hooks:changed',
  attentionChanged: 'attention:changed',
  attentionFocus: 'attention:focus',
  // v5 push; the invoke 'control:details' owns that exact name, so the push is 'control:details-changed'
  controlDetailsChanged: 'control:details-changed'
} as const
/**
 * Theme channels (T31). Kept apart from IPC: the main process registers these itself (src/main/theme.ts), so they
 * are not part of the generic invoke-handler table.
 */
export const THEME_IPC = {
  get: 'theme:get', // invoke -> ThemeState
  setSource: 'theme:set-source', // invoke (ThemeSource) -> ThemeState
  changed: 'theme:changed' // main -> renderer push (ThemeState)
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
  IPC.usageChanged,
  IPC.controlChanged,
  IPC.controlStream,
  IPC.gitChanged,
  IPC.hooksChanged,
  IPC.attentionChanged,
  IPC.attentionFocus,
  IPC.controlDetailsChanged
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
  'app:open-external': { args: [url: string]; result: OkResult }
  'transcripts:list-sessions': { args: []; result: SessionSummary[] }
  'transcripts:select': { args: [sel: TeamSelection]; result: TeamSnapshot }
  'transcripts:get-selection': { args: []; result: TeamSelection }
  'usage:get-today': { args: []; result: UsageToday }
  'control:start': { args: [req: ControlStartRequest]; result: ControlStartResult }
  'control:send': { args: [controlId: string, text: string]; result: OkResult }
  'control:interrupt': { args: [controlId: string]; result: OkResult }
  'control:stop': { args: [controlId: string]; result: OkResult }
  'control:answer': { args: [controlId: string, requestId: string, answer: PermissionAnswer]; result: OkResult }
  'control:set-model': { args: [controlId: string, model: string | null]; result: OkResult }
  'control:set-mode': { args: [controlId: string, mode: ControlPermissionMode]; result: OkResult }
  'control:list': { args: []; result: ControlSessionInfo[] }
  'control:get-stream': { args: [controlId: string]; result: ControlStreamState | null }
  'session:kill-external': { args: [req: KillExternalRequest]; result: OkResult }
  'git:watch': { args: [root: string | null]; result: WorkspaceSnapshot }
  'git:compare': { args: [root: string, path: string]; result: FileDiff[] }
  'hooks:status': { args: [projectRoot: string | null]; result: HooksStatus }
  'hooks:preview': { args: [projectRoot: string, action: 'install' | 'uninstall']; result: HooksPreview | OkResult }
  'hooks:apply': { args: [previewId: string]; result: OkResult }
  'attention:get': { args: []; result: AttentionSnapshot }
  'attention:get-prefs': { args: []; result: AttentionPrefs }
  'attention:set-prefs': { args: [p: AttentionPrefs]; result: OkResult }
  'control:details': { args: [controlId: string]; result: ControlDetails | null }
  'control:send-rich': { args: [controlId: string, text: string, images: ImageAttachment[]]; result: OkResult }
  'control:refresh-context': { args: [controlId: string]; result: OkResult }
  'control:mcp-toggle': { args: [controlId: string, name: string, enabled: boolean]; result: OkResult }
  'control:mcp-reconnect': { args: [controlId: string, name: string]; result: OkResult }
  'control:file-suggestions': { args: [controlId: string | null, cwd: string, query: string]; result: FileSuggestion[] }
  'control:rewind-preview': { args: [controlId: string, uuid: string]; result: RewindPreview }
  'control:rewind': { args: [controlId: string, uuid: string]; result: OkResult }
  'control:fork-at': { args: [controlId: string, uuid: string]; result: ControlStartResult }
  'control:set-effort': { args: [controlId: string, effort: Effort | null]; result: OkResult }
  'control:set-output-style': { args: [controlId: string, style: string | null]; result: OkResult }
  'control:rename': { args: [controlId: string, title: string]; result: OkResult }
  'control:get-plan': { args: [controlId: string]; result: { exists: boolean; content?: string } }
  'catalog:list': { args: [projectRoot: string | null, accountId: string]; result: CatalogItem[] }
  'catalog:open': { args: [path: string]; result: OkResult }
  'mcp:list': { args: [projectRoot: string, accountId: string]; result: { servers: McpConfigured[]; ranAt: string; error?: string } }
  'mcp:preview-add': { args: [req: McpAddRequest]; result: CliPreview | OkResult }
  'mcp:preview-remove': { args: [projectRoot: string, accountId: string, name: string, scope: 'local' | 'user' | 'project' | null]; result: CliPreview | OkResult }
  'plugins:list': { args: [accountId: string]; result: { plugins: PluginInfo[]; error?: string } }
  'plugins:preview': { args: [accountId: string, action: 'enable' | 'disable' | 'install' | 'uninstall', id: string]; result: CliPreview | OkResult }
  'cli:apply': { args: [previewId: string]; result: CliRunResult }
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
  'app:open-external',
  'transcripts:list-sessions',
  'transcripts:select',
  'transcripts:get-selection',
  'usage:get-today',
  'control:start',
  'control:send',
  'control:interrupt',
  'control:stop',
  'control:answer',
  'control:set-model',
  'control:set-mode',
  'control:list',
  'control:get-stream',
  'session:kill-external',
  'git:watch',
  'git:compare',
  'hooks:status',
  'hooks:preview',
  'hooks:apply',
  'attention:get',
  'attention:get-prefs',
  'attention:set-prefs',
  'control:details',
  'control:send-rich',
  'control:refresh-context',
  'control:mcp-toggle',
  'control:mcp-reconnect',
  'control:file-suggestions',
  'control:rewind-preview',
  'control:rewind',
  'control:fork-at',
  'control:set-effort',
  'control:set-output-style',
  'control:rename',
  'control:get-plan',
  'catalog:list',
  'catalog:open',
  'mcp:list',
  'mcp:preview-add',
  'mcp:preview-remove',
  'plugins:list',
  'plugins:preview',
  'cli:apply'
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
  control: {
    start(req: ControlStartRequest): Promise<ControlStartResult>
    send(controlId: string, text: string): Promise<OkResult>
    interrupt(controlId: string): Promise<OkResult>
    stop(controlId: string): Promise<OkResult>
    answer(controlId: string, requestId: string, answer: PermissionAnswer): Promise<OkResult>
    setModel(controlId: string, model: string | null): Promise<OkResult>
    setMode(controlId: string, mode: ControlPermissionMode): Promise<OkResult>
    list(): Promise<ControlSessionInfo[]>
    getStream(controlId: string): Promise<ControlStreamState | null>
    onChanged(cb: (s: ControlSessionInfo[]) => void): () => void
    onStream(cb: (e: ControlStreamEvent[]) => void): () => void
    details(controlId: string): Promise<ControlDetails | null>
    sendRich(controlId: string, text: string, images: ImageAttachment[]): Promise<OkResult>
    refreshContext(controlId: string): Promise<OkResult>
    mcpToggle(controlId: string, name: string, enabled: boolean): Promise<OkResult>
    mcpReconnect(controlId: string, name: string): Promise<OkResult>
    fileSuggestions(controlId: string | null, cwd: string, query: string): Promise<FileSuggestion[]>
    rewindPreview(controlId: string, uuid: string): Promise<RewindPreview>
    rewind(controlId: string, uuid: string): Promise<OkResult>
    forkAt(controlId: string, uuid: string): Promise<ControlStartResult>
    setEffort(controlId: string, effort: Effort | null): Promise<OkResult>
    setOutputStyle(controlId: string, style: string | null): Promise<OkResult>
    rename(controlId: string, title: string): Promise<OkResult>
    getPlan(controlId: string): Promise<{ exists: boolean; content?: string }>
    onDetails(cb: (d: ControlDetails) => void): () => void
  }
  session: { killExternal(req: KillExternalRequest): Promise<OkResult> }
  git: {
    watch(root: string | null): Promise<WorkspaceSnapshot>
    compare(root: string, path: string): Promise<FileDiff[]>
    onChanged(cb: (s: WorkspaceSnapshot) => void): () => void
  }
  hooks: {
    status(projectRoot: string | null): Promise<HooksStatus>
    preview(projectRoot: string, action: 'install' | 'uninstall'): Promise<HooksPreview | OkResult>
    apply(previewId: string): Promise<OkResult>
    onChanged(cb: (s: HooksStatus) => void): () => void
  }
  attention: {
    get(): Promise<AttentionSnapshot>
    getPrefs(): Promise<AttentionPrefs>
    setPrefs(p: AttentionPrefs): Promise<OkResult>
    onChanged(cb: (s: AttentionSnapshot) => void): () => void
    onFocus(cb: (e: { itemId: string }) => void): () => void
  }
  catalog: {
    list(projectRoot: string | null, accountId: string): Promise<CatalogItem[]>
    open(path: string): Promise<OkResult>
  }
  mcp: {
    list(projectRoot: string, accountId: string): Promise<{ servers: McpConfigured[]; ranAt: string; error?: string }>
    previewAdd(req: McpAddRequest): Promise<CliPreview | OkResult>
    previewRemove(projectRoot: string, accountId: string, name: string, scope: 'local' | 'user' | 'project' | null): Promise<CliPreview | OkResult>
  }
  plugins: {
    list(accountId: string): Promise<{ plugins: PluginInfo[]; error?: string }>
    preview(accountId: string, action: 'enable' | 'disable' | 'install' | 'uninstall', id: string): Promise<CliPreview | OkResult>
  }
  cli: { apply(previewId: string): Promise<CliRunResult> }
  worktree: { openInEditor(path: string): Promise<OkResult> }
  theme?: {
    get(): Promise<ThemeState>
    setSource(source: ThemeSource): Promise<ThemeState>
    onChanged(cb: (s: ThemeState) => void): () => void
  }
  app: { getVersion(): Promise<string>; pickFolder(): Promise<string | null>; getDefaultCwd(): Promise<string>; openExternal(url: string): Promise<OkResult> }
}
