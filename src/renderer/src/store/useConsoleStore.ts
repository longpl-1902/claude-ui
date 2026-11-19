import { useMemo } from 'react'
import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { EMPTY_ACCOUNTS_SNAPSHOT } from '@shared/accountsDefaults'
import type { ConsoleApi } from '@shared/ipc'
import { deriveLiveStatus, reasonLabel } from '@shared/liveStatus'
import { mockTeamSnapshot } from '@shared/mock'
import { deriveAgentStatus } from '@shared/status'
import { EMPTY_TEAM_SNAPSHOT, LEAD_ID, PLACEHOLDER_AGENT, tokenHeadline } from '@shared/teamDefaults'
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
  SessionSummary,
  SignInStep,
  TeamSelection,
  TeamSnapshot,
  UsageToday
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

export type TeamMode = 'live' | 'demo'

export interface ConsoleState {
  screen: Screen
  team: TeamSnapshot
  teamMode: TeamMode
  liveTeam: TeamSnapshot
  sessions: SessionSummary[]
  selection: TeamSelection
  /** Git project the Team view is scoped to (SessionProject.key); null until chosen. */
  projectKey: string | null
  usageToday: UsageToday | null
  nowMs: number
  teamError?: string
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
  showDemo(): void
  exitDemo(): void
  refreshSessions(): Promise<void>
  selectSession(sel: TeamSelection): Promise<void>
  setSessions(list: SessionSummary[]): void
  applyUsage(u: UsageToday): void
  tick(nowMs?: number): void
  setSelection(sel: TeamSelection): void
  setProject(key: string): void
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
    team: structuredClone(EMPTY_TEAM_SNAPSHOT),
    teamMode: 'live' as TeamMode,
    liveTeam: structuredClone(EMPTY_TEAM_SNAPSHOT),
    sessions: [] as SessionSummary[],
    selection: { mode: 'auto' } as TeamSelection,
    projectKey: null as string | null,
    usageToday: null as UsageToday | null,
    nowMs: Date.now(),
    teamError: undefined as string | undefined,
    accounts: structuredClone(EMPTY_ACCOUNTS_SNAPSHOT),
    accountsLoaded: false,
    accountsError: undefined as string | undefined,
    selectedAgentId: LEAD_ID,
    inspectorTab: 'activity' as InspectorTab,
    rawTerminalOpen: false,
    consoleDraft: '',
    signIn: { step: 'none', panelOpen: false } as SignInState,
    leadPty: {} as LeadPtyState
  }
}

export interface ProjectGroup {
  key: string
  name: string
  root: string
  liveCount: number
  lastActivityMs: number
}

/** Project key of a session: the resolved one, else a cwd/projectDir fallback. */
export function sessionProjectKey(s: SessionSummary): string {
  return s.project?.key ?? (s.cwd ?? s.projectDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Sessions grouped by git project, most recently active first. */
export function deriveProjects(sessions: SessionSummary[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  for (const s of sessions) {
    const key = sessionProjectKey(s)
    let g = map.get(key)
    if (!g) {
      const root = s.project?.root ?? s.cwd ?? s.projectDir ?? ''
      g = { key, name: s.project?.name ?? (root.split(/[/\\]/).filter(Boolean).pop() ?? root), root, liveCount: 0, lastActivityMs: 0 }
      map.set(key, g)
    }
    if (s.live) g.liveCount++
    if (s.mtimeMs > g.lastActivityMs) g.lastActivityMs = s.mtimeMs
  }
  return [...map.values()].sort((a, b) => b.lastActivityMs - a.lastActivityMs)
}

const PROJECT_STORAGE_KEY = 'ac.projectKey'
function rememberedProject(): string | null {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY)
  } catch {
    return null
  }
}
function rememberProject(key: string): void {
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, key)
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
}

function pickSelected(current: string, team: TeamSnapshot): string {
  if (team.agents.some((a) => a.id === current)) return current
  if (team.agents.some((a) => a.id === LEAD_ID)) return LEAD_ID
  return team.agents[0]?.id ?? LEAD_ID
}

/** Guarded transcripts/usage/team call: a missing api is a no-op, a rejection lands in teamError. */
async function callTeamApi<T>(fn: () => Promise<T> | undefined, fallback: T): Promise<T> {
  try {
    const r = await fn()
    return r === undefined ? fallback : r
  } catch (e) {
    useConsoleStore.setState({ teamError: errMsg(e) })
    return fallback
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

/** First project once sessions are known: remembered one if it still exists, else the current pick's, else the newest. */
function adoptProject(list: SessionSummary[]): void {
  const st = useConsoleStore.getState()
  if (st.projectKey !== null || list.length === 0) return
  const projects = deriveProjects(list)
  const remembered = rememberedProject()
  const pick = list.find((s) => s.sessionId === st.team.sessionId)
  const key =
    (remembered !== null && projects.some((p) => p.key === remembered) ? remembered : null) ??
    (pick ? sessionProjectKey(pick) : null) ??
    projects[0]!.key
  useConsoleStore.setState({ projectKey: key })
  if (st.selection.mode === 'auto') void st.selectSession({ mode: 'auto', projectKey: key })
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
    hydrateTeam: (snap) =>
      set((s) =>
        s.teamMode === 'live'
          ? { liveTeam: snap, team: snap, selectedAgentId: pickSelected(s.selectedAgentId, snap) }
          : { liveTeam: snap }
      ),
    showDemo: () => {
      const team = structuredClone(mockTeamSnapshot)
      team.source = 'demo'
      set({ team, teamMode: 'demo', selectedAgentId: team.agents[0]?.id ?? LEAD_ID })
    },
    exitDemo: () =>
      set((s) => ({
        teamMode: 'live',
        team: s.liveTeam,
        selectedAgentId: pickSelected(s.selectedAgentId, s.liveTeam)
      })),
    refreshSessions: async () => {
      const api = window.api?.transcripts
      if (!api) return
      const list = await callTeamApi(() => api.listSessions(), undefined)
      if (list) {
        set({ sessions: list })
        adoptProject(list)
      }
    },
    selectSession: async (sel) => {
      set({ selection: sel })
      const api = window.api?.transcripts
      if (!api) return
      const snap = await callTeamApi(() => api.select(sel), undefined)
      if (!snap) return
      get().exitDemo()
      get().hydrateTeam(snap)
    },
    setSessions: (sessions) => {
      set({ sessions })
      adoptProject(sessions)
    },
    setProject: (key) => {
      rememberProject(key)
      set({ projectKey: key })
      void get().selectSession({ mode: 'auto', projectKey: key })
    },
    setSelection: (selection) => set({ selection }),
    applyUsage: (usageToday) => set({ usageToday }),
    tick: (nowMs) => set({ nowMs: nowMs ?? Date.now() }),
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
  s.team.agents.find((a) => a.id === s.selectedAgentId) ?? s.team.agents[0] ?? PLACEHOLDER_AGENT

export const selectSelectedAgentOrNull = (s: ConsoleState): Agent | null =>
  s.team.agents.find((a) => a.id === s.selectedAgentId) ?? s.team.agents[0] ?? null

export const selectTokensToday =
  (accountId: string) =>
  (s: ConsoleState): { headline: number; cacheRead: number } | undefined => {
    const t = s.usageToday?.byAccount[accountId]
    return t ? { headline: tokenHeadline(t), cacheRead: t.cacheRead } : undefined
  }

export const selectActiveAccount = (s: ConsoleState): AccountView | undefined =>
  s.accounts.accounts.find((a) => a.id === s.accounts.activeAccountId) ??
  s.accounts.accounts.find((a) => a.id === s.accounts.defaultAccountId)

function statusInfoFor(team: TeamSnapshot, agent: Agent, nowMs: number): { status: AgentStatus; reason?: string } {
  if (agent.runtime) {
    const r = deriveLiveStatus(agent.runtime, nowMs)
    return { status: r.status, reason: reasonLabel(r.reason, r.detail) }
  }
  return { status: deriveAgentStatus(team.events, agent.id, team.now) }
}

export function useAgentStatuses(): Record<string, AgentStatus> {
  const team = useConsoleStore((s) => s.team)
  const nowMs = useConsoleStore((s) => s.nowMs)
  return useMemo(() => {
    const out: Record<string, AgentStatus> = {}
    for (const a of team.agents) out[a.id] = statusInfoFor(team, a, nowMs).status
    return out
  }, [team, nowMs])
}

export function useAgentStatusInfo(id: string): { status: AgentStatus; reason?: string } {
  const team = useConsoleStore((s) => s.team)
  const nowMs = useConsoleStore((s) => s.nowMs)
  return useMemo(() => {
    const a = team.agents.find((x) => x.id === id)
    return a ? statusInfoFor(team, a, nowMs) : { status: 'waiting' as AgentStatus }
  }, [team, nowMs, id])
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
