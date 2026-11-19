// @vitest-environment jsdom
import './jestDom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { SharedTaskList } from '@renderer/components/team/SharedTaskList'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { mockAccountsSnapshot } from '@shared/mock'
import { seedMockAccounts } from './seedAccounts'

beforeEach(() => {
  resetConsoleStore()
  seedMockAccounts()
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('R-11 TeamHeader without an account', () => {
  it('shows No account with a neutral avatar and border', () => {
    resetConsoleStore()
    render(<TeamHeader />)
    const chip = screen.getByRole('button', { name: 'Account: none. Manage accounts' })
    expect(chip).toHaveTextContent('No account')
    expect(chip).toHaveTextContent('?')
    expect(document.querySelector('header')!.style.borderTop).toContain('var(--ac-border)')
  })

  it('shows a lock icon when the active account is locked', () => {
    const snap = structuredClone(mockAccountsSnapshot)
    snap.accounts = snap.accounts.map((a) => (a.id === snap.activeAccountId ? { ...a, locked: true } : a))
    useConsoleStore.getState().hydrateAccounts(snap)
    render(<TeamHeader />)
    expect(screen.getByTitle('Account locked while a session runs')).toBeInTheDocument()
  })

  it('shows no lock icon when unlocked', () => {
    render(<TeamHeader />)
    expect(screen.queryByTitle('Account locked while a session runs')).toBeNull()
  })
})

describe('R-11 TeamHeader chip truncation', () => {
  it('puts the full name and email in title and ellipsis classes on the spans', () => {
    const snap = structuredClone(mockAccountsSnapshot)
    snap.accounts = snap.accounts.map((a) =>
      a.id === snap.activeAccountId
        ? { ...a, name: "someone@example.vn's Organization", email: 'someone@example.vn' }
        : a
    )
    useConsoleStore.getState().hydrateAccounts(snap)
    const { container } = render(<TeamHeader />)
    const chip = container.querySelector('.ac-header__chip')!
    expect(chip).toHaveAttribute('title', "someone@example.vn's Organization · someone@example.vn")
    expect(container.querySelector('.ac-header__email')).toHaveTextContent('someone@example.vn')
    expect(container.querySelector('.ac-header__name')).toBeInTheDocument()
  })
})

describe('R-08 TeamHeader', () => {
  it('shows the app name, repo, team and account chip', () => {
    render(<TeamHeader />)
    expect(screen.getByText('Agent Console')).toBeInTheDocument()
    expect(screen.getByText(/hicas\/sheet-automation/)).toBeInTheDocument()
    expect(screen.getByText(/team: sheet-export/)).toBeInTheDocument()
    expect(screen.getByText('you@company.com')).toBeInTheDocument()
    const chip = screen.getByRole('button', { name: 'Account: Company. Manage accounts' })
    expect(chip).toBeInTheDocument()
  })

  it('uses a 20px chip avatar and a decorative separator', () => {
    const { container } = render(<TeamHeader />)
    const avatar = screen.getByRole('button', { name: /Manage accounts/ }).firstElementChild as HTMLElement
    expect(avatar.style.width).toBe('20px')
    expect(avatar.style.height).toBe('20px')
    expect(container.querySelector('.ac-header__sep')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows the counters: 6 agents, 3 running, 1 needs you, Tokens 1.12M', () => {
    const { container } = render(<TeamHeader />)
    expect(container).toHaveTextContent(/6\s*agents/)
    expect(container).toHaveTextContent(/3\s*running/)
    expect(container).toHaveTextContent(/1\s*needs you/)
    expect(container).toHaveTextContent(/Tokens\s*1\.12M/)
  })

  it('has the Pause all and + New teammate buttons', () => {
    render(<TeamHeader />)
    expect(screen.getByRole('button', { name: 'Pause all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New teammate' })).toBeInTheDocument()
  })

  it('Pause all calls window.api.team.pauseAll', async () => {
    const pauseAll = vi.fn().mockResolvedValue({ ok: false, reason: 'not-implemented' })
    ;(window as unknown as { api: unknown }).api = { team: { pauseAll } }
    render(<TeamHeader />)
    await userEvent.click(screen.getByRole('button', { name: 'Pause all' }))
    expect(pauseAll).toHaveBeenCalledTimes(1)
  })

  it('Pause all and + New teammate do not throw without window.api', async () => {
    render(<TeamHeader />)
    await userEvent.click(screen.getByRole('button', { name: 'Pause all' }))
    await userEvent.click(screen.getByRole('button', { name: '+ New teammate' }))
  })

  it('clicking the account chip opens the Accounts screen (R-13)', async () => {
    render(<TeamHeader />)
    await userEvent.click(screen.getByRole('button', { name: /Account: Company/ }))
    expect(useConsoleStore.getState().screen).toBe('accounts')
  })

  it('the 3px top border uses the active account color when the color edge is enabled', () => {
    const { container, rerender } = render(<TeamHeader />)
    const header = container.querySelector('header')!
    expect(header).not.toBeNull()
    const on = (header.getAttribute('style') ?? '').toLowerCase()
    expect(on).toMatch(/#6e9bf0|rgb\(\s*110,\s*155,\s*240\s*\)/)
    expect(on).toMatch(/3px/)

    useConsoleStore.getState().toggleSafety('showAccountColorEdge')
    rerender(<TeamHeader />)
    const off = (container.querySelector('header')!.getAttribute('style') ?? '').toLowerCase()
    expect(off).not.toMatch(/#6e9bf0|rgb\(\s*110,\s*155,\s*240\s*\)/)
  })
})

describe('R-09 WorktreeList', () => {
  it('has the Worktrees heading and an Add worktree button', () => {
    render(<WorktreeList />)
    expect(screen.getByRole('heading', { name: 'Worktrees' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add worktree' })).toBeInTheDocument()
  })

  it('lists every worktree with branch and path', () => {
    render(<WorktreeList />)
    for (const branch of ['main', 'feat/api-schema', 'feat/backend-auth', 'feat/ui-panel', 'feat/tests'])
      expect(screen.getAllByText(branch).length).toBeGreaterThan(0)
    expect(screen.getByText('~/repos/sheet-automation')).toBeInTheDocument()
    expect(screen.getByText('.worktrees/api-schema')).toBeInTheDocument()
    expect(screen.getByText('.worktrees/tests')).toBeInTheDocument()
  })

  it('shows state text: clean, file counts with ahead, overlap', () => {
    const { container } = render(<WorktreeList />)
    expect(screen.getByText('clean')).toBeInTheDocument()
    expect(container).toHaveTextContent('3 files · ↑2')
    expect(container).toHaveTextContent('3 files · ↑4')
    expect(container).toHaveTextContent('1 file · ↑1')
    expect(container).not.toHaveTextContent('1 files')
    expect(container).not.toHaveTextContent('↑0')
    expect(screen.getByText('overlaps feat/api-schema')).toBeInTheDocument()
  })

  it('shows agent names, not ids', () => {
    const { container } = render(<WorktreeList />)
    expect(container).toHaveTextContent(/lead, reviewer/)
    expect(container).toHaveTextContent(/api-designer/)
    expect(container).toHaveTextContent(/test-writer/)
  })

  it('the overlapping worktree card uses the warn border', () => {
    render(<WorktreeList />)
    const label = screen.getByText('overlaps feat/api-schema')
    let el: HTMLElement | null = label
    let found = false
    while (el && !found) {
      const style = (el.getAttribute('style') ?? '').toLowerCase()
      const cls = el.className?.toString() ?? ''
      if (/5a3e1e|rgb\(\s*90,\s*62,\s*30\s*\)|warn/.test(style + ' ' + cls)) found = true
      el = el.parentElement
    }
    expect(found).toBe(true)
  })
})

describe('R-09 SharedTaskList', () => {
  it('has the Shared tasks heading and a list of 6 tasks', () => {
    render(<SharedTaskList />)
    expect(screen.getByRole('heading', { name: 'Shared tasks' })).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6)
  })

  it('prefixes titles with #id', () => {
    render(<SharedTaskList />)
    expect(screen.getByText('#1 Define API contract')).toBeInTheDocument()
    expect(screen.getByText('#4 Sheet panel UI')).toBeInTheDocument()
    expect(screen.getByText('#6 Review API contract')).toBeInTheDocument()
  })

  it('shows the meta line per state with the owner name', () => {
    render(<SharedTaskList />)
    expect(screen.getByText('Done · api-designer')).toBeInTheDocument()
    expect(screen.getByText('In progress · api-designer')).toBeInTheDocument()
    expect(screen.getByText('In progress · backend-impl')).toBeInTheDocument()
    expect(screen.getByText('Blocked by #2 · ui-builder')).toBeInTheDocument()
    expect(screen.getByText('2 failing · test-writer')).toBeInTheDocument()
    expect(screen.getByText('Done · reviewer')).toBeInTheDocument()
  })
})
