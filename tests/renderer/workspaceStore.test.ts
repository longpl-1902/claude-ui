// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, HooksPreview, HooksStatus, WorkspaceSnapshot, WorktreeInfo } from '@shared/types'
import { selectWorktreeViews, useWorkspaceStore } from '@renderer/store/useWorkspaceStore'

const s = () => useWorkspaceStore.getState()

const wt = (path: string, branch: string, files: string[], isMain = false): WorktreeInfo => ({
  path,
  branch,
  head: 'abc',
  detached: false,
  isMain,
  ahead: 1,
  behind: 0,
  files: files.map((p) => ({ path: p, status: 'M', committed: false, uncommitted: true })),
  changedFiles: files.length
})
const snap = (root: string | null, worktrees: WorktreeInfo[] = [], overlaps: { path: string; worktrees: string[] }[] = []): WorkspaceSnapshot => ({
  root,
  base: 'main',
  worktrees,
  overlaps,
  updatedAt: '2026-01-01T00:00:00Z'
})
const hooksStatus = (projectRoot: string | null): HooksStatus => ({
  projectRoot,
  settingsPath: null,
  state: 'not-installed',
  server: { listening: true },
  eventsReceived: 0
})
const preview: HooksPreview = {
  previewId: 'p1',
  action: 'install',
  settingsPath: '/r/.claude/settings.local.json',
  before: null,
  after: '{}',
  scriptPath: '/s.js',
  notes: []
}

function mockApi() {
  let gitCb: (x: WorkspaceSnapshot) => void = () => {}
  let hooksCb: (x: HooksStatus) => void = () => {}
  const git = {
    watch: vi.fn(async (root: string | null) => snap(root)),
    compare: vi.fn(async () => [{ worktreePath: '/r', diff: 'd', truncated: false }]),
    onChanged: vi.fn((cb: (x: WorkspaceSnapshot) => void) => {
      gitCb = cb
      return vi.fn()
    })
  }
  const hooks = {
    status: vi.fn(async (root: string | null) => hooksStatus(root)),
    preview: vi.fn(async (): Promise<HooksPreview | { ok: boolean; reason?: string }> => preview),
    apply: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn((cb: (x: HooksStatus) => void) => {
      hooksCb = cb
      return vi.fn()
    })
  }
  ;(window as unknown as { api: unknown }).api = { git, hooks }
  return { git, hooks, pushGit: (x: WorkspaceSnapshot) => gitCb(x), pushHooks: (x: HooksStatus) => hooksCb(x) }
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: null, watchedRoot: null, compare: null, hooks: null, hooksPreview: null, hooksError: undefined })
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('watch', () => {
  it('watches a root, loads the snapshot and hooks status, and no-ops when unchanged', async () => {
    const m = mockApi()
    await s().watch('/r')
    expect(m.git.watch).toHaveBeenCalledWith('/r')
    expect(m.hooks.status).toHaveBeenCalledWith('/r')
    expect(s().workspace?.root).toBe('/r')
    expect(s().hooks?.projectRoot).toBe('/r')
    await s().watch('/r')
    expect(m.git.watch).toHaveBeenCalledTimes(1)
    expect(m.hooks.status).toHaveBeenCalledTimes(1)
  })

  it('watch(null) clears the workspace', async () => {
    const m = mockApi()
    await s().watch('/r')
    await s().watch(null)
    expect(m.git.watch).toHaveBeenLastCalledWith(null)
    expect(s().watchedRoot).toBeNull()
  })

  it('is harmless without window.api', async () => {
    await expect(s().watch('/r')).resolves.toBeUndefined()
    expect(s().watchedRoot).toBe('/r')
  })
})

describe('pushes', () => {
  it('applies pushes for the watched root and ignores other roots', async () => {
    const m = mockApi()
    const off = s().init()
    await s().watch('/r')
    m.pushGit(snap('/other', [wt('/other', 'x', [])]))
    expect(s().workspace?.worktrees).toHaveLength(0)
    m.pushGit(snap('/r', [wt('/r', 'main', ['a.ts'], true)]))
    expect(s().workspace?.worktrees).toHaveLength(1)
    m.pushHooks({ ...hooksStatus('/other'), eventsReceived: 9 })
    expect(s().hooks?.eventsReceived).toBe(0)
    m.pushHooks({ ...hooksStatus('/r'), eventsReceived: 5 })
    expect(s().hooks?.eventsReceived).toBe(5)
    off()
  })
})

describe('compare', () => {
  it('opens a compare, stores diffs and closes it', async () => {
    const m = mockApi()
    await s().watch('/r')
    await s().openCompare('a.ts')
    expect(m.git.compare).toHaveBeenCalledWith('/r', 'a.ts')
    expect(s().compare).toMatchObject({ path: 'a.ts', loading: false })
    expect(s().compare?.diffs).toHaveLength(1)
    s().closeCompare()
    expect(s().compare).toBeNull()
  })

  it('records an error when compare rejects', async () => {
    const m = mockApi()
    await s().watch('/r')
    m.git.compare.mockRejectedValueOnce(new Error('bad'))
    await s().openCompare('a.ts')
    expect(s().compare).toMatchObject({ loading: false, error: 'bad' })
  })
})

describe('hooks', () => {
  it('preview then apply refreshes status and clears the preview', async () => {
    const m = mockApi()
    await s().watch('/r')
    await s().previewHooks('install')
    expect(m.hooks.preview).toHaveBeenCalledWith('/r', 'install')
    expect(s().hooksPreview?.previewId).toBe('p1')
    const before = m.hooks.status.mock.calls.length
    expect(await s().applyHooks()).toEqual({ ok: true })
    expect(m.hooks.apply).toHaveBeenCalledWith('p1')
    expect(s().hooksPreview).toBeNull()
    expect(m.hooks.status.mock.calls.length).toBe(before + 1)
  })

  it('a refused preview sets hooksError', async () => {
    const m = mockApi()
    await s().watch('/r')
    m.hooks.preview.mockResolvedValueOnce({ ok: false, reason: 'node-missing' })
    await s().previewHooks('install')
    expect(s().hooksPreview).toBeNull()
    expect(s().hooksError).toBe('node-missing')
  })

  it('a failed apply keeps the preview and sets hooksError', async () => {
    const m = mockApi()
    await s().watch('/r')
    await s().previewHooks('install')
    m.hooks.apply.mockResolvedValueOnce({ ok: false, reason: 'stale' } as { ok: boolean })
    expect((await s().applyHooks()).ok).toBe(false)
    expect(s().hooksPreview).not.toBeNull()
    expect(s().hooksError).toBe('stale')
  })

  it('applyHooks without a preview is a no-op failure; clearPreview clears', async () => {
    const m = mockApi()
    expect((await s().applyHooks()).ok).toBe(false)
    expect(m.hooks.apply).not.toHaveBeenCalled()
    useWorkspaceStore.setState({ hooksPreview: preview })
    s().clearPreview()
    expect(s().hooksPreview).toBeNull()
  })
})

describe('selectWorktreeViews', () => {
  const agent = { id: 'ag1', cwd: '/r-wt/feat' } as unknown as Agent
  const ws = snap(
    '/r',
    [wt('/r', 'main', ['a.ts'], true), wt('/r-wt/feat', 'feat', ['a.ts', 'b.ts'])],
    [{ path: 'a.ts', worktrees: ['/r', '/r-wt/feat'] }]
  )

  it('maps agents to worktrees and overlaps', () => {
    const v = selectWorktreeViews(ws, [agent], 'linux')
    expect(v.worktrees).toHaveLength(2)
    expect(v.worktrees.find((w) => w.branch === 'feat')?.agentIds).toEqual(['ag1'])
    expect(v.worktrees.find((w) => w.branch === 'main')?.overlapsWith).toEqual(['feat'])
  })

  it('is memoised for identical inputs and empty for null', () => {
    const agents = [agent]
    expect(selectWorktreeViews(ws, agents, 'linux')).toBe(selectWorktreeViews(ws, agents, 'linux'))
    expect(selectWorktreeViews(null, [], 'linux')).toEqual({ worktrees: [], overlaps: [] })
  })
})
