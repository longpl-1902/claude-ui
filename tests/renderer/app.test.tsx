// @vitest-environment jsdom
import './jestDom'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import type { SessionSummary } from '@shared/types'
import App from '@renderer/App'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore'
import { seedMockAccounts } from './seedAccounts'
import { seedDemoTeam } from './seedTeam'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open() {}
    write() {}
    dispose() {}
    loadAddon() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

beforeEach(() => resetConsoleStore())
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('R-13 / R-15 App navigation (no window.api)', () => {
  it('shows No account at first paint (no fake data)', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Account: none. Manage accounts' })).toBeInTheDocument()
  })

  it('renders the Team view first, without errors, and sets the document title', () => {
    seedDemoTeam()
    render(<App />)
    expect(screen.getByText('Lead console')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(document.title).toBe('Agent Console')
  })

  it('account chip -> Accounts, Team view link -> back', async () => {
    seedDemoTeam()
    seedMockAccounts()
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /Account: Company/ }))
    expect(screen.getByRole('heading', { name: 'Claude accounts' })).toBeInTheDocument()
    expect(screen.queryByText('Lead console')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Team view/ }))
    expect(screen.getByText('Lead console')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Claude accounts' })).toBeNull()
  })
})

describe('R-03 / R-13 App hydrates from window.api', () => {
  it('shows the team name from the IPC snapshot', async () => {
    const team = { ...structuredClone(mockTeamSnapshot), teamName: 'from-ipc' }
    const api = {
      team: { getSnapshot: vi.fn().mockResolvedValue(team) },
      accounts: { getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockAccountsSnapshot)) }
    }
    ;(window as unknown as { api: unknown }).api = api
    render(<App />)
    await waitFor(() => expect(screen.getByText(/team: from-ipc/)).toBeInTheDocument())
    expect(api.team.getSnapshot).toHaveBeenCalled()
    expect(api.accounts.getSnapshot).toHaveBeenCalled()
    expect(useConsoleStore.getState().team.teamName).toBe('from-ipc')
  })

  it('survives a rejecting snapshot call', async () => {
    const api = {
      team: { getSnapshot: vi.fn().mockRejectedValue(new Error('nope')) },
      accounts: { getSnapshot: vi.fn().mockRejectedValue(new Error('nope')) }
    }
    ;(window as unknown as { api: unknown }).api = api
    render(<App />)
    await waitFor(() => expect(api.team.getSnapshot).toHaveBeenCalled())
    // first paint is no longer mock: a rejected snapshot leaves the empty live state
    expect(useConsoleStore.getState().team.source).toBe('empty')
    expect(screen.queryByText(/team: sheet-export/)).toBeNull()
  })
})

describe('R-11 App subscriptions', () => {
  it('subscribes to pushes, updates the store, and unsubscribes on unmount', async () => {
    const offChanged = vi.fn()
    const offStatus = vi.fn()
    let onChanged: (s: unknown) => void = () => {}
    let onStatus: (s: unknown) => void = () => {}
    const api = {
      team: { getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockTeamSnapshot)) },
      accounts: {
        getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockAccountsSnapshot)),
        onChanged: vi.fn((cb) => {
          onChanged = cb
          return offChanged
        }),
        onSignInStatus: vi.fn((cb) => {
          onStatus = cb
          return offStatus
        })
      }
    }
    ;(window as unknown as { api: unknown }).api = api
    const { unmount } = render(<App />)
    await waitFor(() => expect(useConsoleStore.getState().accountsLoaded).toBe(true))
    expect(screen.getByRole('button', { name: /Account: Company/ })).toBeInTheDocument()

    act(() => onChanged({ ...structuredClone(mockAccountsSnapshot), activeAccountId: 'personal' }))
    expect(useConsoleStore.getState().accounts.activeAccountId).toBe('personal')
    expect(await screen.findByRole('button', { name: /Account: Personal/ })).toBeInTheDocument()

    await act(() => useConsoleStore.getState().startSignIn('/d'))
    act(() => onStatus({ configDir: '/d', step: 'done', email: 'a@b.c' }))
    expect(useConsoleStore.getState().signIn.step).toBe('done')

    unmount()
    expect(offChanged).toHaveBeenCalledTimes(1)
    expect(offStatus).toHaveBeenCalledTimes(1)
  })

  it('does not crash when the api mock has no subscribe functions', async () => {
    const api = {
      team: { getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockTeamSnapshot)) },
      accounts: { getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockAccountsSnapshot)) }
    }
    ;(window as unknown as { api: unknown }).api = api
    const { unmount } = render(<App />)
    await waitFor(() => expect(useConsoleStore.getState().accountsLoaded).toBe(true))
    unmount()
  })
})

describe('P3 App live wiring', () => {
  it('hydrates selection/sessions/usage, subscribes, ticks every 5 s, cleans up', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const offs = { team: vi.fn(), sessions: vi.fn(), usage: vi.fn() }
      let onTeam: (s: unknown) => void = () => {}
      let onSessions: (s: unknown) => void = () => {}
      let onUsage: (s: unknown) => void = () => {}
      const sel = { mode: 'session', accountId: 'a', sessionId: 's' }
      const api = {
        team: {
          getSnapshot: vi.fn().mockResolvedValue({ ...structuredClone(mockTeamSnapshot), source: 'live', teamName: 'live-1' }),
          onChanged: vi.fn((cb) => ((onTeam = cb), offs.team))
        },
        transcripts: {
          getSelection: vi.fn().mockResolvedValue(sel),
          listSessions: vi.fn().mockResolvedValue([{ sessionId: 's' }]),
          onSessionsChanged: vi.fn((cb) => ((onSessions = cb), offs.sessions))
        },
        usage: {
          getToday: vi.fn().mockResolvedValue({ day: 'd', byAccount: {} }),
          onChanged: vi.fn((cb) => ((onUsage = cb), offs.usage))
        },
        accounts: { getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockAccountsSnapshot)) }
      }
      ;(window as unknown as { api: unknown }).api = api
      const { unmount } = render(<App />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const st = useConsoleStore.getState()
      expect(st.team.teamName).toBe('live-1')
      expect(st.selection).toEqual(sel)
      expect(st.sessions).toHaveLength(1)
      expect(st.usageToday?.day).toBe('d')

      act(() => onTeam({ ...structuredClone(mockTeamSnapshot), source: 'live', teamName: 'live-2' }))
      expect(useConsoleStore.getState().team.teamName).toBe('live-2')
      act(() => onSessions([]))
      expect(useConsoleStore.getState().sessions).toEqual([])
      act(() => onUsage({ day: 'd2', byAccount: {} }))
      expect(useConsoleStore.getState().usageToday?.day).toBe('d2')

      const before = useConsoleStore.getState().nowMs
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(useConsoleStore.getState().nowMs).toBeGreaterThan(before)

      unmount()
      expect(offs.team).toHaveBeenCalledTimes(1)
      expect(offs.sessions).toHaveBeenCalledTimes(1)
      expect(offs.usage).toHaveBeenCalledTimes(1)
      const after = useConsoleStore.getState().nowMs
      await vi.advanceTimersByTimeAsync(10_000)
      expect(useConsoleStore.getState().nowMs).toBe(after)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('T18 App glue: store init, git watch, shortcuts help', () => {
  const session = (git: boolean, over: Record<string, unknown> = {}) =>
    ({
      sessionId: 's1',
      accountId: 'a',
      project: { key: 'c:/users/u/acme', name: 'acme', root: 'C:/Users/u/acme', git },
      cwd: 'C:/Users/u/acme/sub',
      mtimeMs: 1,
      live: true,
      ...over
    }) as unknown as SessionSummary

  function mockApi() {
    const offs = { control: vi.fn(), stream: vi.fn(), git: vi.fn(), hooks: vi.fn() }
    const api = {
      team: { getSnapshot: vi.fn().mockResolvedValue({ ...structuredClone(mockTeamSnapshot), source: 'live', sessionId: 's1', cwd: 'C:/Users/u/acme/sub' }) },
      accounts: { getSnapshot: vi.fn().mockResolvedValue(structuredClone(mockAccountsSnapshot)) },
      control: {
        list: vi.fn().mockResolvedValue([]),
        onChanged: vi.fn(() => offs.control),
        onStream: vi.fn(() => offs.stream)
      },
      git: { watch: vi.fn().mockResolvedValue({ root: null, base: null, worktrees: [], overlaps: [], updatedAt: 't' }), onChanged: vi.fn(() => offs.git) },
      hooks: { status: vi.fn().mockResolvedValue(null), onChanged: vi.fn(() => offs.hooks) }
    }
    ;(window as unknown as { api: unknown }).api = api
    return { api, offs }
  }

  beforeEach(() => {
    useWorkspaceStore.setState({ watchedRoot: null, workspace: null })
    useControlStore.setState({ sessions: [], streams: {} })
  })

  it('inits the control and workspace stores once and cleans up on unmount', async () => {
    const { api, offs } = mockApi()
    const { unmount } = render(<App />)
    await waitFor(() => expect(api.control.list).toHaveBeenCalledTimes(1))
    expect(api.control.onChanged).toHaveBeenCalledTimes(1)
    expect(api.git.onChanged).toHaveBeenCalledTimes(1)
    unmount()
    expect(offs.control).toHaveBeenCalledTimes(1)
    expect(offs.stream).toHaveBeenCalledTimes(1)
    expect(offs.git).toHaveBeenCalledTimes(1)
    expect(offs.hooks).toHaveBeenCalledTimes(1)
  })

  it('watches the project root of a git session', async () => {
    const { api } = mockApi()
    useConsoleStore.setState({ teamMode: 'live', sessions: [session(true)], team: { ...structuredClone(mockTeamSnapshot), source: 'live', sessionId: 's1', cwd: 'C:/Users/u/acme/sub' } })
    render(<App />)
    await waitFor(() => expect(api.git.watch).toHaveBeenCalledWith('C:/Users/u/acme'))
  })

  it('watches the team cwd when the project is not a git root', async () => {
    const { api } = mockApi()
    useConsoleStore.setState({ teamMode: 'live', sessions: [session(false)], team: { ...structuredClone(mockTeamSnapshot), source: 'live', sessionId: 's1', cwd: 'C:/Users/u/acme/sub' } })
    render(<App />)
    await waitFor(() => expect(api.git.watch).toHaveBeenCalledWith('C:/Users/u/acme/sub'))
  })

  it('does not watch anything in demo mode', async () => {
    const { api } = mockApi()
    seedDemoTeam()
    render(<App />)
    await waitFor(() => expect(api.control.list).toHaveBeenCalled())
    expect(api.git.watch).not.toHaveBeenCalledWith(expect.any(String))
  })

  it('? opens the shortcut help and Esc closes it (narrow 900 px window)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 })
    seedDemoTeam()
    render(<App />)
    await userEvent.keyboard('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
  })
})
