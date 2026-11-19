// T03 / R-08: git porcelain parsers (formats from plan.md fact 12). Synthetic paths and shas only.
import { describe, expect, it } from 'vitest'
import {
  mergeChanged,
  parseLeftRight,
  parseNumstatZ,
  parseStatusZ,
  parseSymbolicRef,
  parseWorktreeList,
  pickBase
} from '../../../src/main/git/gitParse'

const SHA1 = '1111111111111111111111111111111111111111'
const SHA2 = '2222222222222222222222222222222222222222'
const SHA3 = '3333333333333333333333333333333333333333'

describe('R-08 parseWorktreeList', () => {
  const out = [
    'worktree C:/Users/u/acme', `HEAD ${SHA1}`, 'branch refs/heads/main', '',
    'worktree C:/Users/u/acme-wt/feat-a', `HEAD ${SHA2}`, 'branch refs/heads/feat/a', '',
    'worktree C:/Users/u/acme-wt/detached', `HEAD ${SHA3}`, 'detached', ''
  ].join('\n')

  it('R-08 main + two linked worktrees; the first block is the main one', () => {
    const l = parseWorktreeList(out)
    expect(l).toHaveLength(3)
    expect(l[0]).toMatchObject({ path: 'C:/Users/u/acme', head: SHA1, branch: 'main', detached: false, bare: false, locked: false, prunable: false })
    expect(l[1]).toMatchObject({ path: 'C:/Users/u/acme-wt/feat-a', head: SHA2, branch: 'feat/a', detached: false })
  })
  it('R-08 detached worktree has no branch', () => {
    const d = parseWorktreeList(out)[2]!
    expect(d.detached).toBe(true)
    expect(d.branch).toBeUndefined()
  })
  it('R-08 bare, locked (with and without reason) and prunable (with reason) are flagged', () => {
    const l = parseWorktreeList(
      ['worktree /home/u/acme.git', 'bare', '', `worktree /home/u/wt1`, `HEAD ${SHA1}`, 'branch refs/heads/x', 'locked', '',
        `worktree /home/u/wt2`, `HEAD ${SHA2}`, 'detached', 'locked on a USB stick', '',
        `worktree /home/u/wt3`, `HEAD ${SHA3}`, 'branch refs/heads/y', 'prunable gitdir file points to non-existent location', ''].join('\n')
    )
    expect(l[0]!.bare).toBe(true)
    expect(l[1]!.locked).toBe(true)
    expect(l[2]!.locked).toBe(true)
    expect(l[3]!.prunable).toBe(true)
  })
  it('R-08 tolerates CRLF and a missing trailing blank line', () => {
    const l = parseWorktreeList(`worktree C:/x\r\nHEAD ${SHA1}\r\nbranch refs/heads/main\r\n`)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ path: 'C:/x', branch: 'main', head: SHA1 })
  })
  it('R-08 paths with spaces are kept whole', () => {
    expect(parseWorktreeList(`worktree C:/Users/u/my project\nHEAD ${SHA1}\nbranch refs/heads/main\n`)[0]!.path).toBe('C:/Users/u/my project')
  })
  it('R-08 empty output -> []', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(parseWorktreeList('\n\n')).toEqual([])
  })
})

describe('R-08 parseStatusZ', () => {
  it('R-08 modified (worktree / index), added, deleted, untracked', () => {
    const e = parseStatusZ(' M src/a.ts\0M  src/b.ts\0A  new.ts\0 D gone.ts\0?? tmp/x.txt\0')
    expect(e.map((x) => [x.path, x.status])).toEqual([['src/a.ts', 'M'], ['src/b.ts', 'M'], ['new.ts', 'A'], ['gone.ts', 'D'], ['tmp/x.txt', '?']])
    expect(e[0]).toMatchObject({ x: ' ', y: 'M' })
  })
  it('R-08 status letter comes from y unless y is blank (AM -> M)', () => {
    expect(parseStatusZ('AM both.ts\0')[0]!.status).toBe('M')
    expect(parseStatusZ('A  idx.ts\0')[0]!.status).toBe('A')
  })
  it('R-08 renames consume the extra NUL field: XY new\\0old\\0', () => {
    const e = parseStatusZ('R  new/name.ts\0old/name.ts\0 M after.ts\0')
    expect(e).toHaveLength(2)
    expect(e[0]).toMatchObject({ path: 'new/name.ts', origPath: 'old/name.ts', status: 'R' })
    expect(e[1]!.path).toBe('after.ts')
  })
  it('R-08 copies (C) also consume the extra field', () => {
    const e = parseStatusZ('C  copy.ts\0orig.ts\0?? z.txt\0')
    expect(e).toHaveLength(2)
    expect(e[1]!.path).toBe('z.txt')
  })
  it('R-08 unmerged (UU, AA, DD, AU) -> U', () => {
    for (const xy of ['UU', 'AA', 'DD', 'AU', 'UD']) expect(parseStatusZ(`${xy} c.ts\0`)[0]!.status).toBe('U')
  })
  it('R-08 ignored (!!) entries are skipped', () => {
    expect(parseStatusZ('!! node_modules/\0 M a.ts\0').map((e) => e.path)).toEqual(['a.ts'])
  })
  it('R-08 paths with spaces and unicode are intact (no quoting with -z)', () => {
    expect(parseStatusZ(' M docs/my file ü.md\0')[0]!.path).toBe('docs/my file ü.md')
  })
  it('R-08 empty output -> []', () => expect(parseStatusZ('')).toEqual([]))
})

describe('R-08 parseLeftRight', () => {
  it('R-08 "behind\\tahead"', () => {
    expect(parseLeftRight('3\t7\n')).toEqual({ behind: 3, ahead: 7 })
    expect(parseLeftRight('0\t0')).toEqual({ behind: 0, ahead: 0 })
  })
  it('R-08 garbage -> null', () => {
    for (const s of ['', 'x\ty', '1', '1\t', 'a b']) expect(parseLeftRight(s)).toBeNull()
  })
})

describe('R-08 parseNumstatZ', () => {
  it('R-08 plain entries', () => {
    expect(parseNumstatZ('3\t1\tsrc/a.ts\x0010\t0\tsrc/b.ts\0')).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'src/b.ts', added: 10, removed: 0 }
    ])
  })
  it('R-08 binary files report null counts', () => {
    expect(parseNumstatZ('-\t-\timg/logo.png\0')).toEqual([{ path: 'img/logo.png', added: null, removed: null }])
  })
  it('R-08 rename form a\\td\\t\\0old\\0new\\0 uses the new path', () => {
    const e = parseNumstatZ('5\t2\t\0old/a.ts\0new/a.ts\x001\t1\tz.ts\0')
    expect(e).toEqual([
      { path: 'new/a.ts', added: 5, removed: 2 },
      { path: 'z.ts', added: 1, removed: 1 }
    ])
  })
  it('R-08 empty -> []', () => expect(parseNumstatZ('')).toEqual([]))
})

describe('R-08 pickBase / parseSymbolicRef', () => {
  const has = (...refs: string[]) => (r: string) => refs.includes(r)
  it('R-08 origin/HEAD target wins when it exists', () => {
    expect(pickBase({ originHead: 'origin/develop', existing: has('origin/develop', 'main') })).toBe('origin/develop')
  })
  it('R-08 fallback order: main, master, origin/main, origin/master', () => {
    expect(pickBase({ originHead: null, existing: has('main', 'master', 'origin/main') })).toBe('main')
    expect(pickBase({ originHead: null, existing: has('master', 'origin/main') })).toBe('master')
    expect(pickBase({ originHead: null, existing: has('origin/main', 'origin/master') })).toBe('origin/main')
    expect(pickBase({ originHead: null, existing: has('origin/master') })).toBe('origin/master')
  })
  it('R-08 nothing exists -> null', () => {
    expect(pickBase({ originHead: null, existing: () => false })).toBeNull()
  })
  it('R-08 parseSymbolicRef strips refs/remotes/ and tolerates a bare name and newline', () => {
    expect(parseSymbolicRef('refs/remotes/origin/main\n')).toBe('origin/main')
    expect(parseSymbolicRef('origin/main')).toBe('origin/main')
    expect(parseSymbolicRef('')).toBeNull()
    expect(parseSymbolicRef('\n')).toBeNull()
  })
})

describe('R-08 mergeChanged', () => {
  const st = (path: string, status: 'M' | 'A' | 'D' | 'R' | '?' | 'U') => ({ path, x: ' ', y: status, status })
  const by = (r: { files: { path: string }[] }) => [...r.files].sort((a, b) => a.path.localeCompare(b.path))

  it('R-08 a committed-only file is committed and not uncommitted, with its numstat', () => {
    const r = mergeChanged([{ path: 'a.ts', added: 4, removed: 1 }], [])
    expect(r.total).toBe(1)
    expect(r.files[0]).toMatchObject({ path: 'a.ts', added: 4, removed: 1, committed: true, uncommitted: false })
  })
  it('R-08 an uncommitted-only file keeps its status and is not committed', () => {
    const r = mergeChanged([], [st('b.ts', 'A'), st('c.txt', '?')] as never)
    expect(by(r).map((f) => [f.path, f.status, f.committed, f.uncommitted])).toEqual([['b.ts', 'A', false, true], ['c.txt', '?', false, true]])
  })
  it('R-08 a file both committed and edited is one entry flagged both', () => {
    const r = mergeChanged([{ path: 'a.ts', added: 2, removed: 0 }], [st('a.ts', 'M')] as never)
    expect(r.files).toHaveLength(1)
    expect(r.files[0]).toMatchObject({ path: 'a.ts', committed: true, uncommitted: true, status: 'M', added: 2, removed: 0 })
  })
  it('R-08 committed-only entries get a valid status letter', () => {
    expect(mergeChanged([{ path: 'a.ts', added: 1, removed: 0 }], []).files[0]!.status).toMatch(/^[MADRU?]$/)
  })
  it('R-08 binary numstat does not produce NaN counts', () => {
    const f = mergeChanged([{ path: 'x.png', added: null, removed: null }], []).files[0]!
    expect(f.added === undefined || f.added === null || Number.isFinite(f.added)).toBe(true)
  })
  it('R-08 the list is capped, total keeps the real count', () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ path: `f${i}.ts`, added: 1, removed: 0 }))
    const r = mergeChanged(many, [])
    expect(r.files).toHaveLength(500)
    expect(r.total).toBe(700)
    expect(mergeChanged(many, [], 10).files).toHaveLength(10)
  })
  it('R-08 paths stay repo-relative with forward slashes', () => {
    for (const f of mergeChanged([{ path: 'src/a.ts', added: 1, removed: 0 }], [st('src/b.ts', 'M')] as never).files) expect(f.path).not.toContain('\\')
  })
})
