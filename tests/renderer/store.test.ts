// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import {
  resetConsoleStore,
  selectActiveAccount,
  selectSelectedAgent,
  useAgentStatuses,
  useConsoleStore,
  useTeamCounters
} from '@renderer/store/useConsoleStore'

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

  it('is seeded with deep clones of the mock snapshots', () => {
    expect(s().team).toEqual(mockTeamSnapshot)
    expect(s().accounts).toEqual(mockAccountsSnapshot)
    expect(s().team).not.toBe(mockTeamSnapshot)
    expect(s().team.agents).not.toBe(mockTeamSnapshot.agents)
    expect(s().accounts.accounts).not.toBe(mockAccountsSnapshot.accounts)
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

  it('selectActiveAccount returns the active account', () => {
    expect(selectActiveAccount(s()).id).toBe('company')
    expect(selectActiveAccount(s())).toBe(selectActiveAccount(s()))
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

describe('R-07 hydrate', () => {
  it('hydrateTeam and hydrateAccounts replace the snapshots', () => {
    s().hydrateTeam({ ...mockTeamSnapshot, teamName: 'from-ipc' })
    expect(s().team.teamName).toBe('from-ipc')
    s().hydrateAccounts({ ...mockAccountsSnapshot, defaultAccountId: 'personal' })
    expect(s().accounts.defaultAccountId).toBe('personal')
  })
})

describe('R-07 accounts state', () => {
  it('setDefaultAccount', () => {
    s().setDefaultAccount('personal')
    expect(s().accounts.defaultAccountId).toBe('personal')
    expect(mockAccountsSnapshot.defaultAccountId).toBe('company')
  })

  it('linkDetected links the suggested account and marks it signed in', () => {
    const find = (id: string) => s().accounts.accounts.find((a) => a.id === id)!
    expect(find('company').signedIn).toBe(false)
    s().linkDetected('~/.claude')
    expect(find('company').signedIn).toBe(true)
    expect(s().accounts.detected.find((d) => d.configDir === '~/.claude')!.linkedAccountId).toBe('company')
    expect(find('personal').signedIn).toBe(false)
  })

  it('sign-in flow: start then finish', () => {
    s().startSignIn('~/.claude-personal')
    expect(s().signIn).toMatchObject({ step: 'waiting', configDir: '~/.claude-personal', panelOpen: true })
    s().finishSignIn()
    expect(s().signIn.step).toBe('done')
    const personal = s().accounts.accounts.find((a) => a.id === 'personal')!
    expect(personal.signedIn).toBe(true)
    const det = s().accounts.detected.find((d) => d.configDir === '~/.claude-personal')!
    expect(det).toMatchObject({ signedIn: true, email: 'you@gmail.com', linkedAccountId: 'personal' })
    s().closeSignInPanel()
    expect(s().signIn.panelOpen).toBe(false)
    expect(s().signIn.step).toBe('done')
  })

  it('sign-in flow: start then cancel resets', () => {
    s().startSignIn('~/.claude-personal')
    s().cancelSignIn()
    expect(s().signIn).toMatchObject({ step: 'none', panelOpen: false })
    expect(s().accounts.accounts.find((a) => a.id === 'personal')!.signedIn).toBe(false)
  })

  it('setLimitPolicy and toggleSafety', () => {
    s().setLimitPolicy('wait')
    expect(s().accounts.limitPolicy).toBe('wait')
    expect(s().accounts.safety.warnPersonalInCompanyFolder).toBe(true)
    s().toggleSafety('warnPersonalInCompanyFolder')
    expect(s().accounts.safety.warnPersonalInCompanyFolder).toBe(false)
    expect(s().accounts.safety.showAccountColorEdge).toBe(true)
    s().toggleSafety('warnPersonalInCompanyFolder')
    expect(s().accounts.safety.warnPersonalInCompanyFolder).toBe(true)
  })

  it('updates are immutable (previous slices are not mutated)', () => {
    const prevAccounts = s().accounts
    s().toggleSafety('lockAccountOnTeamStart')
    expect(prevAccounts.safety.lockAccountOnTeamStart).toBe(true)
    expect(s().accounts).not.toBe(prevAccounts)
  })
})

describe('R-07 resetConsoleStore', () => {
  it('restores the initial state and never mutates the mocks', () => {
    s().navigate('accounts')
    s().selectAgent('rev')
    s().setConsoleDraft('x')
    s().submitConsole()
    s().linkDetected('~/.claude')
    s().setLimitPolicy('switch')
    resetConsoleStore()
    expect(s().screen).toBe('team')
    expect(s().selectedAgentId).toBe('be')
    expect(s().team.console).toHaveLength(7)
    expect(s().accounts.limitPolicy).toBe('pause')
    expect(mockTeamSnapshot.console).toHaveLength(7)
    expect(mockAccountsSnapshot.limitPolicy).toBe('pause')
    expect(mockAccountsSnapshot.accounts[0]!.signedIn).toBe(false)
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
