// @vitest-environment jsdom
import './jestDom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockAccountsSnapshot } from '@shared/mock'
import { AccountsView } from '@renderer/screens/AccountsView'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'

const PRIVACY =
  'Agent Console reads only the email and organization name. Login tokens stay where Claude Code stored them.'

function setup() {
  useConsoleStore.getState().navigate('accounts')
  return render(<AccountsView />)
}

beforeEach(() => {
  resetConsoleStore()
  seedMockAccounts()
})

describe('R-12 / R-15 Accounts screen: static content', () => {
  it('renders the key texts', () => {
    const { container } = setup()
    expect(screen.getByRole('heading', { name: 'Claude accounts' })).toBeInTheDocument()
    expect(container).toHaveTextContent('Each account signs in once and keeps its own login in a separate config folder.')
    expect(screen.getByText('Detected logins')).toBeInTheDocument()
    expect(screen.getAllByText('~/.claude').length).toBeGreaterThan(0)
    expect(screen.getAllByText('~/.claude-personal').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(PRIVACY)).toBeInTheDocument()
    expect(screen.getAllByText('Company').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Personal').length).toBeGreaterThan(0)
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Pick the account by folder')).toBeInTheDocument()
    expect(screen.getByText('~/work/hicas/**')).toBeInTheDocument()
    expect(screen.getByText('Ask me')).toBeInTheDocument()
    expect(screen.getByText('Safety')).toBeInTheDocument()
    expect(container).toHaveTextContent('Pause the team and ask me')
    expect(screen.getByText('Running now')).toBeInTheDocument()
    expect(screen.getByText('sheet-export')).toBeInTheDocument()
    expect(container).toHaveTextContent(/Company\s*·\s*6 agents/)
    expect(container).toHaveTextContent(/Personal\s*·\s*1 agent(?!s)/)
  })

  it('shows detected logins info: email, org, warning for the unsigned folder and sources', () => {
    const { container } = setup()
    expect(container).toHaveTextContent('you@company.com · [COMPANY ORG]')
    expect(container).toHaveTextContent('Folder set in VS Code, not signed in yet')
    expect(container).toHaveTextContent('Found in: VS Code extension, Claude Code CLI (default folder)')
    expect(container).toHaveTextContent('Found in: .vscode/settings.json in ~/code/personal/revit-playground')
  })

  it('has the header buttons', () => {
    setup()
    expect(screen.getByRole('button', { name: /Team view/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Scan again/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add rule' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Rename & color' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Sign in again' })).toHaveLength(2)
  })

  it('shows no fake usage percentages (SPEC GAP, spec says do not fake limits)', () => {
    const { container } = setup()
    expect(container.textContent).not.toMatch(/\d+\s*%/)
    expect(container.querySelector('[role="progressbar"], progress, meter')).toBeNull()
  })

  it('hides Plan when unavailable and shows it when defined', () => {
    const { unmount } = setup()
    expect(screen.queryByText('Plan')).toBeNull()
    expect(screen.getAllByText('Status').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Config folder').length).toBeGreaterThan(0)
    unmount()

    const snap = structuredClone(mockAccountsSnapshot)
    snap.accounts[0]!.plan = 'Max 5x'
    useConsoleStore.getState().hydrateAccounts(snap)
    render(<AccountsView />)
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Max 5x')).toBeInTheDocument()
  })

  it('usage area: sign-in hint when not signed in, tokens today once linked', async () => {
    setup()
    expect(screen.getAllByText('Sign in from Detected logins above to see usage.')).toHaveLength(2)
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    expect(screen.getByText('Tokens used today')).toBeInTheDocument()
    expect(screen.getByText('1.12M')).toBeInTheDocument()
    expect(screen.getAllByText('Sign in from Detected logins above to see usage.')).toHaveLength(1)
  })

  it('folder rules are a real table with 3 rows', () => {
    setup()
    const table = screen.getByRole('table')
    for (const h of ['Folder pattern', 'Account', 'Note'])
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('anything else')).toBeInTheDocument()
    expect(within(table).getByText('Prompt when opening a new folder')).toBeInTheDocument()
  })
})

describe('R-12 / R-15 Accounts screen: interactions', () => {
  it('Use this links the detected login', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(screen.getByText('Linked as Company')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull()
  })

  it('sign-in flow: Sign in -> Check now -> Done', async () => {
    const { container } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Finish signing in your browser')).toBeInTheDocument()
    expect(container).toHaveTextContent('CLAUDE_CONFIG_DIR=~/.claude-personal claude')
    expect(container).toHaveTextContent('/login')
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    const steps = container.querySelectorAll('ol [aria-current="step"], ol[aria-current="step"], ol li[aria-current="step"]')
    expect(steps).toHaveLength(1)
    expect(container.querySelectorAll('ol li')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Open browser again' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(screen.getByText('Signed in as you@gmail.com')).toBeInTheDocument()
    expect(container).toHaveTextContent('Saved as “Personal”.')
    expect(container).toHaveTextContent('~/code/personal/')
    expect(screen.getByText('Linked as Personal')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Signed in as you@gmail.com')).toBeNull()
    expect(screen.queryByText('Finish signing in your browser')).toBeNull()
  })

  it('sign-in flow: Cancel closes the panel and resets the step', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Finish signing in your browser')).toBeNull()
    expect(useConsoleStore.getState().signIn.step).toBe('none')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('limit policy radiogroup selects Wait for the reset', async () => {
    setup()
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    const pause = screen.getByRole('radio', { name: /Pause the team and ask me/ })
    const wait = screen.getByRole('radio', { name: /Wait for the reset, then resume/ })
    expect(pause).toBeChecked()
    expect(wait).not.toBeChecked()
    await userEvent.click(wait)
    expect(wait).toBeChecked()
    expect(pause).not.toBeChecked()
    expect(useConsoleStore.getState().accounts.limitPolicy).toBe('wait')
  })

  it('limit policy radios: one Tab stop and arrow keys move the selection', async () => {
    setup()
    const pause = screen.getByRole('radio', { name: /Pause the team and ask me/ })
    const wait = screen.getByRole('radio', { name: /Wait for the reset, then resume/ })
    pause.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(wait).toBeChecked()
    expect(wait).toHaveFocus()
    expect(useConsoleStore.getState().accounts.limitPolicy).toBe('wait')
    await userEvent.keyboard('{ArrowUp}')
    expect(pause).toBeChecked()
    // only the checked radio is in the tab order
    const radios = screen.getAllByRole('radio')
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1)
    expect(new Set(radios.map((r) => (r as HTMLInputElement).name)).size).toBe(1)
  })

  it('Safety checkboxes are real and toggle the store', async () => {
    setup()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    for (const b of boxes) expect(b).toBeChecked()
    expect(useConsoleStore.getState().accounts.safety.warnPersonalInCompanyFolder).toBe(true)
    await userEvent.click(boxes[0]!)
    expect(useConsoleStore.getState().accounts.safety.warnPersonalInCompanyFolder).toBe(false)
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  })

  it('Set as default is disabled for the default account and works for the other', async () => {
    setup()
    const buttons = screen.getAllByRole('button', { name: 'Set as default' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toBeDisabled()
    expect(buttons[1]).toBeEnabled()
    await userEvent.click(buttons[1]!)
    expect(useConsoleStore.getState().accounts.defaultAccountId).toBe('personal')
  })

  it('the Team view back link navigates to the team screen (R-13)', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /Team view/ }))
    expect(useConsoleStore.getState().screen).toBe('team')
  })
})
