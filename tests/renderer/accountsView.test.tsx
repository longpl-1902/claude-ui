// @vitest-environment jsdom
import './jestDom'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAccountsSnapshot } from '@shared/mock'
import type { AccountsSnapshot, DetectedLogin, SignInStatus } from '@shared/types'
import { AccountsView } from '@renderer/screens/AccountsView'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'

vi.mock('@renderer/components/terminal/TerminalView', () => ({
  TerminalView: ({ ptyId, ariaLabel }: { ptyId: string; ariaLabel?: string }) => (
    <div data-testid="term" aria-label={ariaLabel}>
      {ptyId}
    </div>
  )
}))

const PRIVACY =
  'Agent Console reads only the email and organization name. Login tokens stay where Claude Code stored them.'
const PERSONAL = '~/.claude-personal'

const api = {
  scan: vi.fn(),
  linkDetected: vi.fn(),
  startSignIn: vi.fn(),
  checkSignIn: vi.fn(),
  reopenSignIn: vi.fn(),
  cancelSignIn: vi.fn()
}

function setup() {
  useConsoleStore.getState().navigate('accounts')
  return render(<AccountsView />)
}

function seedDetected(detected: DetectedLogin[]): void {
  const snap: AccountsSnapshot = { ...structuredClone(mockAccountsSnapshot), detected }
  useConsoleStore.getState().hydrateAccounts(snap)
}

const push = (s: SignInStatus) => act(() => useConsoleStore.getState().applySignInStatus(s))

beforeEach(() => {
  resetConsoleStore()
  seedMockAccounts()
  for (const f of Object.values(api)) f.mockReset()
  api.scan.mockResolvedValue(structuredClone(mockAccountsSnapshot))
  api.linkDetected.mockResolvedValue({ ok: true, id: 'company' })
  api.startSignIn.mockResolvedValue({ ok: true })
  api.checkSignIn.mockResolvedValue({ configDir: PERSONAL, step: 'waiting' })
  api.reopenSignIn.mockResolvedValue({ ok: true })
  api.cancelSignIn.mockResolvedValue({ ok: true })
  ;(window as unknown as { api?: unknown }).api = { accounts: api }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('Accounts screen: static content', () => {
  it('renders headings, privacy line and Scan again', () => {
    const { container } = setup()
    expect(screen.getByRole('heading', { name: 'Claude accounts' })).toBeInTheDocument()
    expect(container).toHaveTextContent('Each account signs in once and keeps its own login in a separate config folder.')
    expect(screen.getByText('Detected logins')).toBeInTheDocument()
    expect(screen.getByText(PRIVACY)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Scan again/ })).toBeInTheDocument()
  })
})

describe('Detected logins', () => {
  it('shows email · org, sources and Use this / Sign in actions', () => {
    const { container } = setup()
    expect(container).toHaveTextContent('you@company.com · [COMPANY ORG]')
    expect(container).toHaveTextContent('Found in: VS Code extension, Claude Code CLI (default folder)')
    expect(container).toHaveTextContent('Found in: .vscode/settings.json in ~/code/personal/revit-playground')
    expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows just the email when there is no org', () => {
    seedDetected([{ configDir: '~/.claude', email: 'a@b.com', sources: ['x'], signedIn: true }])
    const { container } = setup()
    expect(container).toHaveTextContent('a@b.com')
    expect(container).not.toHaveTextContent('a@b.com ·')
  })

  it('distinguishes not-created from not-signed-in and shows warning notes', () => {
    seedDetected([
      {
        configDir: '~/w1',
        sources: ['workspace'],
        signedIn: false,
        exists: false,
        warnings: ['VS Code ignores this machine-scoped setting in a workspace.']
      },
      { configDir: '~/w2', sources: ['CLI'], signedIn: false, exists: true }
    ])
    const { container } = setup()
    expect(container).toHaveTextContent('Folder set but not created yet')
    expect(container).toHaveTextContent('Not signed in yet')
    expect(screen.getByRole('note')).toHaveTextContent('VS Code ignores this machine-scoped setting')
  })

  it('shows the linked pill when a profile is linked', () => {
    const snap = structuredClone(mockAccountsSnapshot)
    snap.detected[0]!.linkedAccountId = 'company'
    useConsoleStore.getState().hydrateAccounts(snap)
    setup()
    expect(screen.getByText('Linked as Company')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull()
  })

  it('shows the loading and empty states', () => {
    resetConsoleStore()
    const { unmount } = setup()
    expect(screen.getByText('Looking for Claude config folders…')).toBeInTheDocument()
    unmount()
    seedDetected([])
    setup()
    expect(screen.getByText(/No Claude config folders found/)).toBeInTheDocument()
  })

  it('Scan again calls the api and is busy until it resolves', async () => {
    let resolve!: (v: AccountsSnapshot) => void
    api.scan.mockReturnValue(new Promise<AccountsSnapshot>((r) => (resolve = r)))
    setup()
    await userEvent.click(screen.getByRole('button', { name: /Scan again/ }))
    expect(api.scan).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Scanning/ })).toBeDisabled()
    await act(async () => resolve(structuredClone(mockAccountsSnapshot)))
    expect(screen.getByRole('button', { name: /Scan again/ })).toBeEnabled()
  })

  it('Use this calls linkDetected with the dir', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(api.linkDetected).toHaveBeenCalledWith({ configDir: '~/.claude' })
  })
})

describe('Sign-in panel', () => {
  async function openPanel() {
    const view = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    return view
  }

  it('Sign in opens the waiting panel with 3 steps and the command', async () => {
    const { container } = await openPanel()
    expect(api.startSignIn).toHaveBeenCalledWith(PERSONAL)
    expect(screen.getByText('Finish signing in your browser')).toBeInTheDocument()
    expect(container).toHaveTextContent(`CLAUDE_CONFIG_DIR=${PERSONAL} claude auth login`)
    expect(container.querySelectorAll('ol li')).toHaveLength(3)
    expect(container.querySelectorAll('ol li[aria-current="step"]')).toHaveLength(1)
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('uses the bare command for the default dir', async () => {
    seedDetected([{ configDir: '~/.claude', sources: ['CLI'], signedIn: false, isDefaultDir: true }])
    const { container } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(container.querySelector('.ac-acc-cmd')?.textContent).toBe('claude auth login')
  })

  it('Check now, Open browser again and Cancel call the api', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(api.checkSignIn).toHaveBeenCalledWith(PERSONAL)
    await userEvent.click(screen.getByRole('button', { name: 'Open browser again' }))
    expect(api.reopenSignIn).toHaveBeenCalledWith(PERSONAL)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.cancelSignIn).toHaveBeenCalledWith(PERSONAL)
    expect(screen.queryByText('Finish signing in your browser')).toBeNull()
    expect(useConsoleStore.getState().signIn.step).toBe('none')
  })

  it('a done push shows the signed-in view, Use this and Done', async () => {
    const { container } = await openPanel()
    const unlinked = structuredClone(mockAccountsSnapshot)
    unlinked.accounts = unlinked.accounts.filter((a) => a.configDir !== PERSONAL)
    act(() => useConsoleStore.getState().hydrateAccounts(unlinked))
    push({ configDir: PERSONAL, step: 'done', email: 'you@gmail.com' })
    expect(screen.getByText('Signed in as you@gmail.com')).toBeInTheDocument()
    expect(screen.queryByText('Finish signing in your browser')).toBeNull()
    expect(container.querySelectorAll('ol li')).toHaveLength(3)
    const useBtns = screen.getAllByRole('button', { name: 'Use this' })
    await userEvent.click(useBtns[useBtns.length - 1]!)
    expect(api.linkDetected).toHaveBeenCalledWith({ configDir: PERSONAL })
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Signed in as you@gmail.com')).toBeNull()
  })

  it('shows Saved as for an account matched by configDir even when not detected', async () => {
    await openPanel()
    const snap = structuredClone(mockAccountsSnapshot)
    snap.detected = []
    act(() => useConsoleStore.getState().hydrateAccounts(snap))
    push({ configDir: PERSONAL, step: 'done', email: 'you@gmail.com' })
    expect(screen.getByText(/Saved as/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull()
  })

  it('keeps aria-live off the whole panel (terminal stays outside any live region)', async () => {
    const { container } = await openPanel()
    expect(container.querySelector('.ac-acc-flow')).not.toHaveAttribute('aria-live')
    expect(container.querySelector('.ac-acc-flow [aria-live="polite"]')).not.toBeNull()
  })

  it('a done push for a linked dir shows Saved as the profile name', async () => {
    await openPanel()
    const snap = structuredClone(mockAccountsSnapshot)
    snap.detected[1]!.linkedAccountId = 'personal'
    snap.detected[1]!.signedIn = true
    snap.detected[1]!.email = 'you@gmail.com'
    act(() => useConsoleStore.getState().hydrateAccounts(snap))
    push({ configDir: PERSONAL, step: 'done', email: 'you@gmail.com' })
    expect(screen.getByText('Saved as “Personal”.')).toBeInTheDocument()
  })

  it.each([
    ['login-exited', 'The sign-in process ended before finishing.'],
    ['pty-unavailable', 'Terminal support (node-pty) is not available.'],
    ['claude-not-found', 'Could not find the claude CLI.'],
    ['boom', 'Sign-in failed (boom).']
  ])('error reason %s shows its message', async (reason, text) => {
    await openPanel()
    push({ configDir: PERSONAL, step: 'error', reason })
    expect(screen.getByText(text)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(api.reopenSignIn).toHaveBeenCalledWith(PERSONAL)
  })

  it('an error returned by startSignIn shows in the panel', async () => {
    api.startSignIn.mockResolvedValue({ ok: false, reason: 'claude-not-found' })
    await openPanel()
    expect(await screen.findByText('Could not find the claude CLI.')).toBeInTheDocument()
  })

  it('the terminal toggle is disabled without a ptyId and embeds TerminalView with one', async () => {
    await openPanel()
    expect(screen.getByRole('button', { name: 'Show terminal' })).toBeDisabled()
    push({ configDir: PERSONAL, step: 'waiting', ptyId: 'pty-7' })
    expect(screen.getByRole('button', { name: 'Show terminal' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Show terminal' }))
    expect(screen.getByTestId('term')).toHaveTextContent('pty-7')
    expect(screen.getByLabelText('Sign-in terminal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide terminal' }))
    expect(screen.queryByTestId('term')).toBeNull()
  })
})
