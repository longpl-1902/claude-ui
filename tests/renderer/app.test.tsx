// @vitest-environment jsdom
import './jestDom'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import App from '@renderer/App'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'

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
    render(<App />)
    expect(screen.getByText('Lead console')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(document.title).toBe('Agent Console')
  })

  it('account chip -> Accounts, Team view link -> back', async () => {
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
    expect(screen.getByText(/team: sheet-export/)).toBeInTheDocument()
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
