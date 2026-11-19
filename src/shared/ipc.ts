import type { AccountsSnapshot, AgentEvent, OkResult, SignInStep, TeamSnapshot } from './types'

export const IPC = {
  teamGetSnapshot: 'team:get-snapshot',
  teamEvent: 'team:event', // main -> renderer push (unused in Phase 1)
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
  appGetVersion: 'app:get-version'
} as const
export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface IpcInvokeMap {
  'team:get-snapshot': { args: []; result: TeamSnapshot }
  'accounts:get-snapshot': { args: []; result: AccountsSnapshot }
  'accounts:set-default': { args: [accountId: string]; result: OkResult }
  'accounts:start-sign-in': { args: [configDir: string]; result: OkResult }
  'accounts:check-sign-in': { args: [configDir: string]; result: { step: SignInStep; email?: string } }
  'accounts:cancel-sign-in': { args: [configDir: string]; result: OkResult }
  'agent:send-message': { args: [agentId: string, text: string]; result: OkResult }
  'agent:pause': { args: [agentId: string]; result: OkResult }
  'agent:stop': { args: [agentId: string]; result: OkResult }
  'team:pause-all': { args: []; result: OkResult }
  'worktree:open-in-editor': { args: [path: string]; result: OkResult }
  'app:get-version': { args: []; result: string }
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
  'app:get-version'
] as const satisfies readonly InvokeChannel[]
type MissingChannels = Exclude<InvokeChannel, (typeof invokeChannelList)[number]>
const _exhaustive: [MissingChannels] extends [never] ? true : never = true
void _exhaustive

export const INVOKE_CHANNELS: InvokeChannel[] = [...invokeChannelList]

export interface ConsoleApi {
  team: {
    getSnapshot(): Promise<TeamSnapshot>
    pauseAll(): Promise<OkResult>
    onEvent(cb: (e: AgentEvent) => void): () => void
  }
  accounts: {
    getSnapshot(): Promise<AccountsSnapshot>
    setDefault(id: string): Promise<OkResult>
    startSignIn(dir: string): Promise<OkResult>
    checkSignIn(dir: string): Promise<{ step: SignInStep; email?: string }>
    cancelSignIn(dir: string): Promise<OkResult>
  }
  agent: {
    sendMessage(id: string, text: string): Promise<OkResult>
    pause(id: string): Promise<OkResult>
    stop(id: string): Promise<OkResult>
  }
  worktree: { openInEditor(path: string): Promise<OkResult> }
  app: { getVersion(): Promise<string> }
}
