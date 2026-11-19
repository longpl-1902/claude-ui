// @vitest-environment jsdom
import './jestDom'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAccountsSnapshot } from '@shared/mock'
import type { AccountsSnapshot } from '@shared/types'
import { AccountsView } from '@renderer/screens/AccountsView'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'

const api = {
  setDefault: vi.fn(),
  startSignIn: vi.fn(),
  saveProfile: vi.fn(),
  removeProfile: vi.fn(),
  setRules: vi.fn(),
  setLimitPolicy: vi.fn(),
  setSafety: vi.fn()
}

const company = mockAccountsSnapshot.rules[0]!
const personal = mockAccountsSnapshot.rules[1]!

function setup() {
  useConsoleStore.getState().navigate('accounts')
  return render(<AccountsView />)
}
function patch(fn: (s: AccountsSnapshot) => void): void {
  const snap = structuredClone(mockAccountsSnapshot)
  fn(snap)
  act(() => useConsoleStore.getState().hydrateAccounts(snap))
}
function card(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.ac-acc-card__name' }).closest('.ac-acc-card') as HTMLElement
}

beforeEach(() => {
  resetConsoleStore()
  seedMockAccounts()
  for (const f of Object.values(api)) f.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { api?: unknown }).api = { accounts: api }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  vi.restoreAllMocks()
})

describe('Account cards', () => {
  it('shows formatted tokens when set and a dash when undefined', () => {
    setup()
    act(() =>
      useConsoleStore.setState({
        usageToday: {
          day: 'd',
          byAccount: {
            [useConsoleStore.getState().accounts.accounts[0]!.id]: {
              input: 1_000_000,
              output: 100_000,
              cacheCreation: 20_000,
              cacheRead: 0
            }
          }
        }
      })
    )
    expect(within(card('Company')).getByText('1.12M')).toBeInTheDocument()
    expect(within(card('Personal')).getByText('Tokens used today')).toBeInTheDocument()
    expect(within(card('Personal')).getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/Usage not available/)).toBeNull()
  })

  it('has no plan row without a plan and shows it when set', () => {
    setup()
    expect(screen.queryByText('Plan')).toBeNull()
    patch((s) => {
      s.accounts[0]!.plan = 'Max'
    })
    expect(screen.getByText('Plan')).toBeInTheDocument()
  })

  it('shows email or Not signed in, kind tag and default folder note', () => {
    patch((s) => {
      delete s.accounts[1]!.email
      s.accounts[0]!.kind = 'company'
      s.accounts[0]!.isDefaultDir = true
    })
    setup()
    expect(within(card('Personal')).getByText('Not signed in')).toBeInTheDocument()
    expect(within(card('Company')).getByText('Company', { selector: '.ac-acc-tag' })).toBeInTheDocument()
    expect(card('Company')).toHaveTextContent('(default folder)')
  })

  /** T32 U14: Sign in again, Rename & color and Remove live in the card's "..." menu. */
  const openMenu = async (name: string): Promise<HTMLElement> => {
    await userEvent.click(within(card(name)).getByRole('button', { name: `More actions for ${name}` }))
    return screen.getByRole('menu')
  }

  it('Locked badge removes Sign in again from the menu', async () => {
    patch((s) => {
      s.accounts[1]!.locked = true
    })
    setup()
    const c = card('Personal')
    expect(within(c).getByText(/Locked/)).toBeInTheDocument()
    expect(within(await openMenu('Personal')).queryByRole('menuitem', { name: 'Sign in again' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(within(await openMenu('Company')).getByRole('menuitem', { name: 'Sign in again' })).toBeInTheDocument()
  })

  it('Sign in again calls startSignIn with the config dir', async () => {
    setup()
    await openMenu('Personal')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in again' }))
    expect(api.startSignIn).toHaveBeenCalledWith('~/.claude-personal')
  })

  it('Set as default calls the api and is not offered for the default', async () => {
    setup()
    expect(within(card('Company')).getByText('Default')).toBeInTheDocument()
    expect(within(card('Company')).queryByRole('button', { name: 'Set as default' })).toBeNull()
    await userEvent.click(within(card('Personal')).getByRole('button', { name: 'Set as default' }))
    expect(api.setDefault).toHaveBeenCalledWith('personal')
    expect(within(card('Personal')).getByText('Default')).toBeInTheDocument()
  })

  it('shows the empty state', () => {
    patch((s) => {
      s.accounts = []
    })
    setup()
    expect(screen.getByText('No accounts yet. Use a detected login above, or add one.')).toBeInTheDocument()
  })

  it('has one + Add account button; the header one opens the editor focused on Name', async () => {
    setup()
    const btns = screen.getAllByRole('button', { name: '+ Add account' })
    expect(btns).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Add another/ })).toBeNull()
    await userEvent.click(btns[0]!)
    const form = screen.getByRole('form', { name: 'Add account' })
    expect(within(form).getByLabelText('Name')).toHaveFocus()
  })

  it('empty state shows its own block with a single Add button area', () => {
    patch((s) => {
      s.accounts = []
    })
    setup()
    expect(screen.getByText('No accounts yet. Use a detected login above, or add one.')).toBeInTheDocument()
  })

  it('shows the invalid-folder reason in plain words', async () => {
    api.saveProfile.mockResolvedValue({ ok: false, reason: 'invalid-folder' })
    setup()
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }))
    const form = screen.getByRole('form', { name: 'Add account' })
    await userEvent.type(within(form).getByLabelText('Name'), 'Rel')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByText('Config folder must be an absolute path')).toBeInTheDocument()
  })

  it('renders accountsError as an alert on the screen', () => {
    setup()
    act(() => useConsoleStore.setState({ accountsError: 'boom failure' }))
    expect(screen.getByRole('alert')).toHaveTextContent('boom failure')
  })

  it('Add account saves with name, kind, color and the default folder', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }))
    const form = screen.getByRole('form', { name: 'Add account' })
    await userEvent.type(within(form).getByLabelText('Name'), 'Side Gig')
    expect(within(form).getByLabelText('Config folder')).toHaveValue('~/.claude-side-gig')
    expect(within(form).getByText('Folder is created by Claude Code when you sign in.')).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Color #5ED3A8' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Personal' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(api.saveProfile).toHaveBeenCalledWith({
      name: 'Side Gig',
      color: '#5ED3A8',
      configDir: '~/.claude-side-gig',
      kind: 'personal'
    })
    expect(screen.queryByRole('form', { name: 'Add account' })).toBeNull()
  })

  it('validates name and hex color', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }))
    const form = screen.getByRole('form', { name: 'Add account' })
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(within(form).getByText('Name is required.')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Name'), 'x'.repeat(41))
    const hex = within(form).getByLabelText('Hex color')
    await userEvent.clear(hex)
    await userEvent.type(hex, '#12')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(within(form).getByText(/40 characters/)).toBeInTheDocument()
    expect(within(form).getByText('Color must look like #RRGGBB.')).toBeInTheDocument()
    expect(api.saveProfile).not.toHaveBeenCalled()
  })

  it('shows the reason inline when saving fails', async () => {
    api.saveProfile.mockResolvedValue({ ok: false, reason: 'duplicate-config-dir' })
    setup()
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }))
    const form = screen.getByRole('form', { name: 'Add account' })
    await userEvent.type(within(form).getByLabelText('Name'), 'Dup')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByText('duplicate-config-dir')).toBeInTheDocument()
  })

  it('Rename & color edits in place, keeps the folder read-only and sends the id', async () => {
    setup()
    await openMenu('Personal')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename & color' }))
    const form = screen.getByRole('form', { name: 'Rename and color' })
    expect(within(form).getByLabelText('Config folder')).toHaveAttribute('readonly')
    const name = within(form).getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Home')
    await userEvent.click(within(form).getByRole('radio', { name: 'Company' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(api.saveProfile).toHaveBeenCalledWith({
      id: 'personal',
      name: 'Home',
      color: '#F2A541',
      configDir: '~/.claude-personal',
      kind: 'company'
    })
  })

  it('Remove asks for confirmation first', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup()
    await openMenu('Personal')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove…' }))
    expect(api.removeProfile).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await openMenu('Personal')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove…' }))
    expect(api.removeProfile).toHaveBeenCalledWith('personal')
  })
})

describe('Folder rules', () => {
  const rows = () => screen.getAllByRole('row').slice(1)

  it('lists rules in order with a fixed Ask me row last and no actions on it', () => {
    setup()
    const r = rows()
    expect(r).toHaveLength(3)
    expect(r[0]).toHaveTextContent('~/work/acme/**')
    expect(r[1]).toHaveTextContent('~/code/personal/**')
    expect(r[2]).toHaveTextContent('Anything else')
    expect(r[2]).toHaveTextContent('Ask me')
    expect(r[2]).toHaveTextContent('Prompt when opening a new folder')
    expect(within(r[2]!).queryByRole('button')).toBeNull()
    expect(screen.getByText(/First match wins/)).toBeInTheDocument()
  })

  it('Add rule submits setRules with the new rule appended', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '+ Add rule' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(screen.getByText('Folder pattern is required.')).toBeInTheDocument()
    expect(api.setRules).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Folder pattern'), 'D:/code/*/client')
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'personal')
    await userEvent.type(screen.getByLabelText('Note'), 'clients')
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(api.setRules).toHaveBeenCalledWith([
      company,
      personal,
      { pattern: 'D:/code/*/client', accountId: 'personal', note: 'clients' }
    ])
    expect(rows()).toHaveLength(4)
    expect(rows()[3]).toHaveTextContent('Anything else')
  })

  it('Move up, Move down and Remove call setRules with the right order', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Move up ~/code/personal/**' }))
    expect(api.setRules).toHaveBeenLastCalledWith([personal, company])
    expect(rows()[0]).toHaveTextContent('~/code/personal/**')
    await userEvent.click(screen.getByRole('button', { name: 'Move down ~/code/personal/**' }))
    expect(api.setRules).toHaveBeenLastCalledWith([company, personal])
    await userEvent.click(screen.getByRole('button', { name: 'Remove ~/work/acme/**' }))
    expect(api.setRules).toHaveBeenLastCalledWith([personal])
  })

  it('disables Move up on the first and Move down on the last rule', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Move up ~/work/acme/**' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move down ~/code/personal/**' })).toBeDisabled()
  })
})

describe('Policies', () => {
  it('safety toggles call setSafety', async () => {
    setup()
    await userEvent.click(screen.getByRole('checkbox', { name: /Warn before the personal account/ }))
    expect(api.setSafety).toHaveBeenCalledWith({
      warnPersonalInCompanyFolder: false,
      showAccountColorEdge: true,
      lockAccountOnTeamStart: true
    })
  })

  it('limit policy radios call setLimitPolicy and show the switch note', async () => {
    setup()
    expect(screen.getByRole('radio', { name: /Pause the team/ })).toBeChecked()
    expect(
      screen.getByText(/Only for personal folders\. Applies once usage data is available\./)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Switch to the other account/ }))
    expect(api.setLimitPolicy).toHaveBeenCalledWith('switch')
    await userEvent.click(screen.getByRole('radio', { name: /Wait for the reset/ }))
    expect(api.setLimitPolicy).toHaveBeenLastCalledWith('wait')
  })
})

describe('T32 U14', () => {
  it('Detected logins collapse to one line when every login is already linked', async () => {
    patch((s) => {
      s.detected = [
        { configDir: '~/.claude', sources: ['vscode'], signedIn: true, linkedAccountId: 'company' },
        { configDir: '~/.claude-personal', sources: ['cli'], signedIn: true, linkedAccountId: 'personal' }
      ]
    })
    setup()
    expect(screen.getByText('2 logins found · all linked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeInTheDocument()
    expect(screen.queryByText('Found in: vscode')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText('Found in: vscode')).toBeInTheDocument()
  })

  it('an unlinked login keeps the full card', () => {
    patch((s) => {
      s.detected = [{ configDir: '~/.claude-new', sources: ['cli'], signedIn: true }]
    })
    setup()
    expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument()
  })

  it('Running now lists live sessions started elsewhere, labelled where they run', () => {
    patch((s) => {
      s.sessions = []
    })
    useConsoleStore.setState({
      sessions: [
        {
          sessionId: 'sess-1',
          accountId: 'company',
          configDir: 'C:/c',
          projectDir: 'p',
          cwd: 'C:/Users/u/acme',
          title: 'Fix the build',
          project: { key: 'c:/users/u/acme', name: 'acme', root: 'C:/Users/u/acme', git: true },
          mtimeMs: 1,
          sizeBytes: 1,
          live: true,
          entrypoint: 'claude-vscode'
        }
      ]
    })
    setup()
    expect(screen.getByText('Fix the build')).toBeInTheDocument()
    expect(screen.getByText(/in VS Code/)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing running/)).toBeNull()
  })

  it('the header is sticky so needs-you and Back never scroll away', () => {
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/screens/AccountsView.css'), 'utf8')
    expect(css).toMatch(/\.ac-acc-header \{ position: sticky; top: 0/)
  })
})

describe('Running now', () => {
  it('lists sessions with folder, account and agent count', () => {
    setup()
    expect(screen.getByText('~/work/acme/sheet-automation')).toBeInTheDocument()
    expect(screen.getByText('Company · 6 agents')).toBeInTheDocument()
    expect(screen.getByText('Personal · 1 agent')).toBeInTheDocument()
  })

  it('shows the empty state', () => {
    patch((s) => {
      s.sessions = []
    })
    setup()
    expect(screen.getByText(/Nothing running\. Start one with \+ New session in the Team view\./)).toBeInTheDocument()
  })
})

describe('FolderRules keyboard focus', () => {
  it('keeps focus on the moved row action after Move down', async () => {
    setup()
    const btn = screen.getByRole('button', { name: 'Move down ~/work/acme/**' })
    await userEvent.click(btn)
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Move (down|up) ~\/work\/acme\/\*\*$/)
  })
})
