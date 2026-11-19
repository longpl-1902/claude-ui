// @vitest-environment jsdom
import './jestDom'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTeamSnapshot } from '@shared/mock'
import type { Agent, FileDiff, SharedTask, WorkspaceSnapshot, WorktreeInfo } from '@shared/types'
import { OverlapBanner } from '@renderer/components/team/OverlapBanner'
import { SharedTaskList } from '@renderer/components/team/SharedTaskList'
import { Timeline } from '@renderer/components/team/Timeline'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore'
import { seedDemoTeam } from './seedTeam'

const ROOT = 'D:/repo'
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const MIN = 60_000

function agent(id: string, name: string, cwd: string, over: Partial<Agent> = {}): Agent {
  const base = structuredClone(mockTeamSnapshot.agents[0]!)
  return {
    ...base,
    id,
    name,
    initials: name.slice(0, 2).toUpperCase(),
    cwd,
    worktree: '',
    runtime: {
      kind: id === 'lead' ? 'lead' : 'teammate',
      startedMs: 0,
      lastActivityMs: NOW,
      openTools: [],
      lastTurn: 'assistant_end'
    },
    ...over
  } as Agent
}

function wt(path: string, branch: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path,
    branch,
    head: 'abc',
    detached: false,
    isMain: false,
    ahead: 0,
    behind: 0,
    files: [],
    changedFiles: 0,
    ...over
  }
}

function snapshot(worktrees: WorktreeInfo[], overlaps: WorkspaceSnapshot['overlaps'] = []): WorkspaceSnapshot {
  return { root: ROOT, base: 'main', worktrees, overlaps, updatedAt: '' }
}

const f = (path: string) => ({ path, status: 'M' as const, committed: false, uncommitted: true })

function seedLive(agents: Agent[], tasks: SharedTask[] = []): void {
  const team = {
    ...structuredClone(mockTeamSnapshot),
    source: 'live' as const,
    agents,
    tasks,
    worktrees: [],
    overlaps: []
  }
  useConsoleStore.setState({ team, teamMode: 'live', selectedAgentId: agents[0]?.id ?? '', nowMs: NOW })
}

const openInEditor = vi.fn().mockResolvedValue({ ok: true })
const compare = vi.fn()

beforeEach(() => {
  resetConsoleStore()
  useWorkspaceStore.setState({ workspace: null, watchedRoot: null, compare: null })
  openInEditor.mockClear()
  compare.mockReset()
  ;(window as unknown as { api: unknown }).api = { worktree: { openInEditor }, git: { compare } }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

const TWO_WT = (): WorkspaceSnapshot =>
  snapshot(
    [
      wt('D:/repo-wt/feat-x', 'feat/x', { ahead: 2, behind: 1, changedFiles: 1, files: [f('src/a.ts')] }),
      wt(ROOT, 'main', { isMain: true, changedFiles: 2, files: [f('src/a.ts'), f('src/b.ts')], error: 'fetch failed' })
    ],
    [{ path: 'src/a.ts', worktrees: [ROOT, 'D:/repo-wt/feat-x'] }]
  )

describe('WorktreeList (live)', () => {
  it('asks for a git project when nothing is watched', () => {
    seedLive([agent('lead', 'lead', ROOT)])
    render(<WorktreeList />)
    expect(screen.getByText('Pick a git project to see worktrees')).toBeInTheDocument()
  })

  it('shows a loading line until the snapshot arrives', () => {
    seedLive([agent('lead', 'lead', ROOT)])
    useWorkspaceStore.setState({ watchedRoot: ROOT })
    render(<WorktreeList />)
    expect(screen.getByText(/Loading worktrees/)).toBeInTheDocument()
  })

  it('renders cards main first with agents, ahead/behind, changed, error and overlap', async () => {
    seedLive([agent('lead', 'lead', ROOT), agent('bob', 'bob', 'D:/repo-wt/feat-x/src')])
    useWorkspaceStore.setState({ watchedRoot: ROOT, workspace: TWO_WT() })
    const { container } = render(<WorktreeList />)
    const branches = [...container.querySelectorAll('.ac-wt__branch')].map((n) => n.textContent)
    expect(branches).toEqual(['main', 'feat/x'])
    const cards = container.querySelectorAll('.ac-wt')
    const feat = cards[1] as HTMLElement
    expect(feat).toHaveClass('ac-wt--warn')
    expect(feat).toHaveTextContent('+2 / -1')
    expect(feat).toHaveTextContent('1 changed')
    expect(feat).toHaveTextContent('overlaps main')
    expect(within(feat).getByRole('button', { name: 'Select bob' })).toBeInTheDocument()
    const main = cards[0] as HTMLElement
    expect(main).toHaveTextContent('2 changed')
    expect(main).toHaveTextContent('fetch failed')
    expect(main).not.toHaveTextContent('+0 / -0')
    expect(within(main).getByRole('button', { name: 'Select lead' })).toBeInTheDocument()
    expect(screen.getByTitle('D:/repo-wt/feat-x')).toBeInTheDocument()
    await userEvent.click(within(feat).getByRole('button', { name: 'Open feat/x in editor' }))
    expect(openInEditor).toHaveBeenCalledWith('D:/repo-wt/feat-x')
  })

  it('clicking an agent avatar selects that agent', async () => {
    seedLive([agent('lead', 'lead', ROOT), agent('bob', 'bob', 'D:/repo-wt/feat-x')])
    useWorkspaceStore.setState({ watchedRoot: ROOT, workspace: TWO_WT() })
    render(<WorktreeList />)
    await userEvent.click(screen.getByRole('button', { name: 'Select bob' }))
    expect(useConsoleStore.getState().selectedAgentId).toBe('bob')
  })

  it('a clean worktree without overlap has no amber border and hides ahead/behind', () => {
    seedLive([agent('lead', 'lead', ROOT)])
    useWorkspaceStore.setState({ watchedRoot: ROOT, workspace: snapshot([wt(ROOT, 'main', { isMain: true })]) })
    const { container } = render(<WorktreeList />)
    expect(container.querySelector('.ac-wt--warn')).toBeNull()
    expect(container).not.toHaveTextContent('/ -')
  })

  it('narrow width: long branch and path ellipsize with title tooltips, no fixed heights', () => {
    const long = 'feature/' + 'very-long-branch-name-'.repeat(5)
    seedLive([agent('lead', 'lead', ROOT)])
    useWorkspaceStore.setState({
      watchedRoot: ROOT,
      workspace: snapshot([wt('D:/elsewhere/' + 'deep/'.repeat(12) + 'wt', long, { isMain: true })])
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    const { container } = render(<WorktreeList />)
    expect(screen.getByTitle(long)).toHaveClass('ac-wt__branch')
    const path = container.querySelector('.ac-wt__path') as HTMLElement
    expect(path.getAttribute('title')).toContain('deep/deep/')
    expect(path.style.height).toBe('')
  })
})

describe('OverlapBanner + CompareDiffsDialog (live)', () => {
  const diffs: FileDiff[] = [
    { worktreePath: ROOT, branch: 'main', diff: '@@ -1 +1 @@\n-old\n+new', truncated: false },
    { worktreePath: 'D:/repo-wt/feat-x', branch: 'feat/x', diff: '+other', truncated: true }
  ]

  function seed(): void {
    seedLive([agent('lead', 'Alice', ROOT), agent('bob', 'Bob', 'D:/repo-wt/feat-x')])
    useWorkspaceStore.setState({ watchedRoot: ROOT, workspace: TWO_WT() })
  }

  it('renders nothing without overlaps', () => {
    seedLive([agent('lead', 'lead', ROOT)])
    useWorkspaceStore.setState({ watchedRoot: ROOT, workspace: snapshot([wt(ROOT, 'main', { isMain: true })]) })
    const { container } = render(<OverlapBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the file, branches and agents, and lists at most 3 files plus "+N more"', () => {
    seed()
    const files = ['a', 'b', 'c', 'd', 'e'].map((x) => `src/${x}.ts`)
    useWorkspaceStore.setState({
      workspace: snapshot(
        [
          wt(ROOT, 'main', { isMain: true, files: files.map(f) }),
          wt('D:/repo-wt/feat-x', 'feat/x', { files: files.map(f) })
        ],
        files.map((p) => ({ path: p, worktrees: [ROOT, 'D:/repo-wt/feat-x'] }))
      )
    })
    render(<OverlapBanner />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('src/a.ts changed in main (Alice) and feat/x (Bob)')
    expect(alert).toHaveTextContent('src/c.ts')
    expect(alert).not.toHaveTextContent('src/d.ts')
    expect(alert).toHaveTextContent('+2 more')
  })

  it('Compare diffs opens the dialog with one column per worktree; Esc closes', async () => {
    seed()
    compare.mockResolvedValue(diffs)
    render(<OverlapBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'Compare diffs' }))
    const dlg = await screen.findByRole('dialog', { name: 'Compare diffs' })
    expect(compare).toHaveBeenCalledWith(ROOT, 'src/a.ts')
    expect(await within(dlg).findByText('feat/x')).toBeInTheDocument()
    expect(within(dlg).getByText('main')).toBeInTheDocument()
    expect(within(dlg).getByText('+new')).toHaveClass('ac-cmp__line--add')
    expect(within(dlg).getByText('-old')).toHaveClass('ac-cmp__line--del')
    expect(within(dlg).getByText('truncated')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useWorkspaceStore.getState().compare).toBeNull()
  })

  it('shows loading and error states', async () => {
    seed()
    compare.mockRejectedValue(new Error('git exploded'))
    render(<OverlapBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'Compare diffs' }))
    expect(await screen.findByText('git exploded')).toBeInTheDocument()
    act(() => useWorkspaceStore.setState({ compare: { path: 'src/a.ts', diffs: [], loading: true } }))
    expect(screen.getByText(/Loading diffs/)).toBeInTheDocument()
  })

  it('the file select switches the compared file', async () => {
    seed()
    useWorkspaceStore.setState({
      workspace: snapshot(
        [wt(ROOT, 'main', { isMain: true }), wt('D:/repo-wt/feat-x', 'feat/x')],
        [
          { path: 'src/a.ts', worktrees: [ROOT, 'D:/repo-wt/feat-x'] },
          { path: 'src/b.ts', worktrees: [ROOT, 'D:/repo-wt/feat-x'] }
        ]
      )
    })
    compare.mockResolvedValue(diffs)
    render(<OverlapBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'Compare diffs' }))
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'src/b.ts')
    expect(compare).toHaveBeenLastCalledWith(ROOT, 'src/b.ts')
  })

  it('narrow width: banner text is a flexible span (no fixed width) and the button stays', () => {
    seed()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    render(<OverlapBanner />)
    const text = screen.getByRole('alert').querySelector('.ac-tc-banner__text') as HTMLElement
    expect(text.style.width).toBe('')
    expect(screen.getByRole('button', { name: 'Compare diffs' })).toBeInTheDocument()
  })
})

describe('SharedTaskList (live)', () => {
  const task = (id: number, state: SharedTask['state'], over: Partial<SharedTask> = {}): SharedTask => ({
    id,
    title: `task ${id}`,
    state,
    ownerAgentId: 'lead',
    ...over
  })

  it('shows the empty message', () => {
    seedLive([agent('lead', 'lead', ROOT)], [])
    render(<SharedTaskList />)
    expect(screen.getByText('No tasks in this session (TaskCreate / TodoWrite)')).toBeInTheDocument()
  })

  it('sorts in progress, failing, blocked, pending, done and renders the pills', () => {
    seedLive(
      [agent('lead', 'lead', ROOT)],
      [
        task(1, 'done'),
        task(2, 'pending'),
        task(3, 'blocked', { blockedBy: 2 }),
        task(4, 'failing', { failingCount: 3 }),
        task(5, 'in_progress')
      ]
    )
    const { container } = render(<SharedTaskList />)
    const rows = [...container.querySelectorAll('.ac-task')]
    expect(rows.map((r) => r.querySelector('.ac-task__title')?.textContent)).toEqual([
      '#5 task 5',
      '#4 task 4',
      '#3 task 3',
      '#2 task 2',
      '#1 task 1'
    ])
    expect(rows.map((r) => r.querySelector('.ac-task__pill')?.textContent)).toEqual([
      'in progress',
      'failing ×3',
      'blocked by #2',
      'to do',
      'done'
    ])
    expect(rows[0]).toHaveTextContent('lead')
    expect(rows[1]!.querySelector('.ac-task__pill')).toHaveClass('ac-task__pill--failing')
  })

  it('narrow width: long titles stay in a wrapping body block', () => {
    seedLive([agent('lead', 'lead', ROOT)], [task(1, 'pending', { title: 'x'.repeat(200) })])
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    const { container } = render(<SharedTaskList />)
    expect(container.querySelector('.ac-task__title')).toHaveTextContent('x'.repeat(200))
    expect((container.querySelector('.ac-task__body') as HTMLElement).style.width).toBe('')
  })
})

describe('Timeline (live)', () => {
  const clock = (ms: number): string => {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const spans = (list: [string, number, number | null][]) =>
    list.map(([kind, s, e]) => ({ kind, startMs: s, endMs: e })) as NonNullable<Agent['spans']>

  it('says when there is no activity', () => {
    seedLive([agent('lead', 'lead', ROOT, { spans: [] })])
    render(<Timeline />)
    expect(screen.getByText('No activity in the last 20 minutes')).toBeInTheDocument()
  })

  it('computes segment percentages over the 20 minute window, open spans end at now', () => {
    seedLive([
      agent('lead', 'lead', ROOT, {
        spans: spans([
          ['read', NOW - 15 * MIN, NOW - 10 * MIN],
          ['edit', NOW - 5 * MIN, null],
          ['bash', NOW - 30 * MIN, NOW - 25 * MIN],
          ['think', NOW - 21 * MIN, NOW - 19 * MIN]
        ])
      })
    ])
    render(<Timeline />)
    const lane = screen.getByRole('img', { name: 'lead activity, last 20 minutes' })
    const read = within(lane).getByTitle(`read ${clock(NOW - 15 * MIN)}-${clock(NOW - 10 * MIN)}`)
    expect(read.style.left).toBe('25%')
    expect(read.style.width).toBe('25%')
    const edit = within(lane).getByTitle(`edit ${clock(NOW - 5 * MIN)}-${clock(NOW)}`)
    expect(edit.style.left).toBe('75%')
    expect(edit.style.width).toBe('25%')
    expect(within(lane).queryByTitle(/^bash/)).toBeNull()
    const think = within(lane).getByTitle(/^think/)
    expect(think.style.left).toBe('0%')
    expect(think.style.width).toBe('5%')
    for (const t of ['-20m', '-15m', '-10m', '-5m', 'now']) expect(screen.getByText(t)).toBeInTheDocument()
    for (const l of ['Thinking', 'Edit', 'Bash', 'Error']) expect(screen.getAllByText(l).length).toBeGreaterThan(0)
  })

  it('lanes only for the lead and unfinished agents; finished collapse behind a toggle', async () => {
    const sp = spans([['edit', NOW - 5 * MIN, NOW - MIN]])
    const done = (id: string): Agent =>
      agent(id, id, ROOT, {
        spans: sp,
        runtime: { kind: 'teammate', startedMs: 0, lastActivityMs: NOW, openTools: [], lastTurn: 'assistant_end', finished: true }
      })
    seedLive([agent('lead', 'lead', ROOT, { spans: sp }), agent('w1', 'w1', ROOT, { spans: sp, runtime: { kind: 'teammate', startedMs: 0, lastActivityMs: NOW, openTools: [], lastTurn: 'user' } }), done('old1'), done('old2')])
    render(<Timeline />)
    const names = () => screen.getAllByRole('img').map((n) => n.getAttribute('aria-label'))
    expect(names()).toEqual(['lead activity, last 20 minutes', 'w1 activity, last 20 minutes'])
    expect(screen.getByText('2 finished')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show finished' }))
    expect(names()).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Hide finished' })).toBeInTheDocument()
  })

  it('narrow width: the live lane grid uses the flexible modifier class (no 560px minimum)', () => {
    seedLive([agent('lead', 'lead', ROOT, { spans: spans([['edit', NOW - 2 * MIN, NOW - MIN]]) })])
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    const { container } = render(<Timeline />)
    expect(container.querySelector('.ac-tc-tl')).toHaveClass('ac-tc-tl--live')
  })
})

describe('demo mode keeps the mock rendering', () => {
  beforeEach(() => seedDemoTeam())
  it('worktrees, tasks, timeline and banner', () => {
    render(
      <>
        <WorktreeList />
        <SharedTaskList />
        <Timeline />
        <OverlapBanner />
      </>
    )
    expect(screen.getByRole('button', { name: 'Add worktree' })).toBeInTheDocument()
    expect(screen.getByText('.worktrees/api-schema')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('File overlap:')
    expect(screen.getByText('10:24')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shared tasks' })).toBeInTheDocument()
  })
})
