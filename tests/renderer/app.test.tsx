// @vitest-environment jsdom
import './jestDom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import App from '@renderer/App'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'

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
  it('renders the Team view first, without errors, and sets the document title', () => {
    render(<App />)
    expect(screen.getByText('Lead console')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(document.title).toBe('Agent Console')
  })

  it('account chip -> Accounts, Team view link -> back', async () => {
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
