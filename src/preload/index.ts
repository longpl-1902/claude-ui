import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { ConsoleApi, InvokeChannel, IpcInvokeMap } from '@shared/ipc'
import type {
  AccountsSnapshot,
  AgentEvent,
  AttentionSnapshot,
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
    onStream: (cb) => on<ControlStreamEvent[]>(IPC.controlStream, cb)
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
  worktree: {
    openInEditor: (path) => invoke(IPC.worktreeOpenInEditor, path)
  },
  app: {
    getVersion: () => invoke(IPC.appGetVersion),
    pickFolder: () => invoke(IPC.appPickFolder),
    getDefaultCwd: () => invoke(IPC.appGetDefaultCwd)
  }
}

contextBridge.exposeInMainWorld('api', api)
