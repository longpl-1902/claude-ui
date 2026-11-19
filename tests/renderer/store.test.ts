// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_ACCOUNTS_SNAPSHOT } from '@shared/accountsDefaults'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import {
  resetConsoleStore,
  selectActiveAccount,
  selectSelectedAgent,
  useAgentStatuses,
  useConsoleStore,
  useTeamCounters
} from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'

const s = () => useConsoleStore.getState()

beforeEach(() => resetConsoleStore())
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('R-07 initial state', () => {
  it('starts on the team screen with be selected and the activity tab', () => {
    expect(s().screen).toBe('team')
    expect(s().selectedAgentId).toBe('be')
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

  it('team stays seeded with a deep clone of the mock', () => {
    expect(s().team).toEqual(mockTeamSnapshot)
    expect(s().team).not.toBe(mockTeamSnapshot)
    expect(s().team.agents).not.toBe(mockTeamSnapshot.agents)
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

  it('sends to the lead through window.api when there is no @mention', () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { agent: { sendMessage } }
    s().setConsoleDraft('hello')
    s().submitConsole()
    expect(sendMessage).toHaveBeenCalledWith('lead', 'hello')
  })

  it('sends to the @mentioned agent id', () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { agent: { sendMessage } }
    s().setConsoleDraft('@ui-builder please start')
    s().submitConsole()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]![0]).toBe('ui')
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
  it('hydrateTeam replaces the team; hydrateAccounts sets loaded', () => {
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

  it('finishSignIn is an alias of checkSignIn', async () => {
    const api = installApi()
    await s().startSignIn('/d')
    await s().finishSignIn()
    expect(api.checkSignIn).toHaveBeenCalledTimes(1)
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
    expect(s().selectedAgentId).toBe('be')
    expect(s().team.console).toHaveLength(7)
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
