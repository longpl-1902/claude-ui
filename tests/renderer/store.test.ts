// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_ACCOUNTS_SNAPSHOT } from '@shared/accountsDefaults'
import type { Agent, AgentRuntime, ControlSessionInfo, SessionSummary, TeamSnapshot } from '@shared/types'
import { EMPTY_TEAM_SNAPSHOT, PLACEHOLDER_AGENT } from '@shared/teamDefaults'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import {
  deriveProjects,
  resetConsoleStore,
  selectActiveAccount,
  selectSelectedAgent,
  selectSelectedAgentOrNull,
  selectTokensToday,
  useAgentStatusInfo,
  useAgentStatuses,
  useConsoleStore,
  useScrollMemory,
  useTeamCounters
} from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { seedMockAccounts } from './seedAccounts'
import { seedDemoTeam } from './seedTeam'

const s = () => useConsoleStore.getState()

beforeEach(() => {
  resetConsoleStore()
  seedDemoTeam()
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('R-07 initial state', () => {
  beforeEach(() => resetConsoleStore())
  it('starts on the team screen with lead selected and the activity tab', () => {
    expect(s().screen).toBe('team')
    expect(s().selectedAgentId).toBe('lead')
    expect(s().inspectorTab).toBe('activity')
    expect(s().rawTerminalOpen).toBe(false)
    expect(s().consoleDraft).toBe('')
    expect(s().signIn).toMatchObject({ step: 'none', panelOpen: false })
  })

  it('starts with empty accounts (no fake data) and accountsLoaded false', () => {
    expect(s().accounts).toEqual(EMPTY_ACCOUNTS_SNAPSHOT)
    expect(s().accounts).not.toBe(EMPTY_ACCOUNTS_SNAPSHOT)
    expect(s().accountsLoaded).toBe(false)
    expect(s().leadPty).toEqual({})
  })

  it('team starts empty (never the mock), live, auto-selection, no usage', () => {
    expect(s().team).toEqual(EMPTY_TEAM_SNAPSHOT)
    expect(s().team).not.toBe(EMPTY_TEAM_SNAPSHOT)
    expect(s().liveTeam).toEqual(EMPTY_TEAM_SNAPSHOT)
    expect(s().teamMode).toBe('live')
    expect(s().selection).toEqual({ mode: 'auto' })
    expect(s().sessions).toEqual([])
    expect(s().usageToday).toBeNull()
  })

  it('seedDemoTeam loads a deep clone of the mock as demo data', () => {
    seedDemoTeam()
    expect(s().team).toEqual({ ...mockTeamSnapshot, source: 'demo' })
    expect(s().team.agents).not.toBe(mockTeamSnapshot.agents)
    expect(s().teamMode).toBe('demo')
    expect(s().selectedAgentId).toBe('be')
  })
})

describe('R-13 navigation', () => {
  it('navigate switches screens', () => {
    s().navigate('accounts')
    expect(s().screen).toBe('accounts')
    s().navigate('team')
    expect(s().screen).toBe('team')
  })
})

describe('R-07 selection, tabs, terminal', () => {
  it('selectAgent changes the selected agent; unknown ids are ignored', () => {
    s().selectAgent('test')
    expect(s().selectedAgentId).toBe('test')
    expect(selectSelectedAgent(s()).name).toBe('test-writer')
    s().selectAgent('nope')
    expect(s().selectedAgentId).toBe('test')
  })

  it('selectSelectedAgent returns a stable reference', () => {
    expect(selectSelectedAgent(s())).toBe(selectSelectedAgent(s()))
    expect(selectSelectedAgent(s())).toBe(s().team.agents.find((a) => a.id === 'be'))
  })

  it('selectActiveAccount: active, then default, then undefined', () => {
    expect(selectActiveAccount(s())).toBeUndefined()
    seedMockAccounts()
    expect(selectActiveAccount(s())?.id).toBe('company')
    expect(selectActiveAccount(s())).toBe(selectActiveAccount(s()))
    s().hydrateAccounts({ ...structuredClone(mockAccountsSnapshot), activeAccountId: '', defaultAccountId: 'personal' })
    expect(selectActiveAccount(s())?.id).toBe('personal')
    s().hydrateAccounts({ ...structuredClone(mockAccountsSnapshot), activeAccountId: '', defaultAccountId: '' })
    expect(selectActiveAccount(s())).toBeUndefined()
  })

  it('setInspectorTab and toggleRawTerminal', () => {
    s().setInspectorTab('files')
    expect(s().inspectorTab).toBe('files')
    s().setInspectorTab('messages')
    expect(s().inspectorTab).toBe('messages')
    s().toggleRawTerminal()
    expect(s().rawTerminalOpen).toBe(true)
    s().toggleRawTerminal()
    expect(s().rawTerminalOpen).toBe(false)
  })
})

describe('R-07 console submit', () => {
  it('does nothing for an empty or blank draft', () => {
    const before = s().team.console.length
    s().submitConsole()
    s().setConsoleDraft('   ')
    s().submitConsole()
    expect(s().team.console).toHaveLength(before)
  })

  it('appends a line from "you" and clears the draft', () => {
    const before = s().team.console
    s().setConsoleDraft('  hello  ')
    expect(s().consoleDraft).toBe('  hello  ')
    s().submitConsole()
    const after = s().team.console
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)).toMatchObject({ who: 'you', text: 'hello' })
    expect(after.at(-1)!.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(s().consoleDraft).toBe('')
    expect(before).toHaveLength(7) // immutable update
    expect(mockTeamSnapshot.console).toHaveLength(7)
  })

  it('no longer sends through window.api (live sending moved to LeadConsole / useControlStore)', () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { agent: { sendMessage } }
    s().setConsoleDraft('hello')
    s().submitConsole()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not send an @mention through window.api either', () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { agent: { sendMessage } }
    s().setConsoleDraft('@ui-builder please start')
    s().submitConsole()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(s().team.console.at(-1)).toMatchObject({ who: 'you', text: '@ui-builder please start' })
  })
})

type Fn = ReturnType<typeof vi.fn>
function installApi(over: Record<string, Fn> = {}) {
  const ok = () => vi.fn().mockResolvedValue({ ok: true })
  const accounts = {
    getSnapshot: vi.fn().mockResolvedValue({ ...structuredClone(mockAccountsSnapshot), defaultAccountId: 'personal' }),
    scan: vi.fn().mockResolvedValue(structuredClone(mockAccountsSnapshot)),
    setDefault: ok(),
    linkDetected: vi.fn().mockResolvedValue({ ok: true, accountId: 'x' }),
    saveProfile: vi.fn().mockResolvedValue({ ok: true, accountId: 'y' }),
    removeProfile: ok(),
    setRules: ok(),
    setLimitPolicy: ok(),
    setSafety: ok(),
    startSignIn: ok(),
    checkSignIn: vi.fn().mockResolvedValue({ configDir: '/d', step: 'done', email: 'a@b.c' }),
    reopenSignIn: ok(),
    cancelSignIn: ok(),
    ...over
  }
  ;(window as unknown as { api: unknown }).api = { accounts }
  return accounts
}

describe('R-11 hydrate', () => {
  it('hydrateTeam replaces the team (live mode); hydrateAccounts sets loaded', () => {
    s().exitDemo()
    s().hydrateTeam({ ...mockTeamSnapshot, teamName: 'from-ipc' })
    expect(s().team.teamName).toBe('from-ipc')
    s().hydrateAccounts({ ...mockAccountsSnapshot, defaultAccountId: 'personal' })
    expect(s().accounts.defaultAccountId).toBe('personal')
    expect(s().accountsLoaded).toBe(true)
  })

  it('refreshAccounts and scanAccounts hydrate from the api', async () => {
    const api = installApi()
    await s().refreshAccounts()
    expect(api.getSnapshot).toHaveBeenCalled()
    expect(s().accounts.defaultAccountId).toBe('personal')
    expect(s().accountsLoaded).toBe(true)
    await s().scanAccounts()
    expect(api.scan).toHaveBeenCalled()
    expect(s().accounts.defaultAccountId).toBe('company')
  })

  it('a rejected api sets accountsError and never throws', async () => {
    installApi({ getSnapshot: vi.fn().mockRejectedValue(new Error('boom')) })
    await expect(s().refreshAccounts()).resolves.toBeUndefined()
    expect(s().accountsError).toBe('boom')
    expect(s().accountsLoaded).toBe(false)
  })

  it('without window.api the actions are harmless no-ops', async () => {
    await s().refreshAccounts()
    await s().scanAccounts()
    expect((await s().linkDetected('/d')).ok).toBe(false)
    expect((await s().removeProfile('x')).ok).toBe(false)
    expect(s().accountsError).toBeUndefined()
  })
})

describe('R-11 accounts actions', () => {
  beforeEach(() => seedMockAccounts())

  it('setDefaultAccount is optimistic and calls the api', () => {
    const api = installApi()
    s().setDefaultAccount('personal')
    expect(s().accounts.defaultAccountId).toBe('personal')
    expect(api.setDefault).toHaveBeenCalledWith('personal')
    expect(mockAccountsSnapshot.defaultAccountId).toBe('company')
  })

  it('linkDetected, saveProfile, removeProfile forward to the api without local mutation', async () => {
    const api = installApi()
    const before = s().accounts
    expect(await s().linkDetected('~/.claude')).toEqual({ ok: true, accountId: 'x' })
    expect(api.linkDetected).toHaveBeenCalledWith({ configDir: '~/.claude' })
    const profile = { name: 'N' } as never
    expect(await s().saveProfile(profile)).toEqual({ ok: true, accountId: 'y' })
    expect(api.saveProfile).toHaveBeenCalledWith(profile)
    expect(await s().removeProfile('personal')).toEqual({ ok: true })
    expect(api.removeProfile).toHaveBeenCalledWith('personal')
    expect(s().accounts).toBe(before)
  })

  it('a rejected action sets accountsError', async () => {
    installApi({ removeProfile: vi.fn().mockRejectedValue(new Error('nope')) })
    expect((await s().removeProfile('p')).ok).toBe(false)
    expect(s().accountsError).toBe('nope')
  })

  it('setRules, setLimitPolicy, toggleSafety are optimistic and call the api', () => {
    const api = installApi()
    s().setRules([])
    expect(s().accounts.rules).toEqual([])
    expect(api.setRules).toHaveBeenCalledWith([])
    s().setLimitPolicy('wait')
    expect(s().accounts.limitPolicy).toBe('wait')
    expect(api.setLimitPolicy).toHaveBeenCalledWith('wait')
    s().toggleSafety('warnPersonalInCompanyFolder')
    expect(s().accounts.safety.warnPersonalInCompanyFolder).toBe(false)
    expect(api.setSafety).toHaveBeenCalledWith({ ...s().accounts.safety })
    s().toggleSafety('warnPersonalInCompanyFolder')
    expect(s().accounts.safety.warnPersonalInCompanyFolder).toBe(true)
  })

  it('setRules {ok:false} resyncs via getSnapshot and sets accountsError; clearAccountsError clears it', async () => {
    const api = installApi({ setRules: vi.fn().mockResolvedValue({ ok: false, reason: 'save-failed' }) })
    s().setRules([])
    await vi.waitFor(() => expect(api.getSnapshot).toHaveBeenCalled())
    await vi.waitFor(() => expect(s().accountsError).toBe('save-failed'))
    s().clearAccountsError()
    expect(s().accountsError).toBeUndefined()
  })

  it('a rejected setLimitPolicy resyncs and sets accountsError', async () => {
    const api = installApi({ setLimitPolicy: vi.fn().mockRejectedValue(new Error('boom')) })
    s().setLimitPolicy('wait')
    await vi.waitFor(() => expect(api.getSnapshot).toHaveBeenCalled())
    expect(s().accountsError).toBe('boom')
  })

  it('local updates apply without window.api and are immutable', () => {
    const prev = s().accounts
    s().toggleSafety('lockAccountOnTeamStart')
    expect(prev.safety.lockAccountOnTeamStart).toBe(true)
    expect(s().accounts).not.toBe(prev)
    s().setLimitPolicy('switch')
    expect(s().accounts.limitPolicy).toBe('switch')
  })
})

describe('R-11 sign-in state', () => {
  it('startSignIn opens the panel in waiting and calls the api', async () => {
    const api = installApi()
    await s().startSignIn('/d')
    expect(s().signIn).toMatchObject({ step: 'waiting', configDir: '/d', panelOpen: true })
    expect(api.startSignIn).toHaveBeenCalledWith('/d')
  })

  it('startSignIn {ok:false} goes to step error with the reason', async () => {
    installApi({ startSignIn: vi.fn().mockResolvedValue({ ok: false, reason: 'claude-not-found' }) })
    await s().startSignIn('/d')
    expect(s().signIn).toMatchObject({ step: 'error', reason: 'claude-not-found', panelOpen: true })
  })

  it('checkSignIn applies the returned status', async () => {
    const api = installApi()
    await s().startSignIn('/d')
    await s().checkSignIn()
    expect(api.checkSignIn).toHaveBeenCalledWith('/d')
    expect(s().signIn).toMatchObject({ step: 'done', email: 'a@b.c' })
  })

  it('reopenSignIn uses the current dir', async () => {
    const api = installApi()
    await s().startSignIn('/d')
    await s().reopenSignIn()
    expect(api.reopenSignIn).toHaveBeenCalledWith('/d')
  })

  it('applySignInStatus applies a matching dir and ignores another', async () => {
    installApi()
    await s().startSignIn('/d')
    s().applySignInStatus({ configDir: '/other', step: 'done', email: 'x@y.z' })
    expect(s().signIn.step).toBe('waiting')
    s().applySignInStatus({ configDir: '/d', step: 'done', email: 'x@y.z', org: 'O', ptyId: 'p1' })
    expect(s().signIn).toMatchObject({ step: 'done', email: 'x@y.z', org: 'O', ptyId: 'p1', panelOpen: true })
  })

  it('cancelSignIn calls the api then resets', async () => {
    const api = installApi()
    await s().startSignIn('/d')
    await s().cancelSignIn()
    expect(api.cancelSignIn).toHaveBeenCalledWith('/d')
    expect(s().signIn).toEqual({ step: 'none', panelOpen: false })
  })

  it('closeSignInPanel keeps the step', async () => {
    await s().startSignIn('/d')
    s().closeSignInPanel()
    expect(s().signIn).toMatchObject({ panelOpen: false, step: 'waiting' })
  })

  it('setLeadPty stores the pty info', () => {
    s().setLeadPty({ ptyId: 'p', folder: '/f', accountId: 'a' })
    expect(s().leadPty).toEqual({ ptyId: 'p', folder: '/f', accountId: 'a' })
  })
})

describe('R-07 resetConsoleStore', () => {
  it('restores the initial state and never mutates the mocks', () => {
    seedMockAccounts()
    s().navigate('accounts')
    s().selectAgent('rev')
    s().setConsoleDraft('x')
    s().submitConsole()
    s().setLimitPolicy('switch')
    resetConsoleStore()
    expect(s().screen).toBe('team')
    expect(s().selectedAgentId).toBe('lead')
    expect(s().team.console).toHaveLength(0)
    expect(s().accounts).toEqual(EMPTY_ACCOUNTS_SNAPSHOT)
    expect(s().accountsLoaded).toBe(false)
    expect(mockTeamSnapshot.console).toHaveLength(7)
    expect(mockAccountsSnapshot.limitPolicy).toBe('pause')
  })
})

describe('R-07 derived hooks', () => {
  it('useAgentStatuses matches the mockup statuses and is referentially stable', () => {
    const { result, rerender } = renderHook(() => useAgentStatuses())
    expect(result.current).toEqual({
      lead: 'running',
      api: 'running',
      be: 'running',
      ui: 'waiting',
      test: 'needs-you',
      rev: 'done'
    })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('useTeamCounters returns 6 / 3 / 1 / 1.125M tokens', () => {
    const { result } = renderHook(() => useTeamCounters())
    expect(result.current).toEqual({ agents: 6, running: 3, needsYou: 1, tokens: 1125000 })
  })
})

const rt = (over: Partial<AgentRuntime> = {}): AgentRuntime => ({
  kind: 'lead',
  startedMs: 0,
  lastActivityMs: 0,
  openTools: [],
  lastTurn: 'user',
  ...over
})
const agent = (id: string, runtime?: AgentRuntime): Agent => ({ ...structuredClone(PLACEHOLDER_AGENT), id, name: id, runtime })
const snap = (ids: string[], runtimes: Record<string, AgentRuntime> = {}): TeamSnapshot => ({
  ...structuredClone(EMPTY_TEAM_SNAPSHOT),
  source: 'live',
  agents: ids.map((id) => agent(id, runtimes[id]))
})

describe('P3 hydrateTeam / demo', () => {
  beforeEach(() => resetConsoleStore())

  it('live hydrate sets team and liveTeam; keeps a valid selection', () => {
    s().hydrateTeam(snap(['lead', 'a', 'b']))
    s().selectAgent('b')
    s().hydrateTeam(snap(['lead', 'a', 'b']))
    expect(s().selectedAgentId).toBe('b')
    expect(s().team).toBe(s().liveTeam)
  })

  it('re-selects lead, else the first agent, else lead when the selection vanishes', () => {
    s().hydrateTeam(snap(['lead', 'a']))
    s().selectAgent('a')
    s().hydrateTeam(snap(['lead']))
    expect(s().selectedAgentId).toBe('lead')
    s().hydrateTeam(snap(['x', 'y']))
    expect(s().selectedAgentId).toBe('x')
    s().hydrateTeam(snap([]))
    expect(s().selectedAgentId).toBe('lead')
  })

  it('showDemo / exitDemo keep liveTeam; a push during demo does not replace the demo view', () => {
    const live = snap(['lead', 'a'])
    s().hydrateTeam(live)
    s().showDemo()
    expect(s().teamMode).toBe('demo')
    expect(s().team.source).toBe('demo')
    expect(s().team.agents).toHaveLength(mockTeamSnapshot.agents.length)
    expect(s().selectedAgentId).toBe(mockTeamSnapshot.agents[0]!.id)
    expect(s().liveTeam).toBe(live)
    const pushed = snap(['lead', 'a', 'b'])
    s().hydrateTeam(pushed)
    expect(s().team.source).toBe('demo')
    expect(s().liveTeam).toBe(pushed)
    s().exitDemo()
    expect(s().teamMode).toBe('live')
    expect(s().team).toBe(pushed)
    expect(s().selectedAgentId).toBe('lead')
  })

  it('selectSession stores the selection, calls api, hydrates and exits demo', async () => {
    const result = snap(['lead', 'z'])
    const select = vi.fn().mockResolvedValue(result)
    ;(window as unknown as { api: unknown }).api = { transcripts: { select } }
    s().showDemo()
    const sel = { mode: 'session', accountId: 'a', sessionId: 's1' } as const
    await s().selectSession(sel)
    expect(select).toHaveBeenCalledWith(sel)
    expect(s().selection).toEqual(sel)
    expect(s().teamMode).toBe('live')
    expect(s().team).toBe(result)
  })

  it('refreshSessions sets sessions; missing api is a no-op; rejection sets teamError', async () => {
    await s().refreshSessions()
    expect(s().sessions).toEqual([])
    const list = [{ sessionId: 'x' }]
    const listSessions = vi.fn().mockResolvedValue(list)
    ;(window as unknown as { api: unknown }).api = { transcripts: { listSessions } }
    await s().refreshSessions()
    expect(s().sessions).toBe(list)
    listSessions.mockRejectedValue(new Error('boom'))
    await expect(s().refreshSessions()).resolves.toBeUndefined()
    expect(s().teamError).toBe('boom')
  })

  it('setSessions, applyUsage and tick', () => {
    s().setSessions([])
    s().applyUsage({ day: '2026-01-01', byAccount: {} })
    expect(s().usageToday?.day).toBe('2026-01-01')
    s().tick(1234)
    expect(s().nowMs).toBe(1234)
    vi.useFakeTimers()
    vi.setSystemTime(99_000)
    s().tick()
    expect(s().nowMs).toBe(99_000)
    vi.useRealTimers()
  })
})

describe('P3 live status, selectors', () => {
  beforeEach(() => resetConsoleStore())
  afterEach(() => vi.useRealTimers())

  it('derives status from runtime and ticks to stale with fake timers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    s().hydrateTeam(snap(['lead'], { lead: rt({ lastTurn: 'user', lastActivityMs: 1_000_000 }) }))
    s().tick()
    const { result } = renderHook(() => ({ all: useAgentStatuses(), info: useAgentStatusInfo('lead') }))
    expect(result.current.all.lead).toBe('running')
    expect(result.current.info).toEqual({ status: 'running', reason: 'thinking' })
    act(() => {
      vi.setSystemTime(1_000_000 + 6 * 60_000)
      s().tick()
    })
    expect(result.current.all.lead).toBe('waiting')
    expect(result.current.info.reason).toBe('no activity for a while')
  })

  it('demo agents (no runtime) keep the event-derived statuses; unknown id is waiting', () => {
    seedDemoTeam()
    const { result } = renderHook(() => ({ info: useAgentStatusInfo('be'), none: useAgentStatusInfo('nope') }))
    expect(result.current.info).toEqual({ status: 'running' })
    expect(result.current.none.status).toBe('waiting')
  })

  it('selectSelectedAgent returns the placeholder on an empty team; OrNull returns null', () => {
    expect(selectSelectedAgent(s())).toBe(PLACEHOLDER_AGENT)
    expect(selectSelectedAgentOrNull(s())).toBeNull()
    s().hydrateTeam(snap(['lead']))
    expect(selectSelectedAgentOrNull(s())?.id).toBe('lead')
  })

  it('selectTokensToday returns the headline (no cache read) per account', () => {
    expect(selectTokensToday('a')(s())).toBeUndefined()
    s().applyUsage({ day: 'd', byAccount: { a: { input: 10, output: 20, cacheCreation: 30, cacheRead: 999 } } })
    expect(selectTokensToday('a')(s())).toEqual({ headline: 60, cacheRead: 999 })
    expect(selectTokensToday('zz')(s())).toBeUndefined()
  })
})

describe('P3-T11 project grouping in the store', () => {
  const mk = (id: string, key: string | null, mtimeMs: number, live = false): SessionSummary => ({
    sessionId: id,
    accountId: 'a',
    configDir: 'C:/c',
    projectDir: `dir-${key}`,
    ...(key ? { project: { key, name: key.split('/').pop()!, root: key, git: true } } : {}),
    mtimeMs,
    sizeBytes: 1,
    ...(live ? { live: true } : {})
  })
  const list = [mk('s1', 'd:/a', 1000), mk('s2', 'd:/b', 5000, true), mk('s3', 'd:/a', 3000, true), mk('s4', 'd:/b', 2000, true), mk('s5', 'd:/c', 4000)]

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('deriveProjects groups by project key with live counts and newest activity, sorted newest first', () => {
    expect(deriveProjects(list)).toEqual([
      { key: 'd:/b', name: 'b', root: 'd:/b', liveCount: 2, lastActivityMs: 5000 },
      { key: 'd:/c', name: 'c', root: 'd:/c', liveCount: 0, lastActivityMs: 4000 },
      { key: 'd:/a', name: 'a', root: 'd:/a', liveCount: 1, lastActivityMs: 3000 }
    ])
  })

  it('sessions without a project fall back to their cwd/projectDir', () => {
    const g = deriveProjects([{ ...mk('x', null, 1), cwd: 'D:/Work/Zed' }])
    expect(g[0]).toMatchObject({ key: 'd:/work/zed', name: 'Zed' })
  })

  it('initial project: the remembered one when it still exists', () => {
    window.localStorage.setItem('ac.projectKey', 'd:/a')
    s().setSessions(list)
    expect(s().projectKey).toBe('d:/a')
    expect(s().selection).toEqual({ mode: 'auto', projectKey: 'd:/a' })
  })

  it('initial project: a remembered project that is gone is ignored; the current pick wins over the newest', () => {
    window.localStorage.setItem('ac.projectKey', 'd:/gone')
    useConsoleStore.setState({ team: { ...EMPTY_TEAM_SNAPSHOT, sessionId: 's5' } })
    s().setSessions(list)
    expect(s().projectKey).toBe('d:/c')
  })

  it('initial project: otherwise the most recently active project', () => {
    s().setSessions(list)
    expect(s().projectKey).toBe('d:/b')
  })

  it('does not change a chosen project and leaves a pinned session selection alone', () => {
    useConsoleStore.setState({ projectKey: 'd:/a', selection: { mode: 'session', accountId: 'a', sessionId: 's1' } })
    s().setSessions(list)
    expect(s().projectKey).toBe('d:/a')
    expect(s().selection).toEqual({ mode: 'session', accountId: 'a', sessionId: 's1' })
  })

  it('setProject selects auto with that key, remembers it, and survives a broken localStorage', async () => {
    const select = vi.fn().mockResolvedValue({ ...EMPTY_TEAM_SNAPSHOT })
    ;(window as unknown as { api: unknown }).api = { transcripts: { select } }
    s().setProject('d:/c')
    expect(s().projectKey).toBe('d:/c')
    expect(select).toHaveBeenCalledWith({ mode: 'auto', projectKey: 'd:/c' })
    expect(s().selection).toEqual({ mode: 'auto', projectKey: 'd:/c' })
    expect(window.localStorage.getItem('ac.projectKey')).toBe('d:/c')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => s().setProject('d:/a')).not.toThrow()
    expect(s().projectKey).toBe('d:/a')
    spy.mockRestore()
  })
})

describe('T18 per-project view state (UX M5)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetConsoleStore()
    seedDemoTeam()
    useControlStore.setState({ sessions: [], streams: {} })
  })

  it('setProject restores agent, inspector tab, draft and filter of the project it returns to', () => {
    useConsoleStore.setState({ projectKey: 'a' })
    s().selectAgent('ui')
    s().setInspectorTab('files')
    s().setConsoleDraft('half a thought')
    s().setConsoleFilter('tools')
    s().setProject('b')
    expect(s().projectKey).toBe('b')
    expect(s().selectedAgentId).toBe('lead')
    expect(s().inspectorTab).toBe('activity')
    expect(s().consoleDraft).toBe('')
    expect(s().consoleFilter).toBe('')
    s().setInspectorTab('messages')
    s().setProject('a')
    expect(s().selectedAgentId).toBe('ui')
    expect(s().inspectorTab).toBe('files')
    expect(s().consoleDraft).toBe('half a thought')
    expect(s().consoleFilter).toBe('tools')
    s().setProject('b')
    expect(s().inspectorTab).toBe('messages')
  })

  it('persists to ac.viewState and keeps at most 50 projects', () => {
    useConsoleStore.setState({ projectKey: 'a' })
    s().setInspectorTab('files')
    const stored = JSON.parse(window.localStorage.getItem('ac.viewState')!) as Record<string, { inspectorTab: string }>
    expect(stored.a!.inspectorTab).toBe('files')
    for (let i = 0; i < 55; i++) s().setProject('p' + i)
    expect(Object.keys(s().perProject).length).toBeLessThanOrEqual(50)
    const after = JSON.parse(window.localStorage.getItem('ac.viewState')!) as Record<string, unknown>
    expect(Object.keys(after).length).toBeLessThanOrEqual(50)
    expect(after.p54).toBeDefined()
    expect(after.a).toBeUndefined()
  })

  it('useScrollMemory saves and restores scrollTop per project', () => {
    vi.useFakeTimers()
    try {
      const el = document.createElement('div')
      const ref = { current: el }
      useConsoleStore.setState({ projectKey: 'a' })
      renderHook(() => useScrollMemory('console', ref))
      el.scrollTop = 40
      el.dispatchEvent(new Event('scroll'))
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(s().perProject.a!.scroll.console).toBe(40)
      act(() => s().setProject('b'))
      expect(el.scrollTop).toBe(0)
      act(() => s().setProject('a'))
      expect(el.scrollTop).toBe(40)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('T18 Auto never switches under the user', () => {
  const live = () => {
    useConsoleStore.setState({
      teamMode: 'live',
      team: { ...structuredClone(EMPTY_TEAM_SNAPSHOT), sessionId: 's1' },
      sessions: [{ sessionId: 's1', accountId: 'acc' } as SessionSummary],
      projectKey: 'p',
      selection: { mode: 'auto', projectKey: 'p' }
    })
  }
  beforeEach(() => {
    window.localStorage.clear()
    resetConsoleStore()
    useControlStore.setState({ sessions: [], streams: {} })
    live()
  })

  it('a non-empty draft pins the current session; clearing it restores Auto', () => {
    s().setConsoleDraft('typing')
    expect(s().autoHeld).toBe(true)
    expect(s().selection).toEqual({ mode: 'session', accountId: 'acc', sessionId: 's1' })
    s().setConsoleDraft('typing more')
    expect(s().selection.mode).toBe('session')
    s().setConsoleDraft('')
    expect(s().autoHeld).toBe(false)
    expect(s().selection).toEqual({ mode: 'auto', projectKey: 'p' })
  })

  it('an open permission prompt or a focused card also holds Auto, and the hold waits for both', () => {
    s().setApprovalFocused(true)
    expect(s().autoHeld).toBe(true)
    s().setConsoleDraft('x')
    s().setApprovalFocused(false)
    expect(s().autoHeld).toBe(true) // draft still open
    s().setConsoleDraft('')
    expect(s().autoHeld).toBe(false)
    expect(s().selection.mode).toBe('auto')

    useControlStore.setState({
      sessions: [{ id: 'c1', sessionId: 's1', pendingPermissions: 1, state: 'idle' } as unknown as ControlSessionInfo]
    })
    expect(s().autoHeld).toBe(true)
    expect(s().selection.mode).toBe('session')
    useControlStore.setState({
      sessions: [{ id: 'c1', sessionId: 's1', pendingPermissions: 0, state: 'idle' } as unknown as ControlSessionInfo]
    })
    expect(s().autoHeld).toBe(false)
    expect(s().selection).toEqual({ mode: 'auto', projectKey: 'p' })
  })

  it('a demo submit that clears the draft releases the hold; a manual selection drops it', async () => {
    s().setConsoleDraft('x')
    expect(s().autoHeld).toBe(true)
    await s().selectSession({ mode: 'session', accountId: 'acc', sessionId: 's2' })
    expect(s().autoHeld).toBe(false)
    s().setConsoleDraft('')
    expect(s().selection).toEqual({ mode: 'session', accountId: 'acc', sessionId: 's2' })
  })

  it('selectAdjacentAgent walks the tree order and wraps', () => {
    seedDemoTeam()
    const ids = s().team.agents.map((a) => a.id)
    useConsoleStore.setState({ selectedAgentId: ids[0]! })
    s().selectAdjacentAgent(-1)
    expect(s().selectedAgentId).toBe(ids.at(-1))
    s().selectAdjacentAgent(1)
    expect(s().selectedAgentId).toBe(ids[0])
    s().selectAdjacentAgent(1)
    expect(s().selectedAgentId).toBe(ids[1])
  })
})

describe('T18 needs-you merge', () => {
  it('adds the open permission prompts of the controlled session to the agent count', () => {
    resetConsoleStore()
    useConsoleStore.setState({ teamMode: 'live', team: { ...structuredClone(EMPTY_TEAM_SNAPSHOT), sessionId: 's1' } })
    useControlStore.setState({ sessions: [], streams: {} })
    const { result } = renderHook(() => useTeamCounters())
    expect(result.current.needsYou).toBe(0)
    act(() =>
      useControlStore.setState({
        sessions: [{ id: 'c1', sessionId: 's1', pendingPermissions: 2, state: 'idle' } as unknown as ControlSessionInfo]
      })
    )
    expect(result.current.needsYou).toBe(2)
    act(() => useControlStore.setState({ sessions: [] }))
    expect(result.current.needsYou).toBe(0)
  })
})
