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

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null

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
      return { configDir, step: 'waiting' }
    },
    'accounts:cancel-sign-in': (configDir) => (allStrings(configDir) ? { ok: true } : { ...INVALID_ARGS }),
    'agent:send-message': (agentId, text) => (allStrings(agentId, text) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'agent:pause': (agentId) => (allStrings(agentId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'agent:stop': (agentId) => (allStrings(agentId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'team:pause-all': () => ({ ...NOT_IMPLEMENTED }),
    'worktree:open-in-editor': (path) => (allStrings(path) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'app:get-version': () => deps.version ?? '0.0.0',
    // Phase 2 stubs; replaced by the real implementations in later tasks.
    'accounts:scan': () => structuredClone(mockAccountsSnapshot),
    'accounts:link-detected': (req) => (isObject(req) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:save-profile': (p) => (isObject(p) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:remove-profile': (accountId) => (allStrings(accountId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:set-rules': (rules) => (Array.isArray(rules) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:set-safety': (s) => (isObject(s) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:set-limit-policy': (p) => (allStrings(p) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:resolve-folder': () => ({ accountId: 'ask', ruleIndex: -1 }),
    'accounts:check-launch': () => ({
      allowed: false,
      warnings: [],
      blockedReason: 'pty-unavailable',
      matched: { accountId: 'ask', ruleIndex: -1 }
    }),
    'accounts:reopen-sign-in': (configDir) => (allStrings(configDir) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'pty:spawn': (req) => (isObject(req) ? { ok: false, reason: 'pty-unavailable' } : { ok: false, reason: 'invalid-args' }),
    'pty:write': (ptyId, data) => (allStrings(ptyId, data) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'pty:resize': (ptyId, cols, rows) =>
      allStrings(ptyId) && typeof cols === 'number' && typeof rows === 'number' ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS },
    'pty:kill': (ptyId) => (allStrings(ptyId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'pty:list': () => [],
    'pty:get-buffer': () => '',
    'app:pick-folder': () => null,
    'app:get-default-cwd': () => ''
  }
}

export function registerIpcHandlers(ipc: Pick<IpcMain, 'handle'>, handlers: Handlers = createHandlers()): void {
  for (const channel of INVOKE_CHANNELS) {
    const fn = handlers[channel] as (...args: unknown[]) => unknown
    ipc.handle(channel, (_event, ...args: unknown[]) => fn(...args))
  }
}
