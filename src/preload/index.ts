import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { ConsoleApi, InvokeChannel, IpcInvokeMap } from '@shared/ipc'
import type {
  AccountsSnapshot,
  AgentEvent,
  AttentionSnapshot,
  ControlDetails,
  ControlSessionInfo,
  ControlStreamEvent,
  HooksStatus,
  WorkspaceSnapshot,
  PtyDataEvent,
  PtyExitEvent,
  SessionSummary,
  SignInStatus,
  TeamSnapshot,
  UsageToday
} from '@shared/types'

function invoke<C extends InvokeChannel>(
  c: C,
  ...args: IpcInvokeMap[C]['args']
): Promise<IpcInvokeMap[C]['result']> {
  return ipcRenderer.invoke(c, ...args) as Promise<IpcInvokeMap[C]['result']>
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: ConsoleApi = {
  team: {
    getSnapshot: () => invoke(IPC.teamGetSnapshot),
    pauseAll: () => invoke(IPC.teamPauseAll),
    onEvent: (cb) => on<AgentEvent>(IPC.teamEvent, cb),
    onChanged: (cb) => on<TeamSnapshot>(IPC.teamChanged, cb)
  },
  accounts: {
    getSnapshot: () => invoke(IPC.accountsGetSnapshot),
    setDefault: (id) => invoke(IPC.accountsSetDefault, id),
    startSignIn: (dir) => invoke(IPC.accountsStartSignIn, dir),
    checkSignIn: (dir) => invoke(IPC.accountsCheckSignIn, dir),
    cancelSignIn: (dir) => invoke(IPC.accountsCancelSignIn, dir),
    scan: () => invoke(IPC.accountsScan),
    linkDetected: (req) => invoke(IPC.accountsLinkDetected, req),
    saveProfile: (p) => invoke(IPC.accountsSaveProfile, p),
    removeProfile: (id) => invoke(IPC.accountsRemoveProfile, id),
    setRules: (r) => invoke(IPC.accountsSetRules, r),
    setSafety: (s) => invoke(IPC.accountsSetSafety, s),
    setLimitPolicy: (p) => invoke(IPC.accountsSetLimitPolicy, p),
    resolveFolder: (folder) => invoke(IPC.accountsResolveFolder, folder),
    checkLaunch: (folder, accountId) => invoke(IPC.accountsCheckLaunch, folder, accountId),
    reopenSignIn: (dir) => invoke(IPC.accountsReopenSignIn, dir),
    onChanged: (cb) => on<AccountsSnapshot>(IPC.accountsChanged, cb),
    onSignInStatus: (cb) => on<SignInStatus>(IPC.accountsSignInStatus, cb)
  },
  pty: {
    spawn: (req) => invoke(IPC.ptySpawn, req),
    write: (id, data) => invoke(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => invoke(IPC.ptyResize, id, cols, rows),
    kill: (id) => invoke(IPC.ptyKill, id),
    list: () => invoke(IPC.ptyList),
    getBuffer: (id) => invoke(IPC.ptyGetBuffer, id),
    onData: (cb) => on<PtyDataEvent>(IPC.ptyData, cb),
    onExit: (cb) => on<PtyExitEvent>(IPC.ptyExit, cb)
  },
  transcripts: {
    listSessions: () => invoke(IPC.transcriptsListSessions),
    select: (sel) => invoke(IPC.transcriptsSelect, sel),
    getSelection: () => invoke(IPC.transcriptsGetSelection),
    onSessionsChanged: (cb) => on<SessionSummary[]>(IPC.transcriptsSessionsChanged, cb)
  },
  usage: {
    getToday: () => invoke(IPC.usageGetToday),
    onChanged: (cb) => on<UsageToday>(IPC.usageChanged, cb)
  },
  agent: {
    sendMessage: (id, text) => invoke(IPC.agentSendMessage, id, text),
    pause: (id) => invoke(IPC.agentPause, id),
    stop: (id) => invoke(IPC.agentStop, id)
  },
  control: {
    start: (req) => invoke(IPC.controlStart, req),
    send: (id, text) => invoke(IPC.controlSend, id, text),
    interrupt: (id) => invoke(IPC.controlInterrupt, id),
    stop: (id) => invoke(IPC.controlStop, id),
    answer: (id, requestId, answer) => invoke(IPC.controlAnswer, id, requestId, answer),
    setModel: (id, model) => invoke(IPC.controlSetModel, id, model),
    setMode: (id, mode) => invoke(IPC.controlSetMode, id, mode),
    list: () => invoke(IPC.controlList),
    getStream: (id) => invoke(IPC.controlGetStream, id),
    onChanged: (cb) => on<ControlSessionInfo[]>(IPC.controlChanged, cb),
    onStream: (cb) => on<ControlStreamEvent[]>(IPC.controlStream, cb),
    details: (id) => invoke(IPC.controlDetails, id),
    sendRich: (id, text, images) => invoke(IPC.controlSendRich, id, text, images),
    refreshContext: (id) => invoke(IPC.controlRefreshContext, id),
    mcpToggle: (id, name, enabled) => invoke(IPC.controlMcpToggle, id, name, enabled),
    mcpReconnect: (id, name) => invoke(IPC.controlMcpReconnect, id, name),
    fileSuggestions: (id, cwd, query) => invoke(IPC.controlFileSuggestions, id, cwd, query),
    rewindPreview: (id, uuid) => invoke(IPC.controlRewindPreview, id, uuid),
    rewind: (id, uuid) => invoke(IPC.controlRewind, id, uuid),
    forkAt: (id, uuid) => invoke(IPC.controlForkAt, id, uuid),
    setEffort: (id, effort) => invoke(IPC.controlSetEffort, id, effort),
    setOutputStyle: (id, style) => invoke(IPC.controlSetOutputStyle, id, style),
    rename: (id, title) => invoke(IPC.controlRename, id, title),
    getPlan: (id) => invoke(IPC.controlGetPlan, id),
    onDetails: (cb) => on<ControlDetails>(IPC.controlDetailsChanged, cb)
  },
  session: {
    killExternal: (req) => invoke(IPC.sessionKillExternal, req)
  },
  git: {
    watch: (root) => invoke(IPC.gitWatch, root),
    compare: (root, path) => invoke(IPC.gitCompare, root, path),
    onChanged: (cb) => on<WorkspaceSnapshot>(IPC.gitChanged, cb)
  },
  hooks: {
    status: (root) => invoke(IPC.hooksStatus, root),
    preview: (root, action) => invoke(IPC.hooksPreview, root, action),
    apply: (previewId) => invoke(IPC.hooksApply, previewId),
    onChanged: (cb) => on<HooksStatus>(IPC.hooksChanged, cb)
  },
  attention: {
    get: () => invoke(IPC.attentionGet),
    getPrefs: () => invoke(IPC.attentionGetPrefs),
    setPrefs: (p) => invoke(IPC.attentionSetPrefs, p),
    onChanged: (cb) => on<AttentionSnapshot>(IPC.attentionChanged, cb),
    onFocus: (cb) => on<{ itemId: string }>(IPC.attentionFocus, cb)
  },
  catalog: {
    list: (root, accountId) => invoke(IPC.catalogList, root, accountId),
    open: (path) => invoke(IPC.catalogOpen, path)
  },
  mcp: {
    list: (root, accountId) => invoke(IPC.mcpList, root, accountId),
    previewAdd: (req) => invoke(IPC.mcpPreviewAdd, req),
    previewRemove: (root, accountId, name, scope) => invoke(IPC.mcpPreviewRemove, root, accountId, name, scope)
  },
  plugins: {
    list: (accountId) => invoke(IPC.pluginsList, accountId),
    preview: (accountId, action, id) => invoke(IPC.pluginsPreview, accountId, action, id)
  },
  cli: {
    apply: (previewId) => invoke(IPC.cliApply, previewId)
  },
  worktree: {
    openInEditor: (path) => invoke(IPC.worktreeOpenInEditor, path)
  },
  app: {
    getVersion: () => invoke(IPC.appGetVersion),
    pickFolder: () => invoke(IPC.appPickFolder),
    getDefaultCwd: () => invoke(IPC.appGetDefaultCwd),
    openExternal: (url) => invoke(IPC.appOpenExternal, url)
  }
}

contextBridge.exposeInMainWorld('api', api)
