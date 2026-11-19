// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGrid } from '@renderer/components/team/AgentGrid'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { SharedTaskList } from '@renderer/components/team/SharedTaskList'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { Timeline } from '@renderer/components/team/Timeline'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { mockTeamSnapshot } from '@shared/mock'
import type { Agent, SessionSummary, TeamSnapshot } from '@shared/types'

const NOW = 1_800_000_000_000

function liveAgent(i: number, over: Partial<Agent> = {}): Agent {
  const base = structuredClone(mockTeamSnapshot.agents[i]!)
  return {
    ...base,
    runtime: {
      kind: i === 0 ? 'lead' : 'subagent',
      startedMs: NOW - 60_000,
      lastActivityMs: NOW - 1000,
      openTools: [{ id: `t${i}`, name: 'Bash', startedMs: NOW - 2000 }],
      lastTurn: 'assistant_tool_use'
    },
    ...over
  }
}

function liveSnapshot(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  const base = structuredClone(mockTeamSnapshot)
  return {
    ...base,
    source: 'live',
    repo: 'my-repo',
    teamName: 'lead-session',
    agents: [liveAgent(0, { depth: 0 }), liveAgent(1, { depth: 1 }), liveAgent(2, { depth: 2 })],
    worktrees: [],
    tasks: [],
    overlaps: [],
    console: [
      { time: '10:00:01', who: 'you', text: 'first live line' },
      { time: '10:00:05', who: base.agents[1]!.id, text: 'second live line' }
    ],
    ...over
  }
}

function seedLive(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  const snap = liveSnapshot(over)
  useConsoleStore.setState({
    team: snap,
    liveTeam: snap,
    teamMode: 'live',
    nowMs: NOW,
    selectedAgentId: snap.agents[0]?.id ?? 'lead'
  })
  return snap
}

const sessions: SessionSummary[] = [
  {
    sessionId: 'abcdef123456',
    accountId: 'acc1',
    configDir: 'C:/c',
    projectDir: 'proj-a',
    cwd: 'D:/work/alpha',
    title: 'Fix bug',
    mtimeMs: NOW - 5 * 60_000,
    sizeBytes: 10,
    live: true
  },
  {
    sessionId: 'zzzzzzzz9999',
    accountId: 'acc2',
    configDir: 'C:/d',
    projectDir: 'proj-b',
    mtimeMs: NOW - 3 * 3600_000,
    sizeBytes: 10
  }
]

beforeEach(() => {
  resetConsoleStore()
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('R-12 header badge', () => {
  it('shows LIVE for a live team', () => {
    seedLive()
    render(<TeamHeader />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.queryByText(/DEMO/)).toBeNull()
    expect(screen.getByText('team: lead-session')).toBeInTheDocument()
  })

  it('shows DEMO with the demo data text and Back to live in demo mode', async () => {
    seedLive()
    useConsoleStore.getState().showDemo()
    render(<TeamHeader />)
    expect(screen.getByText(/DEMO/)).toHaveTextContent('demo data')
    expect(screen.queryByText('LIVE')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    expect(useConsoleStore.getState().teamMode).toBe('live')
    expect(screen.queryByRole('button', { name: 'Back to live' })).toBeNull()
  })

  it('shows no badge when empty', () => {
    seedLive({ agents: [], source: undefined })
    render(<TeamHeader />)
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(screen.queryByText(/DEMO/)).toBeNull()
  })

  it('shows the truncated-history note', () => {
    seedLive({ historyTruncated: true })
    render(<TeamHeader />)
    expect(screen.getByText('older history not loaded')).toBeInTheDocument()
  })
})

describe('R-12 session picker', () => {
  it('lists Auto then one option per session with the documented label and value', () => {
    seedLive()
    useConsoleStore.setState({ sessions })
    render(<TeamHeader />)
    const sel = screen.getByRole('combobox', { name: 'Session' })
    const opts = within(sel).getAllByRole('option') as HTMLOptionElement[]
    expect(opts).toHaveLength(3)
    expect(opts[0]).toHaveTextContent('Auto (latest)')
    expect(opts[0]!.value).toBe('auto')
    expect(opts[1]!.value).toBe('acc1|abcdef123456')
    expect(opts[1]).toHaveTextContent('Fix bug · alpha · 5m ago · live')
    expect(opts[2]!.value).toBe('acc2|zzzzzzzz9999')
    expect(opts[2]).toHaveTextContent('zzzzzzzz · proj-b · 3h ago')
    expect(opts[2]!.textContent).not.toContain('live')
    expect(sel).toHaveValue('auto')
  })

  it('calls selectSession on change and reflects the store selection', async () => {
    seedLive()
    const select = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: unknown }).api = { transcripts: { select } }
    useConsoleStore.setState({ sessions })
    render(<TeamHeader />)
    const sel = screen.getByRole('combobox', { name: 'Session' })
    fireEvent.change(sel, { target: { value: 'acc1|abcdef123456' } })
    expect(select).toHaveBeenCalledWith({ mode: 'session', accountId: 'acc1', sessionId: 'abcdef123456' })
    expect(useConsoleStore.getState().selection).toEqual({
      mode: 'session',
      accountId: 'acc1',
      sessionId: 'abcdef123456'
    })
    expect(await screen.findByRole('combobox', { name: 'Session' })).toHaveValue('acc1|abcdef123456')
    fireEvent.change(sel, { target: { value: 'auto' } })
    expect(select).toHaveBeenLastCalledWith({ mode: 'auto' })
  })
})

describe('R-12 grid empty states', () => {
  it('shows the no-session state and the demo button switches to DEMO and back', async () => {
    seedLive({ agents: [] })
    render(
      <>
        <TeamHeader />
        <AgentGrid />
      </>
    )
    expect(screen.getByText('No Claude Code session found')).toBeInTheDocument()
    expect(screen.getByText(/Raw terminal, or open a project in VS Code/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show demo data' }))
    expect(useConsoleStore.getState().teamMode).toBe('demo')
    expect(screen.getByText(/DEMO/)).toBeInTheDocument()
    expect(screen.queryByText('No Claude Code session found')).toBeNull()
    expect(document.querySelectorAll('.ac-card').length).toBe(mockTeamSnapshot.agents.length)
    await userEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    expect(screen.getByText('No Claude Code session found')).toBeInTheDocument()
  })

  it('the demo button is a real focusable button', () => {
    seedLive({ agents: [] })
    render(<AgentGrid />)
    const b = screen.getByRole('button', { name: 'Show demo data' })
    b.focus()
    expect(b).toHaveFocus()
    expect(b.tagName).toBe('BUTTON')
  })

  it('shows the waiting state without a demo button', () => {
    seedLive({ agents: [], waitingForSession: true })
    render(<AgentGrid />)
    expect(screen.getByText(/Waiting for the session to start/)).toHaveTextContent('after the first prompt')
    expect(screen.queryByRole('button', { name: 'Show demo data' })).toBeNull()
    expect(screen.queryByText('No Claude Code session found')).toBeNull()
  })
})

describe('R-12 live cards', () => {
  it('renders agents in the given order with a status tooltip and depth indent', () => {
    const snap = seedLive()
    const { container } = render(<AgentGrid />)
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.ac-card-cell'))
    expect(cells).toHaveLength(3)
    const names = cells.map((c) => c.querySelector('.ac-card__name')!.textContent)
    expect(names).toEqual(snap.agents.map((a) => a.name))
    for (const c of cells) expect(c.getAttribute('title')).toMatch(/running tool/)
    expect(cells[0]!.style.marginLeft).toBe('')
    expect(cells[1]!.style.marginLeft).toBe('12px')
    expect(cells[2]!.style.marginLeft).toBe('24px')
    expect(cells[2]).toHaveClass('ac-card-cell--child')
  })

  it('caps the indent at depth 3', () => {
    seedLive({ agents: [liveAgent(0, { depth: 7 })] })
    const { container } = render(<AgentGrid />)
    expect(container.querySelector<HTMLElement>('.ac-card-cell')!.style.marginLeft).toBe('36px')
  })

  it('does not indent in demo mode', () => {
    seedLive()
    useConsoleStore.getState().showDemo()
    const { container } = render(<AgentGrid />)
    for (const c of container.querySelectorAll<HTMLElement>('.ac-card-cell')) expect(c.style.marginLeft).toBe('')
  })
})

describe('R-12 lead console', () => {
  it('renders the live console lines and the Phase 3b hint', () => {
    seedLive()
    render(<LeadConsole />)
    expect(screen.getByText('first live line')).toBeInTheDocument()
    expect(screen.getByText('second live line')).toBeInTheDocument()
    expect(screen.getByText('Sending prompts arrives in Phase 3b')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message the lead' })).toBeEnabled()
  })

  it('has no Phase 3b hint in demo mode', () => {
    seedLive()
    useConsoleStore.getState().showDemo()
    render(<LeadConsole />)
    expect(screen.queryByText('Sending prompts arrives in Phase 3b')).toBeNull()
  })

  it('scrolls to the newest line only when already at the bottom', () => {
    seedLive()
    const { container } = render(<LeadConsole />)
    const log = container.querySelector<HTMLElement>('.ac-tc-log')!
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 100 })
    const add = (n: number): void => {
      const t = useConsoleStore.getState().team
      const next = { ...t, console: [...t.console, { time: '10:01:00', who: 'you', text: `more ${n}` }] }
      useConsoleStore.setState({ team: next })
    }
    log.scrollTop = 400
    fireEvent.scroll(log)
    act(() => add(1))
    expect(screen.getByText('more 1')).toBeInTheDocument()
    expect(log.scrollTop).toBe(500)
    log.scrollTop = 50
    fireEvent.scroll(log)
    act(() => add(2))
    expect(screen.getByText('more 2')).toBeInTheDocument()
    expect(log.scrollTop).toBe(50)
  })
})

describe('R-12 Phase 5 placeholders', () => {
  it('shows placeholders in live mode', () => {
    seedLive()
    render(
      <>
        <WorktreeList />
        <SharedTaskList />
        <Timeline />
      </>
    )
    expect(screen.getByText('Worktrees arrive in Phase 5')).toBeInTheDocument()
    expect(screen.getByText('Shared tasks arrive in Phase 5')).toBeInTheDocument()
    expect(screen.getByText('Timeline arrives in Phase 5')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Worktrees' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shared tasks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument()
  })

  it('renders the mock sections in demo mode', () => {
    seedLive()
    useConsoleStore.getState().showDemo()
    render(
      <>
        <WorktreeList />
        <SharedTaskList />
        <Timeline />
      </>
    )
    expect(screen.queryByText(/arrive in Phase 5/)).toBeNull()
    expect(screen.getByText(mockTeamSnapshot.worktrees[0]!.branch)).toBeInTheDocument()
    expect(
      screen.getByText(`#${mockTeamSnapshot.tasks[0]!.id} ${mockTeamSnapshot.tasks[0]!.title}`)
    ).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /activity, last 20 minutes/ }).length).toBeGreaterThan(0)
  })
})
