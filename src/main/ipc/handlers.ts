import type { IpcMain } from 'electron'
import { INVOKE_CHANNELS, type InvokeChannel, type IpcInvokeMap } from '@shared/ipc'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import type { OkResult } from '@shared/types'

export type Handlers = {
  [C in InvokeChannel]: (...args: IpcInvokeMap[C]['args']) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result']
}

const NOT_IMPLEMENTED: OkResult = { ok: false, reason: 'not-implemented' }
const INVALID_ARGS: OkResult = { ok: false, reason: 'invalid-args' }

const allStrings = (...args: unknown[]): boolean => args.every((a) => typeof a === 'string')

/** Phase 1: mock-backed handlers. Never touches credentials, fs, network or processes. */
export function createHandlers(deps: { version?: string } = {}): Handlers {
  let defaultAccountId = mockAccountsSnapshot.defaultAccountId

  return {
    'team:get-snapshot': () => structuredClone(mockTeamSnapshot),
    'accounts:get-snapshot': () => ({ ...structuredClone(mockAccountsSnapshot), defaultAccountId }),
    'accounts:set-default': (accountId) => {
      if (!allStrings(accountId)) return { ...INVALID_ARGS }
      defaultAccountId = accountId
      return { ok: true }
    },
    'accounts:start-sign-in': (configDir) => (allStrings(configDir) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:check-sign-in': (configDir) => {
      void configDir
      return { step: 'waiting' }
    },
    'accounts:cancel-sign-in': (configDir) => (allStrings(configDir) ? { ok: true } : { ...INVALID_ARGS }),
    'agent:send-message': (agentId, text) => (allStrings(agentId, text) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'agent:pause': (agentId) => (allStrings(agentId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'agent:stop': (agentId) => (allStrings(agentId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'team:pause-all': () => ({ ...NOT_IMPLEMENTED }),
    'worktree:open-in-editor': (path) => (allStrings(path) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'app:get-version': () => deps.version ?? '0.0.0'
  }
}

export function registerIpcHandlers(ipc: Pick<IpcMain, 'handle'>, handlers: Handlers = createHandlers()): void {
  for (const channel of INVOKE_CHANNELS) {
    const fn = handlers[channel] as (...args: unknown[]) => unknown
    ipc.handle(channel, (_event, ...args: unknown[]) => fn(...args))
  }
}
