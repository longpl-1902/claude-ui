// @vitest-environment jsdom
import './jestDom'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTeamSnapshot } from '@shared/mock'
import { OverlapBanner } from '@renderer/components/team/OverlapBanner'
import { AgentGrid } from '@renderer/components/team/AgentGrid'
import { AgentCard } from '@renderer/components/team/AgentCard'
import { Timeline } from '@renderer/components/team/Timeline'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { RawTerminalPane } from '@renderer/components/team/RawTerminalPane'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'

const xterm = vi.hoisted(() => ({
  open: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  fit: vi.fn()
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open = xterm.open
    write = xterm.write
    dispose = xterm.dispose
    loadAddon = xterm.loadAddon
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = xterm.fit
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

beforeEach(() => {
  resetConsoleStore()
  Object.values(xterm).forEach((f) => f.mockClear())
})

describe('R-10 OverlapBanner', () => {
  it('shows the alert with the path, both agents and Compare diffs', () => {
    render(<OverlapBanner />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('File overlap:')
    expect(alert).toHaveTextContent('src/Api/SheetDto.cs')
    expect(alert).toHaveTextContent('api-designer and test-writer')
    expect(alert).toHaveTextContent('in different worktrees')
    expect(within(alert).getByRole('button', { name: 'Compare diffs' })).toBeInTheDocument()
  })

  it('renders nothing when there are no overlaps', () => {
    useConsoleStore.getState().hydrateTeam({ ...mockTeamSnapshot, overlaps: [] })
    const { container } = render(<OverlapBanner />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})

describe('R-10 AgentGrid and AgentCard', () => {
  it('shows the Team heading, hint and all 6 agent cards with status labels', () => {
    const { container } = render(<AgentGrid />)
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByText('Click an agent to inspect what it is doing')).toBeInTheDocument()
    for (const name of ['lead', 'api-designer', 'backend-impl', 'ui-builder', 'test-writer', 'reviewer'])
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Running')).toHaveLength(3)
    expect(screen.getAllByText('Waiting')).toHaveLength(1)
    expect(screen.getAllByText('Needs you')).toHaveLength(1)
    expect(screen.getAllByText('Done')).toBeTruthy()
    expect(screen.getAllByText('dotnet test --filter "Category=Export"').length).toBeGreaterThan(0)
    expect(container).toHaveTextContent('⎇ feat/backend-auth')
    expect(container).toHaveTextContent('17m 05s')
    expect(container).toHaveTextContent('241k tok')
    expect(container).toHaveTextContent('31 calls')
  })

  it('the selected agent card (be) has aria-pressed=true, others false', () => {
    render(<AgentGrid />)
    const cards = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
    expect(cards).toHaveLength(6)
    expect(cards.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /backend-impl/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking the test-writer card selects it in the store', async () => {
    render(<AgentGrid />)
    const card = screen.getByRole('button', { name: /test-writer/ })
    expect(card).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(card)
    expect(useConsoleStore.getState().selectedAgentId).toBe('test')
    expect(screen.getByRole('button', { name: /test-writer/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /backend-impl/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('AgentCard renders standalone and calls onSelect with the agent id', async () => {
    const agent = mockTeamSnapshot.agents.find((a) => a.id === 'test')!
    const onSelect = vi.fn()
    render(<AgentCard agent={agent} status="needs-you" selected onSelect={onSelect} />)
    const card = screen.getByRole('button', { name: /test-writer/ })
    expect(card).toHaveAttribute('type', 'button')
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).getByText('Needs you')).toBeInTheDocument()
    await userEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith('test')
  })
})

describe('R-10 Timeline', () => {
  it('shows the title, legend and ticks', () => {
    render(<Timeline />)
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText(/last 20 min/)).toBeInTheDocument()
    for (const l of ['Thinking', 'Read / Grep', 'Edit', 'Bash', 'Error'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0)
    for (const t of ['10:24', '10:29', '10:34', '10:39', 'now']) expect(screen.getByText(t)).toBeInTheDocument()
  })

  it('has one labelled lane per agent with positioned segments', () => {
    render(<Timeline />)
    const lanes = screen.getAllByRole('img')
    expect(lanes).toHaveLength(6)
    const lane = screen.getByRole('img', { name: 'backend-impl activity, last 20 minutes' })
    expect(within(lane).getAllByTitle(/.+/)).toHaveLength(8)
    const first = within(lane).getAllByTitle('read')[0]!
    expect(first.style.left).toBe('4%')
    expect(first.style.width).toBe('8%')
    const lead = screen.getByRole('img', { name: 'lead activity, last 20 minutes' })
    expect(within(lead).getAllByTitle(/.+/)).toHaveLength(7)
  })
})

describe('R-10 LeadConsole', () => {
  it('shows the header, event lines and the prompt', () => {
    render(<LeadConsole />)
    expect(screen.getByText('Lead console')).toBeInTheDocument()
    expect(screen.getByText('Created team "sheet-export", 4 worktrees, 6 tasks')).toBeInTheDocument()
    expect(screen.getByText('Running export tests (31/48)…')).toBeInTheDocument()
    expect(screen.getAllByText('10:24:00').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Message the lead')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Message the lead, @agent to talk to a teammate/)).toBeInTheDocument()
  })

  it('shows agent display names (not ids) and "you"', () => {
    render(<LeadConsole />)
    expect(screen.getAllByText('you').length).toBeGreaterThan(0)
    expect(screen.getAllByText('api-designer').length).toBeGreaterThan(0)
    expect(screen.getAllByText('test-writer').length).toBeGreaterThan(0)
    expect(screen.queryByText('api')).toBeNull()
  })

  it('typing hi + Enter appends a line and clears the input', async () => {
    render(<LeadConsole />)
    const input = screen.getByLabelText('Message the lead') as HTMLInputElement
    await userEvent.type(input, 'hi{Enter}')
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(input.value).toBe('')
    const lines = useConsoleStore.getState().team.console
    expect(lines.at(-1)).toMatchObject({ who: 'you', text: 'hi' })
  })

  it('shows the command hints only when the draft starts with /', async () => {
    render(<LeadConsole />)
    expect(screen.queryByText('/pause')).toBeNull()
    await userEvent.type(screen.getByLabelText('Message the lead'), '/')
    expect(screen.getByText('/pause')).toBeInTheDocument()
    expect(screen.getByText('/stop')).toBeInTheDocument()
    expect(screen.getByText('/status')).toBeInTheDocument()
  })

  it('the Raw terminal toggle shows the placeholder and hides the event list', async () => {
    render(<LeadConsole />)
    const toggle = screen.getByRole('button', { name: 'Raw terminal' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Raw terminal: placeholder until Phase 2')).toBeNull()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Raw terminal: placeholder until Phase 2')).toBeVisible()
    expect(screen.queryByText('Created team "sheet-export", 4 worktrees, 6 tasks')).toBeNull()
    expect(useConsoleStore.getState().rawTerminalOpen).toBe(true)
    await userEvent.click(toggle)
    expect(screen.getByText('Created team "sheet-export", 4 worktrees, 6 tasks')).toBeInTheDocument()
  })
})

describe('R-10 RawTerminalPane', () => {
  it('renders fallback text, opens xterm with a placeholder message, disposes on unmount', async () => {
    const { unmount } = render(<RawTerminalPane />)
    expect(screen.getByText('Raw terminal: placeholder until Phase 2')).toBeInTheDocument()
    await waitFor(() => expect(xterm.open).toHaveBeenCalled())
    await waitFor(() => expect(xterm.write).toHaveBeenCalled())
    expect(String(xterm.write.mock.calls[0]![0])).toContain('placeholder')
    unmount()
    await waitFor(() => expect(xterm.dispose).toHaveBeenCalled())
  })
})
