// T03 / R-10: overlap detection and agent -> worktree mapping.
import { describe, expect, it } from 'vitest'
import { detectOverlaps, mapAgentsToWorktrees, toWorktreeViews, worktreeForCwd } from '@shared/overlap'

const wt = (path: string, branch: string | undefined, files: string[]) => ({ path, branch, files: files.map((p) => ({ path: p })) })

describe('R-10 detectOverlaps', () => {
  it('R-10 a file changed in two worktrees is reported once with both worktrees in input order', () => {
    const r = detectOverlaps([wt('/r', 'main', ['a.ts', 'b.ts']), wt('/r-wt1', 'feat', ['b.ts', 'c.ts'])])
    expect(r).toEqual([{ path: 'b.ts', worktrees: ['/r', '/r-wt1'] }])
  })
  it('R-10 three-way overlap lists all three; results are sorted by path', () => {
    const r = detectOverlaps([wt('/a', 'a', ['z.ts', 'k.ts']), wt('/b', 'b', ['k.ts', 'z.ts']), wt('/c', 'c', ['z.ts'])])
    expect(r).toEqual([
      { path: 'k.ts', worktrees: ['/a', '/b'] },
      { path: 'z.ts', worktrees: ['/a', '/b', '/c'] }
    ])
  })
  it('R-10 no overlap -> []', () => {
    expect(detectOverlaps([wt('/a', 'a', ['x.ts']), wt('/b', 'b', ['y.ts'])])).toEqual([])
    expect(detectOverlaps([])).toEqual([])
    expect(detectOverlaps([wt('/a', 'a', ['x.ts'])])).toEqual([])
  })
  it('R-10 the same file twice in ONE worktree is not an overlap', () => {
    expect(detectOverlaps([wt('/a', 'a', ['x.ts', 'x.ts']), wt('/b', 'b', ['y.ts'])])).toEqual([])
  })
})

describe('R-10 worktreeForCwd', () => {
  it('R-10 win32: D:/x matches d:\\x\\sub (case and slash insensitive) and returns the worktree path as given', () => {
    expect(worktreeForCwd('d:\\x\\sub', ['D:/x'], 'win32')).toBe('D:/x')
    expect(worktreeForCwd('D:/X/', ['D:/x'], 'win32')).toBe('D:/x')
  })
  it('R-10 the longest matching worktree wins (linked worktree inside the main folder)', () => {
    expect(worktreeForCwd('C:/Users/u/acme/.wt/feat/src', ['C:/Users/u/acme', 'C:/Users/u/acme/.wt/feat'], 'win32')).toBe('C:/Users/u/acme/.wt/feat')
  })
  it('R-10 prefix trap: /repo-a is not inside /repo', () => {
    expect(worktreeForCwd('/repo-a/src', ['/repo'], 'linux')).toBeNull()
    expect(worktreeForCwd('/repo/src', ['/repo-a', '/repo'], 'linux')).toBe('/repo')
  })
  it('R-10 posix is case sensitive', () => {
    expect(worktreeForCwd('/Home/u/acme', ['/home/u/acme'], 'linux')).toBeNull()
  })
  it('R-10 undefined / empty cwd -> null', () => {
    expect(worktreeForCwd(undefined, ['/r'], 'linux')).toBeNull()
    expect(worktreeForCwd('', ['/r'], 'linux')).toBeNull()
  })
  it('R-10 exact match', () => {
    expect(worktreeForCwd('/home/u/acme', ['/home/u/acme'], 'linux')).toBe('/home/u/acme')
  })
})

describe('R-10 mapAgentsToWorktrees', () => {
  it('R-10 groups agent ids by worktree; agents without cwd or outside every worktree are left out', () => {
    const m = mapAgentsToWorktrees(
      [{ id: 'lead', cwd: 'C:\\Users\\u\\acme' }, { id: 'a1', cwd: 'C:/Users/u/acme-wt/feat/src' }, { id: 'a2' }, { id: 'a3', cwd: 'D:/elsewhere' }],
      ['C:/Users/u/acme', 'C:/Users/u/acme-wt/feat'],
      'win32'
    )
    expect(m.get('C:/Users/u/acme')).toEqual(['lead'])
    expect(m.get('C:/Users/u/acme-wt/feat')).toEqual(['a1'])
    const all = [...m.values()].flat()
    expect(all).not.toContain('a2')
    expect(all).not.toContain('a3')
  })
  it('R-10 several agents in one worktree keep input order', () => {
    const m = mapAgentsToWorktrees([{ id: 'x', cwd: '/r' }, { id: 'y', cwd: '/r/s' }], ['/r'], 'linux')
    expect(m.get('/r')).toEqual(['x', 'y'])
  })
})

describe('R-10 toWorktreeViews', () => {
  const snap = {
    worktrees: [
      { ...wt('/home/u/acme', 'main', ['a.ts', 'shared.ts']), changedFiles: 2, ahead: 0, behind: 1, isMain: true },
      { ...wt('/home/u/acme-wt/feat', 'feat/x', ['shared.ts', 'b.ts', 'c.ts']), changedFiles: 3, ahead: 4, behind: 0, isMain: false },
      { ...wt('/home/u/acme-wt/det', undefined, []), changedFiles: 0, ahead: null, behind: null, isMain: false, error: 'timeout' }
    ],
    overlaps: [{ path: 'shared.ts', worktrees: ['/home/u/acme', '/home/u/acme-wt/feat'] }]
  }
  const agents = [{ id: 'lead', cwd: '/home/u/acme' }, { id: 'a1', cwd: '/home/u/acme-wt/feat/src' }, { id: 'a2' }]
  const v = toWorktreeViews(snap, agents, 'linux')

  it('R-10 Worktree views carry branch, path, agent ids, counts and file paths', () => {
    expect(v.worktrees).toHaveLength(3)
    expect(v.worktrees[0]).toMatchObject({ branch: 'main', path: '/home/u/acme', agentIds: ['lead'], changedFiles: 2, ahead: 0, behind: 1, isMain: true, files: ['a.ts', 'shared.ts'] })
    expect(v.worktrees[1]).toMatchObject({ branch: 'feat/x', agentIds: ['a1'], changedFiles: 3, ahead: 4 })
  })
  it('R-10 detached -> "(detached)", null ahead -> 0, error kept, no agents', () => {
    expect(v.worktrees[2]).toMatchObject({ branch: '(detached)', ahead: 0, error: 'timeout', agentIds: [] })
  })
  it('R-10 overlapsWith lists the OTHER worktrees branches sharing a file', () => {
    expect(v.worktrees[0]!.overlapsWith).toEqual(['feat/x'])
    expect(v.worktrees[1]!.overlapsWith).toEqual(['main'])
    expect(v.worktrees[2]!.overlapsWith ?? []).toEqual([])
  })
  it('R-10 FileOverlap carries the agents on involved worktrees and the branches', () => {
    expect(v.overlaps).toHaveLength(1)
    expect(v.overlaps[0]!.path).toBe('shared.ts')
    expect([...v.overlaps[0]!.agentIds].sort()).toEqual(['a1', 'lead'])
    expect(v.overlaps[0]!.worktrees).toEqual(['main', 'feat/x'])
  })
  it('R-10 no overlaps -> empty overlaps and no overlapsWith entries', () => {
    const r = toWorktreeViews({ worktrees: snap.worktrees.slice(0, 1), overlaps: [] }, agents, 'linux')
    expect(r.overlaps).toEqual([])
    expect(r.worktrees[0]!.overlapsWith ?? []).toEqual([])
  })
})
