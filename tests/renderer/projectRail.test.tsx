// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRail } from '@renderer/components/rail/ProjectRail'
import { ProjectSwitcher } from '@renderer/components/rail/ProjectSwitcher'
import { TeamView } from '@renderer/screens/TeamView'
import { resetAttentionStore, useAttentionStore } from '@renderer/store/useAttentionStore'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { resetLayoutStore } from '@renderer/store/useLayoutStore'
import { resetRailStore } from '@renderer/store/useRailStore'
import { useSwitcherStore } from '@renderer/store/useSwitcherStore'
import type { AccountView, AttentionItem, ProjectStatus, SessionSummary } from '@shared/types'
import { seedDemoTeam } from './seedTeam'
import { NOW, item, project } from './attentionFixtures'

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

const DAY = 24 * 3600 * 1000
const acc = (id: string, color: string, over: Partial<AccountView> = {}): AccountView =>
  ({ id, name: id, color, configDir: '', folderRules: [], signedIn: true, ...over }) as AccountView

function seed(projects: ProjectStatus[], items: AttentionItem[] = [], pins: string[] = []): void {
  useAttentionStore.setState({
    snapshot: { items, projects, updatedAt: '' },
    pins
  })
}

const rowOf = (name: RegExp | string) => screen.getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name},`) : name })
const names = () =>
  screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('button')?.getAttribute('aria-label')?.split(',')[0])

function mockMatchMedia(width: number, reduced = false) {
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity)
    return {
      matches: /prefers-reduced-motion/.test(q) ? reduced : width <= max,
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

const realActions = (() => {
  const c = useConsoleStore.getState()
  return { navigate: c.navigate, setProject: c.setProject, selectSession: c.selectSession, selectAgent: c.selectAgent }
})()

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1600 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 1000 })
  resetConsoleStore()
  useConsoleStore.setState({ ...realActions, nowMs: NOW })
  resetAttentionStore()
  resetRailStore()
  resetLayoutStore()
  useSwitcherStore.setState({ isOpen: false })
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  delete (window as { matchMedia?: unknown }).matchMedia
  resetAttentionStore()
})

describe('M1 badge precedence (worst state wins)', () => {
  it('needs-you beats running beats waiting beats nothing', () => {
    seed([
      project('d:/work/a', { needsYou: 2, running: 3, waiting: 1 }),
      project('d:/work/b', { running: 3, waiting: 1 }),
      project('d:/work/c', { waiting: 4 }),
      project('d:/work/d')
    ])
    render(<ProjectRail />)
    expect(screen.getByTestId('badge-d:/work/a')).toHaveAttribute('data-state', 'needs')
    expect(screen.getByTestId('badge-d:/work/a')).toHaveTextContent('2')
    // T32 U10: running is a plain dot with no number (numbers mean "for you")
    expect(screen.getByTestId('badge-d:/work/b')).toHaveAttribute('data-state', 'running')
    expect(screen.getByTestId('badge-d:/work/b')).toHaveClass('is-dot')
    expect(screen.getByTestId('badge-d:/work/b')).toHaveTextContent(/^$/)
    expect(screen.getByTestId('badge-d:/work/c')).toHaveAttribute('data-state', 'waiting')
    expect(screen.queryByTestId('badge-d:/work/d')).toBeNull()
  })

  it('F2: a ready (idle) item gives a blue waiting badge, not a red one', () => {
    seed([project('d:/work/a')], [item('i1', { severity: 'idle', projectKey: 'd:/work/a' })])
    render(<ProjectRail />)
    expect(screen.getByTestId('badge-d:/work/a')).toHaveAttribute('data-state', 'waiting')
  })

  it('pulses the running badge only when reduced motion is off', () => {
    seed([project('d:/work/a', { running: 1 })])
    const { unmount } = render(<ProjectRail />)
    expect(screen.getByTestId('badge-d:/work/a')).toHaveClass('is-animated')
    unmount()
    mockMatchMedia(1600, true)
    render(<ProjectRail />)
    expect(screen.getByTestId('badge-d:/work/a')).not.toHaveClass('is-animated')
  })
})

describe('M1 order', () => {
  it('pinned first in pin order, the rest by last activity', () => {
    seed(
      [
        project('d:/work/a', { lastActivityMs: NOW - 5000 }),
        project('d:/work/b', { lastActivityMs: NOW - 1000 }),
        project('d:/work/c', { lastActivityMs: NOW - 9000 }),
        project('d:/work/d', { lastActivityMs: NOW - 3000 })
      ],
      [],
      ['d:/work/c', 'd:/work/a']
    )
    render(<ProjectRail />)
    expect(names()).toEqual(['c', 'a', 'b', 'd'])
  })

  it('pin order stays stable when activity changes', () => {
    seed(
      [project('d:/work/a', { lastActivityMs: NOW - 5000 }), project('d:/work/b', { lastActivityMs: NOW - 1000 })],
      [],
      ['d:/work/a', 'd:/work/b']
    )
    render(<ProjectRail />)
    expect(names()).toEqual(['a', 'b'])
    act(() => seed([project('d:/work/a', { lastActivityMs: NOW - 9000 }), project('d:/work/b', { lastActivityMs: NOW })], [], ['d:/work/a', 'd:/work/b']))
    expect(names()).toEqual(['a', 'b'])
  })

  it('freezes the order while the pointer is over the rail and re-sorts after it leaves', () => {
    seed([project('d:/work/a', { lastActivityMs: NOW - 5000 }), project('d:/work/b', { lastActivityMs: NOW - 9000 })])
    render(<ProjectRail />)
    const nav = screen.getByRole('navigation', { name: 'Projects' })
    expect(names()).toEqual(['a', 'b'])
    fireEvent.mouseEnter(nav)
    act(() => seed([project('d:/work/a', { lastActivityMs: NOW - 5000 }), project('d:/work/b', { lastActivityMs: NOW })]))
    expect(names()).toEqual(['a', 'b'])
    fireEvent.mouseLeave(nav)
    expect(names()).toEqual(['b', 'a'])
  })

  it('moves quiet projects (no live session, idle over 24 h) under a collapsed "Idle (n)" group', async () => {
    seed([
      project('d:/work/live', { liveSessions: 1 }),
      project('d:/work/old', { liveSessions: 0, lastActivityMs: NOW - 2 * DAY }),
      project('d:/work/older', { liveSessions: 0, lastActivityMs: NOW - 5 * DAY }),
      project('d:/work/pinned-old', { liveSessions: 0, lastActivityMs: NOW - 9 * DAY })
    ], [], ['d:/work/pinned-old'])
    render(<ProjectRail />)
    expect(names()).toEqual(['pinned-old', 'live'])
    const idle = screen.getByRole('button', { name: 'Idle (2)' })
    expect(idle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(idle)
    expect(names()).toEqual(['pinned-old', 'live', 'old', 'older'])
  })

  it('keeps the viewed project out of the Idle group', () => {
    seed([project('d:/work/old', { liveSessions: 0, lastActivityMs: NOW - 5 * DAY })])
    useConsoleStore.setState({ projectKey: 'd:/work/old' })
    render(<ProjectRail />)
    expect(screen.queryByRole('button', { name: /^Idle/ })).toBeNull()
    expect(rowOf('old')).toHaveAttribute('aria-current', 'true')
  })
})

describe('M1 account stripe and partial hooks ring', () => {
  it('uses the account colour, and a split stripe + warning when two accounts mix', () => {
    useConsoleStore.setState({
      accounts: { ...useConsoleStore.getState().accounts, accounts: [acc('acc1', 'rgb(1, 2, 3)'), acc('acc2', 'rgb(9, 8, 7)')] }
    })
    seed([
      project('d:/work/one', { accountIds: ['acc1'] }),
      project('d:/work/two', { accountIds: ['acc1', 'acc2'], mixedAccounts: true })
    ])
    render(<ProjectRail />)
    const one = screen.getByTestId('stripe-d:/work/one')
    expect(one).not.toHaveClass('is-split')
    expect(one.style.background).toContain('rgb(1, 2, 3)')
    const two = screen.getByTestId('stripe-d:/work/two')
    expect(two).toHaveClass('is-split')
    expect(two.style.background).toContain('rgb(9, 8, 7)')
    expect(rowOf(/^two,/)).toHaveAccessibleName(/two accounts/)
    expect(within(rowOf(/^two,/)).getByTitle(/two different accounts/)).toBeInTheDocument()
    expect(within(rowOf(/^one,/)).queryByTitle(/two different accounts/)).toBeNull()
  })

  it('F3: a live project without hooks gets a hollow ring and says so in its tooltip', () => {
    seed([
      project('d:/work/blind', { liveSessions: 1, hooksActive: false }),
      project('d:/work/seen', { liveSessions: 1, hooksActive: true }),
      project('d:/work/quiet', { liveSessions: 0, hooksActive: false })
    ])
    render(<ProjectRail />)
    expect(screen.getByTestId('partial-d:/work/blind')).toBeInTheDocument()
    expect(screen.queryByTestId('partial-d:/work/seen')).toBeNull()
    expect(screen.queryByTestId('partial-d:/work/quiet')).toBeNull()
    expect(rowOf(/^blind,/).title).toMatch(/sub-agent prompts of external sessions are not detected/)
  })

  it('shows live sessions, running and tokens today in the row title', () => {
    seed([project('d:/work/a', { liveSessions: 2, running: 1, tokensToday: 120_000 })])
    render(<ProjectRail />)
    expect(rowOf('a').title).toMatch(/2 live sessions, 1 running, tokens today 120k/)
  })
})

describe('M1 interactions', () => {
  it('clicking a row switches project; the current one is aria-current', async () => {
    const setProject = vi.fn()
    useConsoleStore.setState({ setProject, projectKey: 'd:/work/a' })
    seed([project('d:/work/a'), project('d:/work/b', { lastActivityMs: NOW - 5000 })])
    render(<ProjectRail />)
    expect(rowOf('a')).toHaveAttribute('aria-current', 'true')
    expect(rowOf('b')).not.toHaveAttribute('aria-current')
    await userEvent.click(rowOf('b'))
    expect(setProject).toHaveBeenCalledWith('d:/work/b')
  })

  it('has a navigation landmark with a list', () => {
    seed([project('d:/work/a')])
    render(<ProjectRail />)
    expect(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('list')).toBeInTheDocument()
  })

  it('context menu: Pin / Unpin', async () => {
    seed([project('d:/work/a')])
    render(<ProjectRail />)
    fireEvent.contextMenu(rowOf('a'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin' }))
    expect(useAttentionStore.getState().pins).toEqual(['d:/work/a'])
    fireEvent.contextMenu(rowOf(/^a,/))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }))
    expect(useAttentionStore.getState().pins).toEqual([])
  })

  it('context menu opens from the keyboard (Shift+F10 and the menu key) and Esc returns focus', async () => {
    seed([project('d:/work/a')])
    render(<ProjectRail />)
    const row = rowOf('a')
    row.focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menu', { name: 'a actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pin' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(row).toHaveFocus()
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('context menu: Mute notifications writes prefs; Open in VS Code opens the project root', async () => {
    const setPrefs = vi.fn().mockResolvedValue({ ok: true })
    const openInEditor = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { attention: { setPrefs }, worktree: { openInEditor } }
    seed([project('d:/work/a', { root: 'D:/work/a' })])
    render(<ProjectRail />)
    fireEvent.contextMenu(rowOf('a'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mute notifications' }))
    expect(setPrefs).toHaveBeenCalledWith(expect.objectContaining({ mutedProjects: ['d:/work/a'] }))
    expect(rowOf(/^a,.*muted/)).toBeInTheDocument()
    fireEvent.contextMenu(rowOf(/^a,/))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open in VS Code' }))
    expect(openInEditor).toHaveBeenCalledWith('D:/work/a')
  })

  it('falls back to transcript projects when the hub has not reported them', () => {
    const sessions = [
      { sessionId: 's1', accountId: 'acc1', configDir: '', projectDir: 'x', mtimeMs: NOW, sizeBytes: 1, live: true, project: { key: 'd:/work/zeta', name: 'zeta', root: 'D:/work/zeta' } }
    ] as unknown as SessionSummary[]
    useConsoleStore.setState({ sessions })
    seed([])
    render(<ProjectRail />)
    expect(names()).toEqual(['zeta'])
  })

  it('collapses to icons and back, persisted', async () => {
    seed([project('d:/work/alpha')])
    render(<ProjectRail />)
    expect(screen.getByText(/live ·/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse project rail' }))
    expect(screen.queryByText(/live ·/)).toBeNull()
    expect(window.localStorage.getItem('ac.railExpanded')).toBe('false')
    expect(screen.getByRole('button', { name: 'Expand project rail' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('mount effect starts the attention subscription', () => {
    const onChanged = vi.fn(() => () => undefined)
    ;(window as unknown as { api: unknown }).api = { attention: { onChanged, onFocus: vi.fn(() => () => undefined) } }
    const { unmount } = render(<ProjectRail />)
    expect(onChanged).toHaveBeenCalledTimes(1)
    unmount()
  })
})

describe('M1 responsive: compact strip and narrow drawer', () => {
  it('compact icon strip: no names, tooltip and accessible name keep the project and badge', () => {
    seed([project('d:/work/alpha', { needsYou: 1 })])
    render(<ProjectRail compact />)
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.queryByRole('button', { name: /project rail/ })).toBeNull()
    expect(rowOf(/^alpha, 1 need you/)).toHaveAttribute('title')
    expect(screen.getByRole('navigation', { name: 'Projects' })).toHaveClass('is-icons')
  })

  it('TeamView at 1200 px: the rail slot is data-compact', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1200 })
    mockMatchMedia(1200)
    seedDemoTeam()
    seed([project('d:/work/alpha')])
    const { container } = render(<TeamView />)
    expect(container.querySelector('.ac-team__rail-slot')).toHaveAttribute('data-compact', 'true')
    expect(screen.getByRole('navigation', { name: 'Projects' })).toHaveClass('is-icons')
  })

  it('TeamView at 1600 px: rail is expanded and not compact', () => {
    mockMatchMedia(1600)
    seedDemoTeam()
    seed([project('d:/work/alpha')])
    const { container } = render(<TeamView />)
    expect(container.querySelector('.ac-team__rail-slot')).toHaveAttribute('data-compact', 'false')
    expect(screen.getByRole('navigation', { name: 'Projects' })).toHaveClass('is-expanded')
  })

  it('TeamView at 900 px: rail + worktrees/tasks merge into one left drawer (open, Esc, focus returns)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 })
    mockMatchMedia(900)
    seedDemoTeam()
    seed([project('d:/work/alpha'), project('d:/work/beta', { lastActivityMs: NOW - 9000 })])
    const setProject = vi.fn()
    useConsoleStore.setState({ setProject, projectKey: 'd:/work/alpha' })
    const { container } = render(<TeamView />)
    // Nothing of the left side is inline: no rail, no worktrees column, no left splitter.
    expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Worktrees and tasks' })).toBeNull()
    expect(screen.queryByRole('separator', { name: 'Resize worktrees panel' })).toBeNull()
    expect(container.querySelector('.ac-team__rail-slot')).toBeEmptyDOMElement()

    const toggle = screen.getByRole('button', { name: 'Projects' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    const drawer = screen.getByRole('dialog', { name: 'Projects, worktrees and tasks' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(drawer).toHaveFocus()
    expect(within(drawer).getByRole('navigation', { name: 'Projects' })).toBeInTheDocument()
    expect(within(drawer).getByText('Worktrees')).toBeInTheDocument()
    expect(within(drawer).getByText(/Shared tasks/i)).toBeInTheDocument()

    // Picking a project switches and closes the drawer.
    await userEvent.click(within(drawer).getByRole('button', { name: /^beta,/ }))
    expect(setProject).toHaveBeenCalledWith('d:/work/beta')
    expect(screen.queryByRole('dialog', { name: 'Projects, worktrees and tasks' })).toBeNull()
    expect(toggle).toHaveFocus()

    await userEvent.click(toggle)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Projects, worktrees and tasks' })).toBeNull()
    expect(toggle).toHaveFocus()
  })

  it('Tab stays inside the left drawer', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 })
    mockMatchMedia(900)
    seedDemoTeam()
    seed([project('d:/work/alpha')])
    render(<TeamView />)
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }))
    const drawer = screen.getByRole('dialog', { name: 'Projects, worktrees and tasks' })
    for (let i = 0; i < 25; i++) {
      await userEvent.tab()
      expect(drawer.contains(document.activeElement)).toBe(true)
    }
  })
})

describe('S1 quick switcher (Ctrl+K opens it via useSwitcherStore.open())', () => {
  const sessions = [
    { sessionId: 'abc12345', accountId: 'acc1', configDir: '', projectDir: 'x', title: 'Fix login bug', mtimeMs: NOW, sizeBytes: 1, live: true, project: { key: 'd:/work/alpha', name: 'alpha', root: 'D:/work/alpha' } },
    { sessionId: 'old00001', accountId: 'acc1', configDir: '', projectDir: 'x', title: 'Old chat', mtimeMs: NOW - 9, sizeBytes: 1, project: { key: 'd:/work/alpha', name: 'alpha', root: 'D:/work/alpha' } },
    { sessionId: 'zz000001', accountId: 'acc2', configDir: '', projectDir: 'y', title: 'Docs pass', mtimeMs: NOW - 5, sizeBytes: 1, live: true, project: { key: 'd:/work/beta', name: 'beta', root: 'D:/work/beta' } }
  ] as unknown as SessionSummary[]

  beforeEach(() => {
    useConsoleStore.setState({ sessions })
    seed([])
  })

  it('lists projects and their live sessions, filters by name or root, Enter switches', async () => {
    const setProject = vi.fn()
    useConsoleStore.setState({ setProject, projectKey: 'd:/work/alpha' })
    render(<ProjectSwitcher />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useSwitcherStore.getState().open())
    const dialog = screen.getByRole('dialog', { name: 'Switch project or session' })
    const filter = within(dialog).getByRole('combobox', { name: 'Filter projects and sessions' })
    expect(filter).toHaveFocus()
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Projectalpha'),
      expect.stringContaining('Fix login bug'),
      expect.stringContaining('Projectbeta'),
      expect.stringContaining('Docs pass')
    ])
    await userEvent.type(filter, 'work/beta')
    expect(within(dialog).getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{Enter}')
    expect(setProject).toHaveBeenCalledWith('d:/work/beta')
    expect(useSwitcherStore.getState().isOpen).toBe(false)
  })

  it('arrow keys move the highlight; choosing a session selects it', async () => {
    const setProject = vi.fn()
    const selectSession = vi.fn().mockResolvedValue(undefined)
    useConsoleStore.setState({ setProject, selectSession, projectKey: 'd:/work/beta' })
    render(<ProjectSwitcher />)
    act(() => useSwitcherStore.getState().open())
    await userEvent.type(screen.getByRole('combobox'), 'login')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    expect(setProject).toHaveBeenCalledWith('d:/work/alpha')
    expect(selectSession).toHaveBeenCalledWith({ mode: 'session', accountId: 'acc1', sessionId: 'abc12345' })
  })

  it('shows "No match" and Esc closes', async () => {
    render(<ProjectSwitcher />)
    act(() => useSwitcherStore.getState().open())
    await userEvent.type(screen.getByRole('combobox'), 'zzzzzz')
    expect(screen.getByText('No match')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(useSwitcherStore.getState().isOpen).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(useSwitcherStore.getState().isOpen).toBe(false)
  })

  it('works at narrow width (single column dialog)', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 600 })
    mockMatchMedia(600)
    render(<ProjectSwitcher />)
    act(() => useSwitcherStore.getState().open())
    expect(screen.getByRole('dialog', { name: 'Switch project or session' })).toBeInTheDocument()
  })
})
