import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { ConsoleApi, InvokeChannel, IpcInvokeMap } from '@shared/ipc'
import type { AccountsSnapshot, AgentEvent, PtyDataEvent, PtyExitEvent, SignInStatus } from '@shared/types'

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
    onEvent: (cb) => on<AgentEvent>(IPC.teamEvent, cb)
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
  agent: {
    sendMessage: (id, text) => invoke(IPC.agentSendMessage, id, text),
    pause: (id) => invoke(IPC.agentPause, id),
    stop: (id) => invoke(IPC.agentStop, id)
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
