import { useMemo } from 'react'
import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { MOCK_SIGNED_IN_EMAIL, mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import { deriveAllStatuses } from '@shared/status'
import type {
  AccountView,
  AccountsSnapshot,
  Agent,
  AgentStatus,
  LimitPolicy,
  SafetySettings,
  SignInStep,
  TeamSnapshot
} from '@shared/types'

export type Screen = 'team' | 'accounts'
export type InspectorTab = 'activity' | 'files' | 'messages'
export interface SignInState {
  step: SignInStep
  configDir?: string
  panelOpen: boolean
}

export interface ConsoleState {
  screen: Screen
  team: TeamSnapshot
  accounts: AccountsSnapshot
  selectedAgentId: string
  inspectorTab: InspectorTab
  rawTerminalOpen: boolean
  consoleDraft: string
  signIn: SignInState
  navigate(screen: Screen): void
  selectAgent(id: string): void
  setInspectorTab(tab: InspectorTab): void
  toggleRawTerminal(): void
  setConsoleDraft(text: string): void
  submitConsole(): void
  hydrateTeam(s: TeamSnapshot): void
  hydrateAccounts(s: AccountsSnapshot): void
  setDefaultAccount(id: string): void
  linkDetected(configDir: string): void
  startSignIn(configDir: string): void
  finishSignIn(): void
  cancelSignIn(): void
  closeSignInPanel(): void
  setLimitPolicy(p: LimitPolicy): void
  toggleSafety(key: keyof SafetySettings): void
}

const pad = (n: number) => String(n).padStart(2, '0')
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

function initialData() {
  return {
    screen: 'team' as Screen,
    team: structuredClone(mockTeamSnapshot),
    accounts: structuredClone(mockAccountsSnapshot),
    selectedAgentId: 'be',
    inspectorTab: 'activity' as InspectorTab,
    rawTerminalOpen: false,
    consoleDraft: '',
    signIn: { step: 'none', panelOpen: false } as SignInState
  }
}

/** Marks the suggested account signed in and links the detected entry (used by linkDetected and finishSignIn). */
function linkDetectedIn(
  accounts: AccountsSnapshot,
  configDir: string,
  extra: { email?: string }
): AccountsSnapshot {
  const det = accounts.detected.find((d) => d.configDir === configDir)
  if (!det) return accounts
  const linkId = det.suggestedAccountId
  return {
    ...accounts,
    detected: accounts.detected.map((d) =>
      d.configDir === configDir ? { ...d, ...extra, signedIn: true, linkedAccountId: linkId } : d
    ),
    accounts: linkId
      ? accounts.accounts.map((a) => (a.id === linkId ? { ...a, signedIn: true } : a))
      : accounts.accounts
  }
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
    hydrateAccounts: (accounts) => set({ accounts }),
    setDefaultAccount: (id) => set((s) => ({ accounts: { ...s.accounts, defaultAccountId: id } })),
    linkDetected: (configDir) => set((s) => ({ accounts: linkDetectedIn(s.accounts, configDir, {}) })),
    startSignIn: (configDir) => set({ signIn: { step: 'waiting', configDir, panelOpen: true } }),
    finishSignIn: () =>
      set((s) => {
        const dir = s.signIn.configDir
        return {
          signIn: { ...s.signIn, step: 'done' },
          accounts: dir ? linkDetectedIn(s.accounts, dir, { email: MOCK_SIGNED_IN_EMAIL }) : s.accounts
        }
      }),
    cancelSignIn: () => set({ signIn: { step: 'none', panelOpen: false } }),
    closeSignInPanel: () => set((s) => ({ signIn: { ...s.signIn, panelOpen: false } })),
    setLimitPolicy: (limitPolicy) => set((s) => ({ accounts: { ...s.accounts, limitPolicy } })),
    toggleSafety: (key) =>
      set((s) => ({
        accounts: { ...s.accounts, safety: { ...s.accounts.safety, [key]: !s.accounts.safety[key] } }
      }))
  })
)

export function resetConsoleStore(): void {
  useConsoleStore.setState(initialData())
}

export const selectSelectedAgent = (s: ConsoleState): Agent =>
  s.team.agents.find((a) => a.id === s.selectedAgentId) ?? s.team.agents[0]!

export const selectActiveAccount = (s: ConsoleState): AccountView =>
  s.accounts.accounts.find((a) => a.id === s.accounts.activeAccountId) ?? s.accounts.accounts[0]!

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
