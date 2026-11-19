// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '@renderer/components/chat/ChatView'
import { TeamView } from '@renderer/screens/TeamView'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { CENTER_VIEW_KEY, resetCenterViewStore, useCenterViewStore } from '@renderer/store/useCenterViewStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { useWindowsStore } from '@renderer/store/useWindowsStore'
import { resetLayoutStore } from '@renderer/store/useLayoutStore'
import { mockTeamSnapshot } from '@shared/mock'
import type { ControlSessionInfo, PermissionPrompt, TeamSnapshot } from '@shared/types'

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

const SID = 'abcdef123456'
const control = vi.hoisted(() => ({ send: vi.fn(), answer: vi.fn(), interrupt: vi.fn(), start: vi.fn() }))

function snap(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    ...structuredClone(mockTeamSnapshot),
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
      { time: '10:00:03', who: 'lead', text: 'Here is **bold** and a list:\n\n- one\n- two\n\n```sh\nnpm run build\n```' },
      { time: '10:00:04', who: 'lead', text: 'Read D:/work/alpha/src/app.ts' }
    ],
    ...over
  }
}
const seed = (over: Partial<TeamSnapshot> = {}) => {
  const t = snap(over)
  useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live', selectedAgentId: 'lead' })
}
const ctl = (over: Partial<ControlSessionInfo> = {}): ControlSessionInfo => ({
  id: 'c1',
  accountId: 'acc1',
  cwd: 'D:/work/alpha',
  state: 'idle',
  permissionMode: 'default',
  sessionId: SID,
  slashCommands: [],
  pendingPermissions: 0,
  queuedTurns: 0,
  ...over
})
const perm = (): PermissionPrompt => ({
  requestId: 'r1',
  toolName: 'Bash',
  displayName: 'Bash',
  inputPreview: 'rm -rf build',
  receivedAt: '2026-11-19T10:00:00Z'
})

function mockMatchMedia(width: number) {
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity)
    return {
      matches: width <= max,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null
    }
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  resetConsoleStore()
  resetCenterViewStore()
  resetLayoutStore()
  window.localStorage.clear()
  Object.values(control).forEach((f) => f.mockReset())
  control.send.mockResolvedValue({ ok: true })
  control.answer.mockResolvedValue({ ok: true })
  useControlStore.setState({ sessions: [], streams: {}, startForm: { open: false }, error: undefined })
  ;(window as unknown as { api: unknown }).api = {
    control: { ...control, list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(), onStream: vi.fn() },
    app: { openExternal: vi.fn(), getDefaultCwd: vi.fn(), pickFolder: vi.fn() }
  }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('T33 ChatView', () => {
  it('renders speakers, Markdown replies and collapsed tool calls', async () => {
    seed()
    useControlStore.setState({ sessions: [ctl()] })
    render(<ChatView />)
    const log = screen.getByRole('log', { name: 'Conversation' })
    expect(within(log).getByText('you')).toBeInTheDocument()
    expect(within(log).getAllByText('lead').length).toBeGreaterThan(0)
    expect(log.querySelector('strong')).toHaveTextContent('bold')
    expect(log.querySelectorAll('ul > li')).toHaveLength(2)
    expect(log.querySelector('pre')?.textContent).toBe('npm run build')
    const tool = within(log).getByRole('button', { name: /Bash.*npm test/ })
    expect(tool).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(tool)
    expect(tool).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Tool input and result')).toHaveTextContent('npm test')
  })

  it('tool input is shortened with displayPath and truncated behind Show more', async () => {
    seed({ console: [{ time: '1', who: 'lead', text: 'Write D:/work/alpha/src/a.ts ' + 'z'.repeat(2000) }] })
    render(<ChatView />)
    await userEvent.click(screen.getByRole('button', { name: /Write/ }))
    const pre = screen.getByLabelText('Tool input and result')
    expect(pre.textContent).not.toContain('D:/work/alpha/src')
    expect(pre.textContent!.length).toBeLessThan(900)
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByLabelText('Tool input and result').textContent!.length).toBeGreaterThan(1900)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('streaming partial text appears in place, as Markdown', () => {
    seed()
    useControlStore.setState({
      sessions: [ctl({ state: 'busy' })],
      streams: { c1: { controlId: 'c1', thinking: false, permissions: [], notices: [], typing: { messageId: 'm', text: 'partial **now**' } } }
    })
    render(<ChatView />)
    expect(screen.getByTestId('chat-typing').querySelector('strong')).toHaveTextContent('now')
  })

  it('send goes through useControlStore.send only on Enter, and clears the draft on success', async () => {
    seed()
    useControlStore.setState({ sessions: [ctl()] })
    render(<ChatView />)
    expect(control.send).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'do it')
    expect(control.send).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(control.send).toHaveBeenCalledTimes(1)
    expect(control.send).toHaveBeenCalledWith('c1', 'do it')
    await vi.waitFor(() => expect(useConsoleStore.getState().consoleDraft).toBe(''))
  })

  it('shows the target: lead, or @name for a teammate', async () => {
    seed()
    useControlStore.setState({ sessions: [ctl()] })
    render(<ChatView />)
    expect(screen.getByText('to lead')).toBeInTheDocument()
    const name = useConsoleStore.getState().team.agents.find((a) => a.id !== 'lead')!.name
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), `@${name} hi`)
    expect(screen.getByText(`to @${name}`)).toBeInTheDocument()
  })

  it('external session: no composer, one line with the reason and one action (T32 U7)', () => {
    seed()
    render(<ChatView />)
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
    expect(screen.getByText(/Agent Console can't type into it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fork it in Team view' })).toBeInTheDocument()
  })

  it('chat pop-out: the external-session fork opens the project window instead', async () => {
    seed()
    window.history.replaceState({}, '', '/?kind=chat&projectKey=acme&sessionRef=a1%7Cs1')
    const open = vi.fn().mockResolvedValue(true)
    useWindowsStore.setState({ open })
    try {
      render(<ChatView />)
      expect(screen.queryByRole('button', { name: 'Fork it in Team view' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Fork it in the project window' }))
      expect(open).toHaveBeenCalledWith({ kind: 'project', projectKey: 'acme' })
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('pending permission is pinned above the composer and answered through the store', async () => {
    seed()
    useControlStore.setState({
      sessions: [ctl({ state: 'busy', pendingPermissions: 1 })],
      streams: { c1: { controlId: 'c1', thinking: false, permissions: [perm()], notices: [] } }
    })
    render(<ChatView />)
    expect(screen.getByText('Waiting for your answer: Bash')).toBeInTheDocument()
    const card = screen.getByRole('alertdialog')
    await userEvent.click(within(card).getByRole('button', { name: /^Allow/ }))
    expect(control.answer).toHaveBeenCalledWith('c1', 'r1', expect.objectContaining({ behavior: 'allow' }))
  })

  it('auto-scrolls at the bottom; otherwise shows a New messages pill', () => {
    seed()
    useControlStore.setState({ sessions: [ctl()] })
    render(<ChatView />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 })
    // user scrolled up
    log.scrollTop = 100
    fireEvent.scroll(log)
    expect(screen.queryByText(/New messages/)).toBeNull()
    act(() => {
      const t = useConsoleStore.getState().team
      useConsoleStore.setState({ team: { ...t, console: [...t.console, { time: '10:01', who: 'lead', text: 'late' }] } })
    })
    const pill = screen.getByRole('button', { name: /New messages/ })
    expect(log.scrollTop).toBe(100)
    fireEvent.click(pill)
    expect(log.scrollTop).toBe(1000)
    expect(screen.queryByText(/New messages/)).toBeNull()
  })

  it('narrow width: full-width column flag below 900 px, composer still docked', () => {
    mockMatchMedia(700)
    seed()
    useControlStore.setState({ sessions: [ctl()] })
    const { container } = render(<ChatView />)
    expect(container.querySelector('.ac-chat')).toHaveAttribute('data-narrow', 'true')
    expect(container.querySelector('.ac-chat__dock .ac-composer')).not.toBeNull()
  })

  it('wide width: readable column', () => {
    mockMatchMedia(1400)
    seed()
    const { container } = render(<ChatView />)
    expect(container.querySelector('.ac-chat')).toHaveAttribute('data-narrow', 'false')
  })
})

describe('T33 Team | Chat tabs', () => {
  const tab = (n: string) => screen.getByRole('tab', { name: n })

  it('tablist with Team selected by default; Chat swaps the center column', async () => {
    seed()
    render(<TeamView />)
    expect(screen.getByRole('tablist', { name: 'Center view' })).toBeInTheDocument()
    expect(tab('Team')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Lead console' })).toBeInTheDocument()
    await userEvent.click(tab('Chat'))
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Lead console' })).toBeNull()
    await userEvent.click(tab('Team'))
    expect(screen.getByRole('heading', { name: 'Lead console' })).toBeInTheDocument()
  })

  it('arrow keys move between tabs', async () => {
    seed()
    render(<TeamView />)
    tab('Team').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Chat')).toHaveFocus()
  })

  it('the choice is remembered per project and persisted', async () => {
    seed()
    useConsoleStore.setState({ projectKey: 'p1' })
    const { unmount } = render(<TeamView />)
    await userEvent.click(tab('Chat'))
    expect(JSON.parse(window.localStorage.getItem(CENTER_VIEW_KEY)!)).toEqual({ p1: 'chat' })
    unmount()
    render(<TeamView />)
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true')
    act(() => useConsoleStore.setState({ projectKey: 'p2' }))
    expect(tab('Team')).toHaveAttribute('aria-selected', 'true')
    act(() => useConsoleStore.setState({ projectKey: 'p1' }))
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true')
  })

  it('loads a saved choice from localStorage and ignores junk', async () => {
    window.localStorage.setItem(CENTER_VIEW_KEY, JSON.stringify({ p9: 'chat', bad: 'zzz' }))
    vi.resetModules()
    const mod = await import('@renderer/store/useCenterViewStore')
    expect(mod.useCenterViewStore.getState().byProject).toEqual({ p9: 'chat' })
  })

  it('Ctrl+Shift+C toggles Team/Chat; store.toggle() does too', () => {
    seed()
    render(<TeamView />)
    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true })
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true })
    expect(tab('Team')).toHaveAttribute('aria-selected', 'true')
    act(() => useCenterViewStore.getState().toggle())
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true')
  })

  it('narrow window: tabs stay on one row (no wrapping) and Chat works', async () => {
    mockMatchMedia(700)
    seed()
    render(<TeamView />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    await userEvent.click(tab('Chat'))
    expect(screen.getByRole('log')).toBeInTheDocument()
  })
})

describe('T33 maximize the lead console', () => {
  const maxBtn = () => screen.getByRole('button', { name: 'Maximize lead console' })

  it('button maximizes (grid and timeline hidden) and restores', async () => {
    seed()
    useControlStore.setState({ sessions: [ctl()] })
    render(<TeamView />)
    expect(document.getElementById('ac-agents')).not.toBeNull()
    await userEvent.click(maxBtn())
    expect(document.getElementById('ac-agents')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Lead console' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore lead console' }))
    expect(document.getElementById('ac-agents')).not.toBeNull()
  })

  it('double-click on the header maximizes; Esc restores', async () => {
    seed()
    render(<TeamView />)
    fireEvent.doubleClick(screen.getByRole('heading', { name: 'Lead console' }))
    expect(useCenterViewStore.getState().consoleMaximized).toBe(true)
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Lead console' }), { key: 'Escape' })
    expect(useCenterViewStore.getState().consoleMaximized).toBe(false)
  })

  it('Ctrl+Shift+M toggles it; switching to Chat clears it', async () => {
    seed()
    render(<TeamView />)
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true })
    expect(useCenterViewStore.getState().consoleMaximized).toBe(true)
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(useCenterViewStore.getState().consoleMaximized).toBe(false)
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true })
    expect(useCenterViewStore.getState().consoleMaximized).toBe(false) // no console in Chat view
  })
})
