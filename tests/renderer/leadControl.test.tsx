// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import './jestDom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { mockTeamSnapshot } from '@shared/mock'
import type {
  ControlSessionInfo,
  ControlStartResult,
  OkResult,
  PermissionPrompt,
  SessionSummary,
  TeamSnapshot
} from '@shared/types'

const SID = 'abcdef123456'

const control = vi.hoisted(() => ({
  start: vi.fn(),
  send: vi.fn(),
  answer: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn(),
  setModel: vi.fn(),
  setMode: vi.fn()
}))
const app = vi.hoisted(() => ({ pickFolder: vi.fn(), getDefaultCwd: vi.fn() }))

function installApi(): void {
  const ok: OkResult = { ok: true }
  control.start.mockResolvedValue({ ok: true, controlId: 'c1' } satisfies ControlStartResult)
  for (const f of [control.send, control.answer, control.interrupt, control.stop, control.setModel, control.setMode])
    f.mockResolvedValue(ok)
  app.pickFolder.mockResolvedValue('D:/picked')
  app.getDefaultCwd.mockResolvedValue('D:/default')
  ;(window as unknown as { api: unknown }).api = {
    control: { ...control, list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(), onStream: vi.fn() },
    app,
    accounts: { resolveFolder: vi.fn().mockResolvedValue({ accountId: 'ask', ruleIndex: -1 }) },
    agent: { sendMessage: vi.fn() }
  }
}

function snap(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  const base = structuredClone(mockTeamSnapshot)
  return {
    ...base,
    source: 'live',
    repo: 'alpha',
    teamName: 'lead-session',
    sessionId: SID,
    cwd: 'D:/work/alpha',
    worktrees: [],
    tasks: [],
    overlaps: [],
    console: [
      { time: '10:00:01', who: 'you', text: 'hello there' },
      { time: '10:00:02', who: 'lead', text: 'Bash npm test' },
      { time: '10:00:03', who: 'lead', text: 'Read D:/work/alpha/src/app.ts' },
      { time: '10:00:04', who: 'lead', text: 'API error: overloaded' },
      { time: '10:00:05', who: 'lead', text: 'all green' }
    ],
    ...over
  }
}

function seedTeam(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  const t = snap(over)
  useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live', selectedAgentId: 'lead' })
  return t
}

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: SID,
  accountId: 'acc1',
  configDir: 'C:/c',
  projectDir: 'p',
  cwd: 'D:/work/alpha',
  project: { key: 'd:/work/alpha', name: 'alpha', root: 'D:/work/alpha', git: true },
  mtimeMs: 1,
  sizeBytes: 1,
  ...over
})

function ctl(over: Partial<ControlSessionInfo> = {}): ControlSessionInfo {
  return {
    id: 'c1',
    accountId: 'acc1',
    cwd: 'D:/work/alpha',
    state: 'idle',
    permissionMode: 'default',
    sessionId: SID,
    slashCommands: ['/compact', '/clear', '/cost'],
    pendingPermissions: 0,
    queuedTurns: 0,
    ...over
  }
}

const perm = (over: Partial<PermissionPrompt> = {}): PermissionPrompt => ({
  requestId: 'r1',
  toolName: 'Bash',
  displayName: 'Bash',
  inputPreview: 'rm -rf build',
  decisionReason: 'Not in the allow list',
  receivedAt: '2026-11-19T10:00:00Z',
  canAllowSession: true,
  ...over
})

function setControl(c: ControlSessionInfo): void {
  useControlStore.setState({ sessions: [c] })
}

beforeEach(() => {
  resetConsoleStore()
  window.localStorage.clear()
  useControlStore.setState({ sessions: [], streams: {}, startForm: { open: false }, error: undefined })
  Object.values(control).forEach((f) => f.mockReset())
  Object.values(app).forEach((f) => f.mockReset())
  installApi()
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

const prompt = (): HTMLInputElement => screen.getByRole('textbox', { name: 'Message the lead' }) as HTMLInputElement

describe('R-19 nothing is sent without a user action', () => {
  it('a draft control does not call send or start on mount, and the placeholder invites the first message', () => {
    seedTeam({ sessionId: undefined })
    setControl(ctl({ state: 'draft', sessionId: undefined, slashCommands: [] }))
    render(<LeadConsole />)
    expect(prompt()).toBeEnabled()
    expect(prompt()).toHaveAttribute('placeholder', 'Type the first message to start Claude')
    expect(control.send).not.toHaveBeenCalled()
    expect(control.start).not.toHaveBeenCalled()
  })

  it('the start form calls start only on the button and never sends a prompt', async () => {
    seedTeam({ sessionId: undefined })
    useControlStore.getState().openStartForm({ cwd: 'D:/work/alpha', accountId: 'acc1' })
    render(<LeadConsole />)
    expect(control.start).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(control.start).toHaveBeenCalledTimes(1)
    expect(control.start).toHaveBeenCalledWith({ cwd: 'D:/work/alpha', accountId: 'acc1', permissionMode: 'default' })
    expect(control.send).not.toHaveBeenCalled()
    expect(useControlStore.getState().startForm.open).toBe(false)
  })

  it('Ask lead to start a teammate only prefills the prompt', async () => {
    seedTeam()
    setControl(ctl())
    render(<LeadConsole />)
    await userEvent.click(screen.getByRole('button', { name: 'More session actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ask lead to start a teammate' }))
    expect(prompt().value).toBe('Start a teammate with the Agent tool (name: "", task: )')
    expect(control.send).not.toHaveBeenCalled()
  })
})

describe('controlled prompt', () => {
  it('first Enter calls send once with the routed text and clears the draft', async () => {
    seedTeam()
    setControl(ctl())
    render(<LeadConsole />)
    await userEvent.type(prompt(), 'run the tests{Enter}')
    expect(control.send).toHaveBeenCalledTimes(1)
    expect(control.send).toHaveBeenCalledWith('c1', 'run the tests')
    await waitFor(() => expect(prompt().value).toBe(''))
  })

  it('@name is formatted as a message to that agent', async () => {
    const t = seedTeam()
    const name = t.agents[1]!.name
    setControl(ctl())
    render(<LeadConsole />)
    await userEvent.type(prompt(), `@${name} please review{Enter}`)
    expect(control.send).toHaveBeenCalledTimes(1)
    const text = control.send.mock.calls[0]![1] as string
    expect(text.startsWith(`@${name}: please review`)).toBe(true)
    expect(text).toContain(`forward this to the agent "${name}" with SendMessage`)
  })

  it('an unknown @agent shows an inline error and sends nothing', async () => {
    seedTeam()
    setControl(ctl())
    render(<LeadConsole />)
    await userEvent.type(prompt(), '@nobody-here hi{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('No teammate with that name')
    expect(control.send).not.toHaveBeenCalled()
    expect(prompt().value).toBe('@nobody-here hi')
  })

  it('a failed send keeps the draft and shows the reason', async () => {
    seedTeam()
    setControl(ctl())
    control.send.mockResolvedValue({ ok: false, reason: 'not-running' })
    render(<LeadConsole />)
    await userEvent.type(prompt(), 'hello{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('That session is not running any more')
    expect(prompt().value).toBe('hello')
  })

  it('slash autocomplete: filter by prefix, arrows move, Tab completes, Esc closes', async () => {
    seedTeam()
    setControl(ctl())
    render(<LeadConsole />)
    await userEvent.type(prompt(), '/c')
    const list = screen.getByRole('listbox', { name: 'Slash commands' })
    const names = (): (string | null | undefined)[] =>
      within(list).getAllByRole('option').map((o) => o.querySelector('.ac-pop__name')?.textContent)
    // The session's names plus the built-in fallback (with descriptions), grouped under "Built-in".
    expect(names()).toEqual(['/clear', '/compact', '/cost', '/context', '/mcp'])
    await userEvent.type(prompt(), 'o')
    expect(names()).toEqual(['/compact', '/cost', '/context'])
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: /^\/cost/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { name: /^\/compact/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Tab}')
    expect(prompt().value).toBe('/compact ')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(control.send).not.toHaveBeenCalled()

    await userEvent.clear(prompt())
    await userEvent.type(prompt(), '/')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('before the first send the static list is shown with a note', async () => {
    seedTeam({ sessionId: undefined })
    setControl(ctl({ state: 'draft', sessionId: undefined, slashCommands: [] }))
    render(<LeadConsole />)
    await userEvent.type(prompt(), '/')
    expect(screen.getByRole('option', { name: /^\/help/ })).toBeInTheDocument()
    expect(screen.getByText('full list after the session starts')).toBeInTheDocument()
  })
})

describe('external and ended sessions', () => {
  it('a live session in VS Code disables the prompt and offers only Fork here', () => {
    seedTeam()
    useConsoleStore.setState({ sessions: [summary({ live: true, entrypoint: 'claude-vscode' })] })
    render(<LeadConsole />)
    // T32 U7: no composer for a session Agent Console cannot control: one line and one primary action.
    expect(screen.queryByRole('textbox', { name: 'Message the lead' })).toBeNull()
    expect(screen.getByText("Runs in VS Code. Agent Console can't type into it.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fork here' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume here' })).toBeNull()
    expect(control.send).not.toHaveBeenCalled()
  })

  it('a terminal session says so; a non-live session also offers Resume here', () => {
    seedTeam()
    useConsoleStore.setState({ sessions: [summary({ live: true, entrypoint: 'cli' })] })
    const { unmount } = render(<LeadConsole />)
    expect(screen.getByText(/Runs in a terminal/)).toBeInTheDocument()
    unmount()
    useConsoleStore.setState({ sessions: [summary()] })
    render(<LeadConsole />)
    expect(screen.getByRole('button', { name: 'Fork here' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume here' })).toBeInTheDocument()
  })

  it('Fork here opens the start form with Fork selected and starts nothing until confirmed', async () => {
    seedTeam()
    useConsoleStore.setState({ sessions: [summary()] })
    render(<LeadConsole />)
    await userEvent.click(screen.getByRole('button', { name: 'Fork here' }))
    expect(screen.getByRole('radio', { name: 'Fork selected session' })).toBeChecked()
    expect(control.start).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(control.start).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: 'D:/work/alpha',
        accountId: 'acc1',
        resume: { kind: 'resume', sessionId: SID, fork: true }
      })
    )
  })

  it('an exited control shows the Start a session button', () => {
    seedTeam()
    setControl(ctl({ state: 'exited' }))
    render(<LeadConsole />)
    expect(prompt()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start a session' })).toBeInTheDocument()
  })
})

describe('start form', () => {
  it('needs-confirmation warns and Start anyway retries with confirmed', async () => {
    seedTeam({ sessionId: undefined })
    control.start.mockResolvedValueOnce({
      ok: false,
      reason: 'needs-confirmation',
      warnings: ['personal-in-company-folder']
    })
    useControlStore.getState().openStartForm({ cwd: 'D:/work/alpha', accountId: 'acc1' })
    render(<LeadConsole />)
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(await screen.findByRole('button', { name: 'Start anyway' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
    expect(control.start).toHaveBeenCalledTimes(2)
    expect(control.start.mock.calls[1]![0]).toMatchObject({ confirmed: true })
    expect(control.send).not.toHaveBeenCalled()
  })

  it('session-live-elsewhere suggests Fork', async () => {
    seedTeam({ sessionId: undefined })
    control.start.mockResolvedValueOnce({ ok: false, reason: 'session-live-elsewhere' })
    useControlStore.getState().openStartForm({ cwd: 'D:/work/alpha', accountId: 'acc1' })
    render(<LeadConsole />)
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fork it instead')
  })

  it('offers no bypassPermissions and validates a custom model', async () => {
    seedTeam({ sessionId: undefined })
    useControlStore.getState().openStartForm({ cwd: 'D:/work/alpha', accountId: 'acc1' })
    render(<LeadConsole />)
    const modes = within(screen.getByLabelText('Mode')).getAllByRole('option').map((o) => o.textContent)
    expect(modes).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'])
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'Custom…')
    const custom = screen.getByLabelText('Custom model name')
    await userEvent.type(custom, 'bad name!')
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled()
    await userEvent.clear(custom)
    await userEvent.type(custom, 'claude-x.1')
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'plan')
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(control.start).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-x.1', permissionMode: 'plan' }))
  })

  it('an "ask" folder needs an account pick before Start is enabled', async () => {
    useConsoleStore.setState({
      accounts: { ...useConsoleStore.getState().accounts, accounts: [{ id: 'a9', name: 'Work', color: '#fff' } as never] }
    })
    seedTeam({ sessionId: undefined })
    useControlStore.getState().openStartForm({ cwd: 'D:/work/alpha' })
    render(<LeadConsole />)
    const select = await screen.findByLabelText('Account')
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled()
    await userEvent.selectOptions(select, 'a9')
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(control.start).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'a9' }))
  })
})

describe('control bar', () => {
  it('Interrupt shows only while busy, with the project name and the shortcut', async () => {
    seedTeam()
    setControl(ctl({ state: 'idle' }))
    render(<LeadConsole />)
    expect(screen.queryByRole('button', { name: /Interrupt lead/ })).toBeNull()
    act(() => setControl(ctl({ state: 'busy', queuedTurns: 2 })))
    const b = screen.getByRole('button', { name: 'Interrupt lead (alpha)' })
    expect(b).toHaveAttribute('aria-keyshortcuts', 'Control+.')
    expect(screen.getByRole('status')).toHaveTextContent('Working · 2 queued')
    await userEvent.click(b)
    expect(control.interrupt).toHaveBeenCalledWith('c1')
  })

  it('Stop, model and mode call the store actions', async () => {
    seedTeam()
    setControl(ctl())
    render(<LeadConsole />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'sonnet')
    expect(control.setModel).toHaveBeenCalledWith('c1', 'sonnet')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Permission mode' }), 'acceptEdits')
    expect(control.setMode).toHaveBeenCalledWith('c1', 'acceptEdits')
    // T37: idle, Stop lives in the more menu as "Stop process"; the red Stop button shows only while busy
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More session actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop process' }))
    expect(control.stop).toHaveBeenCalledWith('c1')
  })
})

describe('permission cards', () => {
  it('Allow, Allow for this session and Deny call answer; Shift+click Deny sends a message', async () => {
    seedTeam()
    setControl(ctl({ state: 'busy' }))
    useControlStore.getState().applyStream([
      { controlId: 'c1', kind: 'permission', prompt: perm() },
      { controlId: 'c1', kind: 'permission', prompt: perm({ requestId: 'r2', displayName: 'Edit' }) }
    ])
    render(<LeadConsole />)
    const cards = screen.getAllByRole('alertdialog')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveAccessibleName('Bash wants to run')
    expect(within(cards[0]!).getByText('rm -rf build')).toBeInTheDocument()
    expect(within(cards[0]!).getByText('Not in the allow list')).toBeInTheDocument()
    expect(control.answer).not.toHaveBeenCalled()

    await userEvent.click(within(cards[0]!).getByRole('button', { name: 'Allow' }))
    expect(control.answer).toHaveBeenLastCalledWith('c1', 'r1', { behavior: 'allow', scope: 'once' })
    await userEvent.click(within(cards[0]!).getByRole('button', { name: 'Allow for this session' }))
    expect(control.answer).toHaveBeenLastCalledWith('c1', 'r1', { behavior: 'allow', scope: 'session' })
    await userEvent.click(within(cards[1]!).getByRole('button', { name: 'Deny' }))
    expect(control.answer).toHaveBeenLastCalledWith('c1', 'r2', { behavior: 'deny' })

    fireEvent.click(within(cards[0]!).getByRole('button', { name: 'Deny' }), { shiftKey: true })
    await userEvent.type(screen.getByLabelText('Reason for denying'), 'too risky')
    await userEvent.click(screen.getByRole('button', { name: 'Send deny' }))
    expect(control.answer).toHaveBeenLastCalledWith('c1', 'r1', { behavior: 'deny', message: 'too risky' })
  })

  it('long previews are clipped to 12 lines with show more', async () => {
    seedTeam()
    setControl(ctl({ state: 'busy' }))
    const preview = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    useControlStore
      .getState()
      .applyStream([{ controlId: 'c1', kind: 'permission', prompt: perm({ inputPreview: preview }) }])
    render(<LeadConsole />)
    expect(screen.queryByText(/line 13/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /show more/ }))
    expect(screen.getByText(/line 20/)).toBeInTheDocument()
  })

  it('Allow for this session is hidden when the prompt cannot offer it', () => {
    seedTeam()
    setControl(ctl({ state: 'busy' }))
    useControlStore
      .getState()
      .applyStream([{ controlId: 'c1', kind: 'permission', prompt: perm({ canAllowSession: false }) }])
    render(<LeadConsole />)
    expect(screen.queryByRole('button', { name: 'Allow for this session' })).toBeNull()
  })
})

describe('typing row and notices', () => {
  it('shows the typing row while streaming and removes it on clear', () => {
    seedTeam()
    setControl(ctl({ state: 'busy' }))
    render(<LeadConsole />)
    expect(screen.queryByTestId('typing-row')).toBeNull()
    act(() =>
      useControlStore.getState().applyStream([{ controlId: 'c1', kind: 'typing', messageId: 'm1', text: 'Working on it' }])
    )
    const row = screen.getByTestId('typing-row')
    expect(row).toHaveTextContent('Working on it')
    expect(within(row).getByText('typing')).toHaveAttribute('aria-live', 'polite')
    act(() => useControlStore.getState().applyStream([{ controlId: 'c1', kind: 'typing-clear' }]))
    expect(screen.queryByTestId('typing-row')).toBeNull()
  })

  it('shows thinking... when thinking without text, and error notices', () => {
    seedTeam()
    setControl(ctl({ state: 'busy' }))
    render(<LeadConsole />)
    act(() =>
      useControlStore.getState().applyStream([
        { controlId: 'c1', kind: 'thinking', active: true },
        { controlId: 'c1', kind: 'notice', level: 'error', text: 'rate limited' }
      ])
    )
    expect(screen.getByText('thinking...')).toBeInTheDocument()
    expect(screen.getByText('rate limited')).toBeInTheDocument()
  })
})

describe('S4 filter chips and paths', () => {
  it('defaults to Messages & asks, hides tool lines, and the chips switch the view', async () => {
    seedTeam()
    render(<LeadConsole />)
    expect(screen.getByRole('button', { name: 'Messages & asks' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.getByText('all green')).toBeInTheDocument()
    expect(screen.getByText('API error: overloaded')).toBeInTheDocument()
    expect(screen.queryByText('Bash npm test')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.getByText('Bash npm test')).toBeInTheDocument()
    expect(screen.queryByText('hello there')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Errors' }))
    expect(screen.getByText('API error: overloaded')).toBeInTheDocument()
    expect(screen.queryByText('Bash npm test')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Bash npm test')).toBeInTheDocument()
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })

  it('reports filter changes and honours a controlled filter', async () => {
    seedTeam()
    const onChange = vi.fn()
    render(<LeadConsole filter="tools" onFilterChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('shortens paths under the project root, keeps the full text in title, and expands on click', async () => {
    seedTeam()
    render(<LeadConsole defaultFilter="all" />)
    const line = screen.getByText('Read src/app.ts')
    expect(line).toHaveAttribute('title', 'Read D:/work/alpha/src/app.ts')
    expect(line).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(line)
    expect(line).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Responsive: narrow width', () => {
  it('keeps every control reachable at 600px and the stylesheet wraps and stacks them', () => {
    const prev = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    seedTeam()
    setControl(ctl({ state: 'busy' }))
    useControlStore.getState().applyStream([{ controlId: 'c1', kind: 'permission', prompt: perm() }])
    useControlStore.getState().openStartForm({ cwd: 'D:/work/alpha', accountId: 'acc1' })
    render(<LeadConsole />)
    for (const n of ['Interrupt lead (alpha)', 'Stop', 'Allow', 'Deny', 'Start session']) {
      expect(screen.getByRole('button', { name: n })).toBeVisible()
    }
    expect(prompt()).toBeEnabled()
    expect(screen.getByRole('group', { name: 'Console filter' })).toBeInTheDocument()
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/components/team/teamCenter.css'), 'utf8')
    expect(css).toMatch(/\.ac-tc-ctl__row \{[^}]*flex-wrap: wrap/)
    expect(css).toMatch(/\.ac-tc-chips \{[^}]*flex-wrap: wrap/)
    expect(css).toMatch(/\.ac-tc-perm__actions \{[^}]*flex-wrap: wrap/)
    expect(css).toMatch(/@media \(max-width: 899px\)[\s\S]*\.ac-tc-ctl__row/)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: prev })
  })
})
