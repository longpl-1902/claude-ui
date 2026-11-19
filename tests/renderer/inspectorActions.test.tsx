// @vitest-environment jsdom
import './jestDom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '@renderer/components/inspector/Inspector'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { formatAgentMessage } from '@shared/agentMessage'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import type { Agent, ControlSessionInfo, SessionSummary, TeamSnapshot } from '@shared/types'
import { seedMockAccounts } from './seedAccounts'
import { seedDemoTeam } from './seedTeam'

const SID = 'sess-1'
const ROOT = 'D:/work/alpha'

const control = vi.hoisted(() => ({ send: vi.fn(), interrupt: vi.fn(), stop: vi.fn() }))
const killExternal = vi.hoisted(() => vi.fn())
const resolveFolder = vi.hoisted(() => vi.fn())

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}

function installApi(): void {
  for (const f of [control.send, control.interrupt, control.stop]) f.mockResolvedValue({ ok: true })
  killExternal.mockResolvedValue({ ok: true })
  resolveFolder.mockResolvedValue({ accountId: 'personal', ruleIndex: 0 })
  ;(window as unknown as { api: unknown }).api = {
    control: { ...control, list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(), onStream: vi.fn() },
    session: { killExternal },
    accounts: { resolveFolder },
    worktree: { openInEditor: vi.fn().mockResolvedValue({ ok: true }) },
    agent: { pause: vi.fn(), stop: vi.fn() },
    team: { pauseAll: vi.fn() }
  }
}

function agent(id: string, name: string, kind: 'lead' | 'teammate'): Agent {
  const base = structuredClone(mockTeamSnapshot.agents[0]!)
  return {
    ...base,
    id,
    name,
    worktree: '',
    cwd: ROOT,
    runtime: { kind, startedMs: 0, lastActivityMs: 0, openTools: [], lastTurn: 'assistant_end' }
  } as Agent
}

function seedLive(over: Partial<TeamSnapshot> = {}, selected = 'lead'): void {
  const team: TeamSnapshot = {
    ...structuredClone(mockTeamSnapshot),
    source: 'live',
    repo: 'alpha',
    teamName: 'Fix the build',
    accountId: 'company',
    sessionId: SID,
    cwd: ROOT,
    worktrees: [],
    tasks: [],
    overlaps: [],
    agents: [agent('lead', 'lead', 'lead'), agent('scout', 'scout', 'teammate')],
    ...over
  }
  useConsoleStore.setState({ team, liveTeam: team, teamMode: 'live', selectedAgentId: selected })
}

function seedSessions(over: Partial<SessionSummary> = {}): void {
  const s: SessionSummary = {
    sessionId: SID,
    accountId: 'company',
    configDir: 'C:/c',
    projectDir: 'p',
    cwd: ROOT,
    title: 'Fix the build',
    project: { key: 'd:/work/alpha', name: 'alpha', root: ROOT, git: true },
    mtimeMs: 1,
    sizeBytes: 1,
    ...over
  }
  useConsoleStore.setState({ sessions: [s], projectKey: 'd:/work/alpha' })
}

function ctl(over: Partial<ControlSessionInfo> = {}): ControlSessionInfo {
  return {
    id: 'c1',
    accountId: 'company',
    cwd: ROOT,
    state: 'idle',
    permissionMode: 'default',
    sessionId: SID,
    slashCommands: [],
    pendingPermissions: 0,
    queuedTurns: 0,
    ...over
  }
}

beforeEach(() => {
  setWidth(1440)
  resetConsoleStore()
  seedMockAccounts()
  useControlStore.setState({ sessions: [], streams: {}, startForm: { open: false }, error: undefined })
  Object.values(control).forEach((f) => f.mockReset())
  killExternal.mockReset()
  resolveFolder.mockReset()
  installApi()
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

const btn = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name })

describe('UX M4 viewed-session account', () => {
  it('a personal-account session shows the personal colour while the default account is the company one', () => {
    expect(mockAccountsSnapshot.defaultAccountId).toBe('company')
    seedLive({ accountId: 'personal' })
    render(<TeamHeader />)
    expect(btn(/Account: Personal/)).toHaveTextContent('Personal')
    const style = (document.querySelector('header')!.getAttribute('style') ?? '').toLowerCase()
    expect(style).toMatch(/#f2a541|rgb\(\s*242,\s*165,\s*65\s*\)/)
    expect(style).toMatch(/3px/)
    expect(style).not.toMatch(/#6e9bf0|rgb\(\s*110,\s*155,\s*240\s*\)/)
  })

  it('an unlinked default-dir session (accountId empty) never shows a stranger account colour', () => {
    seedLive({ accountId: '' })
    render(<TeamHeader />)
    const style = (document.querySelector('header')!.getAttribute('style') ?? '').toLowerCase()
    expect(style).not.toMatch(/#f2a541|rgb\(\s*242,\s*165,\s*65\s*\)/)
    expect(btn(/Manage accounts/)).toBeInTheDocument()
  })

  it('demo keeps the active account', () => {
    seedDemoTeam()
    render(<TeamHeader />)
    expect(btn(/Account: Company/)).toBeInTheDocument()
  })
})

describe('inspector action matrix', () => {
  it('demo: all four enabled and unchanged', () => {
    seedDemoTeam()
    render(<Inspector />)
    for (const n of ['Message agent', 'Pause', 'Stop']) expect(btn(n)).toBeEnabled()
  })

  it('external idle: nothing can act, Stop process is disabled as not running', () => {
    seedLive()
    seedSessions({ live: false })
    render(<Inspector />)
    expect(btn('Message agent')).toBeDisabled()
    expect(btn('Message agent')).toHaveAttribute('title', expect.stringContaining('no API to send it messages'))
    expect(btn('Pause')).toBeDisabled()
    expect(btn('Stop process…')).toBeDisabled()
    expect(btn('Stop process…')).toHaveAttribute('title', 'This session is not running')
  })

  it('external live with a pid: only Stop process is enabled; without a pid it says so', () => {
    seedLive()
    seedSessions({ live: true, registryPid: 4242, entrypoint: 'claude-vscode' })
    const { unmount } = render(<Inspector />)
    expect(btn('Message agent')).toBeDisabled()
    expect(btn('Pause')).toBeDisabled()
    expect(btn('Stop process…')).toBeEnabled()
    unmount()
    seedSessions({ live: true })
    render(<Inspector />)
    expect(btn('Stop process…')).toBeDisabled()
    expect(btn('Stop process…')).toHaveAttribute('title', 'Process id unknown')
  })

  it('controlled idle: Message and Stop work, Pause is disabled as idle', () => {
    seedLive()
    seedSessions()
    useControlStore.setState({ sessions: [ctl()] })
    render(<Inspector />)
    expect(btn('Message agent')).toBeEnabled()
    expect(btn('Pause')).toBeDisabled()
    expect(btn('Pause')).toHaveAttribute('title', expect.stringContaining('idle'))
    expect(btn('Stop')).toBeEnabled()
  })

  it('controlled busy: Pause interrupts the control session; a sub-agent tooltip says the whole turn', async () => {
    seedLive({}, 'scout')
    seedSessions()
    useControlStore.setState({ sessions: [ctl({ state: 'busy' })] })
    render(<Inspector />)
    expect(btn('Pause')).toBeEnabled()
    expect(btn('Pause')).toHaveAttribute('title', 'Interrupts the whole current turn')
    await userEvent.click(btn('Pause'))
    expect(control.interrupt).toHaveBeenCalledWith('c1')
  })

  it('an exited control session counts as external', () => {
    seedLive()
    seedSessions({ live: false })
    useControlStore.setState({ sessions: [ctl({ state: 'exited' })] })
    render(<Inspector />)
    expect(btn('Message agent')).toBeDisabled()
  })
})

describe('Message agent', () => {
  it('lead: sends the text as-is', async () => {
    seedLive()
    seedSessions()
    useControlStore.setState({ sessions: [ctl()] })
    render(<Inspector />)
    await userEvent.click(btn('Message agent'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to lead' }), 'run the tests')
    await userEvent.click(btn('Send'))
    expect(control.send).toHaveBeenCalledWith('c1', 'run the tests')
  })

  it('sub-agent: sends the D2 formatted lead prompt', async () => {
    seedLive({}, 'scout')
    seedSessions()
    useControlStore.setState({ sessions: [ctl()] })
    render(<Inspector />)
    await userEvent.click(btn('Message agent'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to scout' }), 'check the logs')
    await userEvent.click(btn('Send'))
    expect(control.send).toHaveBeenCalledWith('c1', formatAgentMessage('scout', 'check the logs'))
    expect(control.send.mock.calls[0]![1]).toContain('@scout: check the logs')
  })

  it('shows the reason when sending fails and keeps the text', async () => {
    control.send.mockResolvedValue({ ok: false, reason: 'not-running' })
    seedLive()
    seedSessions()
    useControlStore.setState({ sessions: [ctl()] })
    render(<Inspector />)
    await userEvent.click(btn('Message agent'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to lead' }), 'hi')
    await userEvent.click(btn('Send'))
    expect(await screen.findByRole('alert')).toHaveTextContent('not-running')
    expect(screen.getByRole('textbox', { name: 'Message to lead' })).toHaveValue('hi')
  })
})

describe('Stop', () => {
  it('controlled idle stops immediately; busy asks first', async () => {
    seedLive()
    seedSessions()
    useControlStore.setState({ sessions: [ctl()] })
    const { unmount } = render(<Inspector />)
    await userEvent.click(btn('Stop'))
    expect(control.stop).toHaveBeenCalledWith('c1')
    unmount()
    control.stop.mockClear()
    useControlStore.setState({ sessions: [ctl({ state: 'busy' })] })
    render(<Inspector />)
    await userEvent.click(btn('Stop'))
    expect(control.stop).not.toHaveBeenCalled()
    const dlg = screen.getByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Stop session' }))
    expect(control.stop).toHaveBeenCalledWith('c1')
  })

  it('external: killExternal needs the confirm dialog, which names project, session, pid, account and entrypoint', async () => {
    seedLive()
    seedSessions({ live: true, registryPid: 4242, entrypoint: 'claude-vscode' })
    render(<Inspector />)
    await userEvent.click(btn('Stop process…'))
    expect(killExternal).not.toHaveBeenCalled()
    const dlg = screen.getByRole('dialog')
    for (const t of ['alpha', 'Fix the build', '4242', 'Company', 'VS Code extension', 'The transcript is kept; the turn in progress is lost'])
      expect(dlg).toHaveTextContent(t)
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(killExternal).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(btn('Stop process…'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop process' }))
    expect(killExternal).toHaveBeenCalledTimes(1)
    expect(killExternal).toHaveBeenCalledWith({ accountId: 'company', sessionId: SID, pid: 4242 })
  })

  it('external: a failed kill keeps the dialog open with the reason', async () => {
    killExternal.mockResolvedValue({ ok: false, reason: 'pid-changed' })
    seedLive()
    seedSessions({ live: true, registryPid: 4242 })
    render(<Inspector />)
    await userEvent.click(btn('Stop process…'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop process' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('pid-changed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Open worktree', () => {
  it('falls back to the agent cwd and opens it', async () => {
    seedLive()
    seedSessions()
    render(<Inspector />)
    await userEvent.click(btn('Open worktree'))
    expect(window.api!.worktree.openInEditor).toHaveBeenCalledWith(ROOT)
  })
})

describe('header: scoped actions (UX S5)', () => {
  it('Pause all in <project> interrupts only busy controlled sessions of the viewed project', async () => {
    seedLive()
    seedSessions()
    useControlStore.setState({
      sessions: [
        ctl({ id: 'c1', state: 'busy' }),
        ctl({ id: 'c2', state: 'idle', sessionId: 'x' }),
        ctl({ id: 'c3', state: 'busy', cwd: 'D:/work/beta', sessionId: 'other' })
      ]
    })
    render(<TeamHeader />)
    await userEvent.click(btn('Pause all in alpha'))
    expect(control.interrupt).toHaveBeenCalledTimes(1)
    expect(control.interrupt).toHaveBeenCalledWith('c1')
    expect((window.api!.team.pauseAll as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('Pause all in <project> is disabled with the reason when nothing is busy', () => {
    seedLive()
    seedSessions()
    useControlStore.setState({ sessions: [ctl({ state: 'idle' })] })
    render(<TeamHeader />)
    expect(btn('Pause all in alpha')).toBeDisabled()
    expect(btn('Pause all in alpha')).toHaveAttribute('title', 'No controlled session is busy in alpha')
  })

  it('+ New session names project and account, opens the start form and never sends', async () => {
    seedLive()
    seedSessions()
    render(<TeamHeader />)
    const b = await screen.findByRole('button', { name: '+ New session in alpha as Personal' })
    await userEvent.click(b)
    expect(useControlStore.getState().startForm).toMatchObject({ open: true, cwd: ROOT, accountId: 'personal' })
    expect(resolveFolder).toHaveBeenCalledWith(ROOT)
    expect(control.send).not.toHaveBeenCalled()
  })

  it('+ New session leaves the account to the form when the rule says ask', async () => {
    resolveFolder.mockResolvedValue({ accountId: 'ask', ruleIndex: -1 })
    seedLive()
    seedSessions()
    render(<TeamHeader />)
    await userEvent.click(await screen.findByRole('button', { name: '+ New session in alpha as choose account' }))
    const form = useControlStore.getState().startForm
    expect(form.open).toBe(true)
    expect(form.accountId).toBeUndefined()
  })

  it('the needs-you counter is labelled "in this session"', () => {
    seedLive()
    seedSessions()
    render(<TeamHeader />)
    expect(document.querySelector('.is-needs')).toHaveTextContent(/needs you in this session/)
  })
})

describe('header at narrow width (< 1300 px)', () => {
  it('keeps needs-you, project, session and the account chip; moves the rest into the "..." menu', async () => {
    setWidth(1000)
    seedLive()
    seedSessions()
    useControlStore.setState({ sessions: [ctl({ state: 'busy' })] })
    render(<TeamHeader />)
    expect(document.querySelector('.is-needs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /need you/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Session' })).toBeInTheDocument()
    expect(btn(/Manage accounts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pause all/ })).toBeNull()
    expect(screen.queryByText(/Tokens/)).toBeNull()

    const more = btn('More header actions')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Pause all in alpha' })).toBeEnabled()
    expect(within(menu).getByRole('menuitem', { name: /^\+ New session in alpha/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /^Hooks:/ })).toBeInTheDocument()
    expect(menu).toHaveTextContent(/Tokens/)

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Pause all in alpha' }))
    expect(control.interrupt).toHaveBeenCalledWith('c1')
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(more)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('at 1440 px there is no overflow menu', () => {
    seedLive()
    seedSessions()
    render(<TeamHeader />)
    expect(screen.queryByRole('button', { name: 'More header actions' })).toBeNull()
    expect(btn(/^Hooks:/)).toBeInTheDocument()
  })

  it('the inspector composer and confirm dialog render at a narrow width without the splitter props', async () => {
    setWidth(900)
    seedLive()
    seedSessions({ live: true, registryPid: 7 })
    render(<Inspector topHeight={300} />)
    expect(btn('Stop process…')).toBeEnabled()
  })
})
