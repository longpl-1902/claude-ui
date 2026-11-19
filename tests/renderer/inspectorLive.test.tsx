// @vitest-environment jsdom
import './jestDom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import type { Agent } from '@shared/types'
import { AccountCards } from '@renderer/components/accounts/AccountCards'
import { Inspector } from '@renderer/components/inspector/Inspector'
import { seedDemoTeam } from './seedTeam'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'

function liveAgent(over: Partial<Agent> = {}): Agent {
  const base = structuredClone(mockTeamSnapshot.agents[0]!)
  return {
    ...base,
    id: 'lead',
    name: 'lead',
    worktree: '',
    cwd: 'D:/work/some/very/long/project/path',
    runtime: {
      kind: 'lead',
      startedMs: 0,
      lastActivityMs: 0,
      openTools: [],
      lastTurn: 'end_turn'
    },
    activity: [
      { time: '10:00:01', tool: 'Bash', target: 'npm test', result: '…' },
      { time: '10:00:02', tool: 'Edit', target: 'a.ts', result: 'denied', failed: true }
    ],
    files: [{ path: 'src/a.ts', added: 7, removed: 3 }],
    messages: [
      { time: '10:01', direction: 'in', peer: 'lead', text: 'do the thing' },
      { time: '10:02', direction: 'out', peer: 'lead', text: 'done it' }
    ],
    ...over
  } as Agent
}

function seedLive(agents: Agent[]): void {
  const team = { ...structuredClone(mockTeamSnapshot), source: 'live' as const, agents }
  useConsoleStore.setState({ team, teamMode: 'live', selectedAgentId: agents[0]?.id ?? '' })
}

beforeEach(() => resetConsoleStore())

describe('Inspector on live data', () => {
  it('empty team: placeholder, no stats or tabs', () => {
    seedLive([])
    render(<Inspector />)
    expect(screen.getByText('Inspector')).toBeInTheDocument()
    expect(screen.getByText('No agents yet')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText('Elapsed')).toBeNull()
  })

  it('shows cwd and an em dash for a missing worktree', () => {
    seedLive([liveAgent()])
    render(<Inspector />)
    expect(screen.getByTitle('D:/work/some/very/long/project/path')).toBeInTheDocument()
    expect(screen.getByText('⎇ —')).toBeInTheDocument()
  })

  it('puts the status reason in the pill title', () => {
    seedLive([liveAgent()])
    const { container } = render(<Inspector />)
    const pill = container.querySelector('.ac-pill')!
    expect(pill.closest('[title]')!.getAttribute('title')).toBe('no activity yet')
  })

  it('Activity: open call reads running…, failed stays red', () => {
    seedLive([liveAgent()])
    render(<Inspector />)
    expect(screen.getByText('running…')).toBeInTheDocument()
    expect(screen.getByText('denied').closest('[class*="failed"]')).not.toBeNull()
  })

  it('Activity: empty text', () => {
    seedLive([liveAgent({ activity: [] })])
    render(<Inspector />)
    expect(screen.getByText('No tool calls yet')).toBeInTheDocument()
  })

  it('Files: +/- counts and disabled diff button outside demo', async () => {
    seedLive([liveAgent()])
    render(<Inspector />)
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }))
    expect(screen.getByText('+7')).toBeInTheDocument()
    expect(screen.getByText('−3')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Open full diff against main' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Diffs arrive in Phase 5')
  })

  it('Messages: in/out and the empty text', async () => {
    seedLive([liveAgent()])
    const { unmount } = render(<Inspector />)
    await userEvent.click(screen.getByRole('tab', { name: 'Messages' }))
    expect(screen.getByText('do the thing')).toBeInTheDocument()
    expect(screen.getByText(/to lead/)).toBeInTheDocument()
    expect(screen.getByText(/from lead/)).toBeInTheDocument()
    unmount()
    seedLive([liveAgent({ messages: [] })])
    render(<Inspector />)
    expect(
      screen.getByText("No messages. Shows the agent's task, its result, and SendMessage traffic.")
    ).toBeInTheDocument()
  })
})

describe('AccountCards tokens used today', () => {
  const id = (): string => mockAccountsSnapshot.accounts[0]!.id
  function setup(): void {
    useConsoleStore.getState().hydrateAccounts(structuredClone(mockAccountsSnapshot))
    render(<AccountCards adding={false} onAdd={() => undefined} onCloseAdd={() => undefined} />)
  }

  it('without usage shows an em dash', () => {
    useConsoleStore.setState({ usageToday: null })
    setup()
    const row = screen.getAllByText('Tokens used today')[0]!.parentElement!
    expect(row).toHaveTextContent('—')
  })

  it('with usage shows the headline (input + output + cache writes)', () => {
    useConsoleStore.setState({
      usageToday: { day: 'd', byAccount: { [id()]: { input: 1000, output: 500, cacheCreation: 500, cacheRead: 0 } } }
    })
    setup()
    const row = screen.getAllByText('Tokens used today')[0]!.parentElement!
    expect(row).toHaveTextContent('2k')
    expect(row).not.toHaveTextContent('cached')
  })

  it('with cache reads shows them separately', () => {
    useConsoleStore.setState({
      usageToday: { day: 'd', byAccount: { [id()]: { input: 1000, output: 500, cacheCreation: 500, cacheRead: 50000 } } }
    })
    setup()
    const row = screen.getAllByText('Tokens used today')[0]!.parentElement!
    expect(row).toHaveTextContent('2k')
    expect(row).toHaveTextContent('+50k cached')
    expect(row.querySelector('[title]')!.getAttribute('title')).toBe(
      'input + output + cache writes; cache reads shown separately'
    )
  })
})

describe('P3-C inspector actions and wrapping', () => {
  it('live without a controlled session: actions are disabled with reasons', () => {
    seedLive([liveAgent()])
    render(<Inspector />)
    expect(screen.getByRole('button', { name: 'Message agent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Message agent' })).toHaveAttribute('title', expect.stringContaining('VS Code'))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop process…' })).toBeDisabled()
  })
  it('demo: the three actions are enabled', () => {
    seedDemoTeam()
    render(<Inspector />)
    for (const n of ['Message agent', 'Pause', 'Stop']) expect(screen.getByRole('button', { name: n })).toBeEnabled()
  })
  it('activity CSS wraps long text without a horizontal scrollbar', () => {
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/components/inspector/inspector.css'), 'utf8')
    expect(css).toMatch(/\.insp-activity \{[^}]*overflow-x: hidden/)
    expect(css).toMatch(/\.insp-event__result \{[^}]*overflow-wrap: anywhere/)
    expect(css).toMatch(/\.insp-event__target \{[^}]*overflow-wrap: anywhere/)
  })
})
