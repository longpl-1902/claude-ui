import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { ConsoleApi, InvokeChannel, IpcInvokeMap } from '@shared/ipc'
import type { AgentEvent } from '@shared/types'

function invoke<C extends InvokeChannel>(
  c: C,
  ...args: IpcInvokeMap[C]['args']
): Promise<IpcInvokeMap[C]['result']> {
  return ipcRenderer.invoke(c, ...args) as Promise<IpcInvokeMap[C]['result']>
}

const api: ConsoleApi = {
  team: {
    getSnapshot: () => invoke(IPC.teamGetSnapshot),
    pauseAll: () => invoke(IPC.teamPauseAll),
    onEvent: (cb) => {
      const listener = (_e: unknown, event: AgentEvent): void => cb(event)
      ipcRenderer.on(IPC.teamEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.teamEvent, listener)
      }
    }
  },
  accounts: {
    getSnapshot: () => invoke(IPC.accountsGetSnapshot),
    setDefault: (id) => invoke(IPC.accountsSetDefault, id),
    startSignIn: (dir) => invoke(IPC.accountsStartSignIn, dir),
    checkSignIn: (dir) => invoke(IPC.accountsCheckSignIn, dir),
    cancelSignIn: (dir) => invoke(IPC.accountsCancelSignIn, dir)
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
    getVersion: () => invoke(IPC.appGetVersion)
  }
}

contextBridge.exposeInMainWorld('api', api)
