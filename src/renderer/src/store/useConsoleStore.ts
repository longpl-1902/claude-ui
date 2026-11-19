import { useMemo } from 'react'
import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { EMPTY_ACCOUNTS_SNAPSHOT } from '@shared/accountsDefaults'
import type { ConsoleApi } from '@shared/ipc'
import { mockTeamSnapshot } from '@shared/mock'
import { deriveAllStatuses } from '@shared/status'
import type {
  AccountView,
  AccountsSnapshot,
  Agent,
  AgentStatus,
  FolderRule,
  LimitPolicy,
  OkResult,
  OkWithId,
  ProfileInput,
  SafetySettings,
  SignInStatus,
  SignInStep,
  TeamSnapshot
} from '@shared/types'

type AccountsApi = ConsoleApi['accounts']

export type Screen = 'team' | 'accounts'
export type InspectorTab = 'activity' | 'files' | 'messages'
export interface SignInState {
  step: SignInStep
  configDir?: string
  panelOpen: boolean
  email?: string
  org?: string
  ptyId?: string
  reason?: string
}
export interface LeadPtyState {
  ptyId?: string
  folder?: string
  accountId?: string
}

export interface ConsoleState {
  screen: Screen
  team: TeamSnapshot
  accounts: AccountsSnapshot
  accountsLoaded: boolean
  accountsError?: string
  selectedAgentId: string
  inspectorTab: InspectorTab
  rawTerminalOpen: boolean
  consoleDraft: string
  signIn: SignInState
  leadPty: LeadPtyState
  navigate(screen: Screen): void
  selectAgent(id: string): void
  setInspectorTab(tab: InspectorTab): void
  toggleRawTerminal(): void
  setConsoleDraft(text: string): void
  submitConsole(): void
  hydrateTeam(s: TeamSnapshot): void
  hydrateAccounts(s: AccountsSnapshot): void
  refreshAccounts(): Promise<void>
  scanAccounts(): Promise<void>
  setDefaultAccount(id: string): void
  linkDetected(configDir: string): Promise<OkWithId>
  saveProfile(p: ProfileInput): Promise<OkWithId>
  removeProfile(id: string): Promise<OkResult>
  setRules(rules: FolderRule[]): void
  setLimitPolicy(p: LimitPolicy): void
  toggleSafety(key: keyof SafetySettings): void
  startSignIn(configDir: string): Promise<void>
  checkSignIn(): Promise<void>
  reopenSignIn(): Promise<void>
  cancelSignIn(): Promise<void>
  closeSignInPanel(): void
  applySignInStatus(s: SignInStatus): void
  setLeadPty(p: LeadPtyState): void
  clearAccountsError(): void
}

const pad = (n: number) => String(n).padStart(2, '0')
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function initialData() {
  return {
    screen: 'team' as Screen,
    team: structuredClone(mockTeamSnapshot),
    accounts: structuredClone(EMPTY_ACCOUNTS_SNAPSHOT),
    accountsLoaded: false,
    accountsError: undefined as string | undefined,
    selectedAgentId: 'be',
    inspectorTab: 'activity' as InspectorTab,
    rawTerminalOpen: false,
    consoleDraft: '',
    signIn: { step: 'none', panelOpen: false } as SignInState,
    leadPty: {} as LeadPtyState
  }
}

const NO_API: OkResult = { ok: false, reason: 'api-unavailable' }

/** Guarded api call: a missing api is a no-op, a rejection lands in accountsError and never throws. */
async function callApi<T>(fn: (a: AccountsApi) => Promise<T>, fallback: T): Promise<T> {
  const a = window.api?.accounts
  if (!a) return fallback
  try {
    return await fn(a)
  } catch (e) {
    useConsoleStore.setState({ accountsError: errMsg(e) })
    return fallback
  }
}

/** Optimistic write: on !ok or rejection, resync from main and surface the reason. */
async function writeOptimistic(fn: (a: AccountsApi) => Promise<OkResult>): Promise<void> {
  let error: string | undefined
  const r = await callApi<OkResult | undefined>(fn, undefined)
  if (r && !r.ok) error = r.reason
  else if (!r && useConsoleStore.getState().accountsError) error = useConsoleStore.getState().accountsError
  if (error === undefined) return
  await useConsoleStore.getState().refreshAccounts() // hydrate clears accountsError
  useConsoleStore.setState({ accountsError: error })
}

export const useConsoleStore: UseBoundStore<StoreApi<ConsoleState>> = create<ConsoleState>()(
  (set, get) => ({
    ...initialData(),
    navigate: (screen) => set({ screen }),
    selectAgent: (id) => {
      if (get().team.agents.some((a) => a.id === id)) set({ selectedAgentId: id })
    },
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
    toggleRawTerminal: () => set((s) => ({ rawTerminalOpen: !s.rawTerminalOpen })),
    setConsoleDraft: (consoleDraft) => set({ consoleDraft }),
    submitConsole: () => {
      const { consoleDraft, team } = get()
      const text = consoleDraft.trim()
      if (!text) return
      let target = 'lead'
      const m = /^@(\S+)\s/.exec(text)
      if (m) {
        const found = team.agents.find((a) => a.name === m[1])
        if (found) target = found.id
      }
      set({
        team: { ...team, console: [...team.console, { time: localTime(new Date()), who: 'you', text }] },
        consoleDraft: ''
      })
      try {
        // fire-and-forget
        window.api?.agent.sendMessage(target, text)?.catch?.(() => {})
      } catch {
        // ignore send failures
      }
    },
    hydrateTeam: (team) => set({ team }),
    hydrateAccounts: (accounts) => set({ accounts, accountsLoaded: true, accountsError: undefined }),
    refreshAccounts: async () => {
      const snap = await callApi((a) => a.getSnapshot(), undefined)
      if (snap) get().hydrateAccounts(snap)
    },
    scanAccounts: async () => {
      const snap = await callApi((a) => a.scan(), undefined)
      if (snap) get().hydrateAccounts(snap)
    },
    setDefaultAccount: (id) => {
      set((s) => ({ accounts: { ...s.accounts, defaultAccountId: id } }))
      void writeOptimistic((a) => a.setDefault(id))
    },
    linkDetected: (configDir) => callApi((a) => a.linkDetected({ configDir }), NO_API as OkWithId),
    saveProfile: (p) => callApi((a) => a.saveProfile(p), NO_API as OkWithId),
    removeProfile: (id) => callApi((a) => a.removeProfile(id), NO_API),
    setRules: (rules) => {
      set((s) => ({ accounts: { ...s.accounts, rules } }))
      void writeOptimistic((a) => a.setRules(rules))
    },
    setLimitPolicy: (limitPolicy) => {
      set((s) => ({ accounts: { ...s.accounts, limitPolicy } }))
      void writeOptimistic((a) => a.setLimitPolicy(limitPolicy))
    },
    toggleSafety: (key) => {
      const safety = { ...get().accounts.safety, [key]: !get().accounts.safety[key] }
      set((s) => ({ accounts: { ...s.accounts, safety } }))
      void writeOptimistic((a) => a.setSafety(safety))
    },
    startSignIn: async (configDir) => {
      set({ signIn: { step: 'waiting', configDir, panelOpen: true } })
      const r = await callApi((a) => a.startSignIn(configDir), { ok: true } as OkResult)
      if (!r.ok) set((s) => ({ signIn: { ...s.signIn, step: 'error', reason: r.reason } }))
    },
    checkSignIn: async () => {
      const dir = get().signIn.configDir
      if (!dir) return
      const st = await callApi((a) => a.checkSignIn(dir), undefined)
      if (st) get().applySignInStatus(st)
    },
    reopenSignIn: async () => {
      const dir = get().signIn.configDir
      if (!dir) return
      await callApi((a) => a.reopenSignIn(dir), NO_API)
    },
    cancelSignIn: async () => {
      const dir = get().signIn.configDir
      if (dir) await callApi((a) => a.cancelSignIn(dir), NO_API)
      set({ signIn: { step: 'none', panelOpen: false } })
    },
    closeSignInPanel: () => set((s) => ({ signIn: { ...s.signIn, panelOpen: false } })),
    applySignInStatus: (st) => {
      if (st.configDir !== get().signIn.configDir) return
      set((s) => ({
        signIn: {
          ...s.signIn,
          step: st.step,
          email: st.email,
          org: st.org,
          ptyId: st.ptyId,
          reason: st.reason
        }
      }))
    },
    setLeadPty: (leadPty) => set({ leadPty }),
    clearAccountsError: () => set({ accountsError: undefined })
  })
)

export function resetConsoleStore(): void {
  useConsoleStore.setState(initialData())
}

export const selectSelectedAgent = (s: ConsoleState): Agent =>
  s.team.agents.find((a) => a.id === s.selectedAgentId) ?? s.team.agents[0]!

export const selectActiveAccount = (s: ConsoleState): AccountView | undefined =>
  s.accounts.accounts.find((a) => a.id === s.accounts.activeAccountId) ??
  s.accounts.accounts.find((a) => a.id === s.accounts.defaultAccountId)

export function useAgentStatuses(): Record<string, AgentStatus> {
  const team = useConsoleStore((s) => s.team)
  return useMemo(() => deriveAllStatuses(team), [team])
}

export function useTeamCounters(): { agents: number; running: number; needsYou: number; tokens: number } {
  const team = useConsoleStore((s) => s.team)
  const statuses = useAgentStatuses()
  return useMemo(() => {
    const vals = Object.values(statuses)
    return {
      agents: team.agents.length,
      running: vals.filter((v) => v === 'running').length,
      needsYou: vals.filter((v) => v === 'needs-you').length,
      tokens: team.agents.reduce((n, a) => n + a.tokens, 0)
    }
  }, [team, statuses])
}
