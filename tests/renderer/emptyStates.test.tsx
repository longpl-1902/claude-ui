// @vitest-environment jsdom
import './jestDom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGrid } from '@renderer/components/team/AgentGrid'
import { shortTarget } from '@renderer/components/team/AgentCard'
import { HooksDialog } from '@renderer/components/team/HooksDialog'
import { ErrorBanner } from '@renderer/components/ui/ErrorBanner'
import { REASON_TEXT, reasonText } from '@renderer/components/ui/reasonText'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore'
import { seedDemoTeam } from './seedTeam'

const KNOWN = [
  'account-locked', 'unknown-account', 'pty-unavailable', 'claude-not-found', 'invalid-folder',
  'needs-confirmation', 'invalid-args', 'spawn-failed',
  'app-owned', 'not-registered', 'not-running', 'unexpected-process', 'invalid-path', 'opened-folder',
  'no-project', 'node-not-found', 'invalid-json',
  'changed-since-preview', 'expired', 'nothing-to-do', 'not-object',
  'session-live-elsewhere', 'nothing-running'
]

function mockMedia(narrow: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: narrow && q.includes('max-width'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  resetConsoleStore()
  window.localStorage.clear()
  mockMedia(false)
})
afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('reasonText', () => {
  it.each(KNOWN)('maps %s to a real sentence (no fallback)', (r) => {
    const t = reasonText(r)
    expect(t).toBe(REASON_TEXT[r])
    expect(t).not.toContain('Something went wrong')
    expect(t.length).toBeGreaterThan(20)
    expect(t.endsWith('.')).toBe(true)
  })
  it('uses the node-not-found wording from the task', () => {
    expect(reasonText('node-not-found')).toBe(
      'Node.js was not found on PATH. Install Node 18+ to use hooks, then reopen this dialog.'
    )
  })
  it('falls back for unknown or missing reasons', () => {
    expect(reasonText('weird')).toBe('Something went wrong (weird).')
    expect(reasonText()).toBe('Something went wrong (unknown).')
  })
})

describe('ErrorBanner', () => {
  it('renders role alert and a labelled dismiss button', async () => {
    const onDismiss = vi.fn()
    render(<ErrorBanner message="Boom happened" onDismiss={onDismiss} action={<button>Retry</button>} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Boom happened')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
  it('has no dismiss button without a handler and keeps the full text in the title', () => {
    render(<ErrorBanner message="short" title="the full long text" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('short')).toHaveAttribute('title', 'the full long text')
  })
})

describe('HooksDialog failure messages', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = { hooks: { status: vi.fn(), preview: vi.fn(), apply: vi.fn() } }
    useWorkspaceStore.setState({ watchedRoot: 'D:/p', hooks: null, hooksPreview: null, hooksError: undefined })
  })
  it('shows the mapped sentence for a known reason and lets it be dismissed', async () => {
    useWorkspaceStore.setState({ hooksError: 'node-not-found' })
    render(<HooksDialog open onClose={() => undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Install Node 18+ to use hooks')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('maps the status reason too, and shows free text unchanged', () => {
    useWorkspaceStore.setState({
      hooks: { projectRoot: 'D:/p', settingsPath: null, state: 'unavailable', reason: 'invalid-json', server: { listening: false }, eventsReceived: 0 },
      hooksError: 'disk is on fire'
    })
    render(<HooksDialog open onClose={() => undefined} />)
    expect(screen.getByText(REASON_TEXT['invalid-json']!)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('disk is on fire')
  })
})

describe('AgentGrid empty states', () => {
  it('live with no agents shows the new guidance copy', () => {
    useConsoleStore.setState({ teamMode: 'live', team: { ...useConsoleStore.getState().team, agents: [], waitingForSession: false } })
    render(<AgentGrid />)
    expect(screen.getByText('No agents yet - start a session or pick one above')).toBeInTheDocument()
  })
  it('waiting for the session keeps its own copy', () => {
    useConsoleStore.setState({ teamMode: 'live', team: { ...useConsoleStore.getState().team, agents: [], waitingForSession: true } })
    render(<AgentGrid />)
    expect(screen.getByText(/Waiting for the session to start/)).toBeInTheDocument()
  })
})

describe('AgentGrid S3: density and finished sub-agents', () => {
  const seedWithChildren = (): void => {
    seedDemoTeam()
    const team = structuredClone(useConsoleStore.getState().team)
    team.agents.forEach((a, i) => {
      if (i > 0) a.depth = 1
    })
    useConsoleStore.setState({ team })
  }

  it('collapses finished sub-agents into one row and expands inline', async () => {
    seedWithChildren()
    const total = useConsoleStore.getState().team.agents.length
    const { container } = render(<AgentGrid />)
    const row = screen.getByRole('button', { name: /\d+ done · .* tok/ })
    const doneCount = Number(/(\d+) done/.exec(row.textContent ?? '')![1])
    expect(doneCount).toBeGreaterThan(0)
    expect(container.querySelectorAll('.ac-card').length).toBe(total - doneCount)
    expect(within(row).getByText('Show')).toBeInTheDocument()
    await userEvent.click(row)
    expect(container.querySelectorAll('.ac-card').length).toBe(total)
    expect(within(row).getByText('Hide')).toBeInTheDocument()
  })

  it('keeps the status order: needs-you, running, waiting, then done', async () => {
    seedWithChildren()
    const { container } = render(<AgentGrid />)
    await userEvent.click(screen.getByRole('button', { name: /\d+ done/ }))
    const pills = [...container.querySelectorAll('.ac-pill')].map((p) => p.textContent ?? '')
    const rank = ['Needs you', 'Running', 'Waiting', 'Done']
    const idx = pills.map((p) => rank.indexOf(p))
    expect(idx.length).toBeGreaterThan(1)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })

  it('density toggle switches to one-row cards and persists in ac.gridDensity', async () => {
    seedDemoTeam()
    const { container } = render(<AgentGrid />)
    expect(container.querySelector('.ac-card--compact')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }))
    expect(container.querySelectorAll('.ac-card--compact').length).toBe(useConsoleStore.getState().team.agents.length)
    expect(window.localStorage.getItem('ac.gridDensity')).toBe('compact')
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true')
  })

  it('restores compact density from localStorage', () => {
    window.localStorage.setItem('ac.gridDensity', 'compact')
    seedDemoTeam()
    const { container } = render(<AgentGrid />)
    expect(container.querySelector('.ac-card--compact')).not.toBeNull()
  })

  it('narrow width forces compact rows and hides the toggle', () => {
    mockMedia(true)
    seedDemoTeam()
    const { container } = render(<AgentGrid />)
    expect(container.querySelectorAll('.ac-card--compact').length).toBe(useConsoleStore.getState().team.agents.length)
    expect(screen.queryByRole('radiogroup', { name: 'Card density' })).toBeNull()
  })

  it('shortTarget keeps the last two path segments only for paths', () => {
    expect(shortTarget('D:\\work\\repo\\src\\App.tsx')).toBe('…/src/App.tsx')
    expect(shortTarget('src/App.tsx')).toBe('src/App.tsx')
    expect(shortTarget('npm run test -- --watch')).toBe('npm run test -- --watch')
  })
})
