// T08 / R-09: worktree service with an injected fake git (no real git process), fake timers and fake watchers.
import { describe, expect, it } from 'vitest'
import { createWorktreeService } from '../../../src/main/git/worktreeService'

const ROOT = 'C:/Users/u/acme'
const WT1 = 'C:/Users/u/acme-wt/feat'
const SHA = '1111111111111111111111111111111111111111'
const wtBlock = (path: string, branch: string | null, extra: string[] = []) =>
  [`worktree ${path}`, `HEAD ${SHA}`, branch ? `branch refs/heads/${branch}` : 'detached', ...extra, ''].join('\n')

interface World {
  list: string
  originHead: string | null // symbolic-ref answer, null = unset (git fails)
  refs: string[] // refs that rev-parse --verify accepts
  status: Record<string, string | Error>
  leftRight: Record<string, string | Error>
  numstat: Record<string, string>
  diffs: Record<string, string> // key `${cwd}|${arg}` where arg is the base-form or 'HEAD'
}
const world = (over: Partial<World> = {}): World => ({
  list: wtBlock(ROOT, 'main') + '\n' + wtBlock(WT1, 'feat/x'),
  originHead: null,
  refs: ['main'],
  status: { [ROOT]: ' M shared.ts\0', [WT1]: ' M shared.ts\0?? n.txt\0' },
  leftRight: { [ROOT]: '1\t0\n', [WT1]: '0\t3\n' },
  numstat: { [WT1]: '4\t1\tcommitted.ts\0' },
  diffs: {},
  ...over
})

function setup(w: World = world()) {
  const calls: { file: string; args: string[]; opts: any }[] = []
  let gate: Promise<void> = Promise.resolve()
  let open: () => void = () => {}
  let inflightStatus = 0
  let maxStatus = 0
  const exec = async (file: string, args: string[], opts: any) => {
    calls.push({ file, args, opts })
    await gate
    const cwd = args[1]!
    const rest = args.slice(2).filter((a) => a !== '--no-optional-locks')
    const sub = rest[0]
    if (sub === 'worktree') return { stdout: w.list }
    if (sub === 'symbolic-ref') {
      if (w.originHead === null) throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref')
      return { stdout: w.originHead + '\n' }
    }
    if (sub === 'rev-parse') {
      const ref = rest.find((a) => a.endsWith('^{commit}'))!.replace('^{commit}', '')
      if (w.refs.includes(ref)) return { stdout: SHA + '\n' }
      throw new Error('exit 1')
    }
    if (sub === 'status') {
      inflightStatus++
      maxStatus = Math.max(maxStatus, inflightStatus)
      await new Promise((r) => setImmediate(r))
      inflightStatus--
      const s = w.status[cwd]
      if (s instanceof Error) throw s
      return { stdout: s ?? '' }
    }
    if (sub === 'rev-list') {
      const s = w.leftRight[cwd]
      if (s instanceof Error) throw s
      return { stdout: s ?? '0\t0\n' }
    }
    if (sub === 'diff' && rest.includes('--numstat')) return { stdout: w.numstat[cwd] ?? '' }
    if (sub === 'diff') {
      const key = rest.includes('HEAD') && !rest.some((a) => a.includes('...')) ? 'HEAD' : 'base'
      return { stdout: w.diffs[`${cwd}|${key}`] ?? '' }
    }
    throw new Error('unexpected git ' + args.join(' '))
  }
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const setTimer = (fn: () => void, ms: number) => {
    const id = ++seq
    timers.set(id, { at: now + ms, fn })
    return id
  }
  const advance = (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = Math.max(now, due[1].at)
      due[1].fn()
    }
    now = target
  }
  const watchers: { paths: string[]; onChange: () => void; closed: boolean }[] = []
  const watchFiles = (paths: string[], onChange: () => void) => {
    const w2 = { paths, onChange, closed: false }
    watchers.push(w2)
    return { close: () => void (w2.closed = true) }
  }
  const svc = createWorktreeService({ exec: exec as never, platform: 'win32', watchFiles, setTimer, clearTimer: (t) => void timers.delete(t as number), now: () => new Date('2026-11-19T10:00:00.000Z') })
  const pushes: any[] = []
  svc.onChanged((s) => pushes.push(s))
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)) }
  return {
    svc, w, calls, pushes, watchers, advance, settle,
    pendingTimers: () => timers.size,
    hold: () => { gate = new Promise<void>((r) => (open = r)) },
    release: () => open(),
    maxStatus: () => maxStatus,
    count: (sub: string, cwd?: string) => calls.filter((c) => c.args.slice(2).includes(sub) && (cwd === undefined || c.args[1] === cwd)).length
  }
}

describe('R-09 snapshot content', () => {
  it('R-09 main + linked worktree: branch, head, isMain, ahead/behind, merged files', async () => {
    const s = setup()
    const snap = await s.svc.watch(ROOT)
    expect(snap.root).toBe(ROOT)
    expect(snap.base).toBe('main')
    expect(snap.worktrees).toHaveLength(2)
    const [main, feat] = snap.worktrees as any[]
    expect(main).toMatchObject({ path: ROOT, branch: 'main', head: SHA, isMain: true, detached: false, behind: 1, ahead: 0 })
    expect(feat).toMatchObject({ path: WT1, branch: 'feat/x', isMain: false, ahead: 3, behind: 0 })
    expect(feat.files.map((f: any) => f.path).sort()).toEqual(['committed.ts', 'n.txt', 'shared.ts'])
    expect(feat.changedFiles).toBe(3)
    expect(feat.files.find((f: any) => f.path === 'committed.ts')).toMatchObject({ committed: true, uncommitted: false, added: 4, removed: 1 })
    expect(feat.files.find((f: any) => f.path === 'n.txt')).toMatchObject({ status: '?', uncommitted: true })
    expect(snap.error).toBeUndefined()
    expect(typeof snap.updatedAt).toBe('string')
  })
  it('R-09 overlaps: a file changed in both worktrees', async () => {
    const snap = await setup().svc.watch(ROOT)
    expect(snap.overlaps).toEqual([{ path: 'shared.ts', worktrees: [ROOT, WT1] }])
  })
  it('R-09 current() returns the last snapshot; before any watch it is an empty one', async () => {
    const s = setup()
    expect(s.svc.current()).toMatchObject({ root: null, worktrees: [], overlaps: [] })
    const snap = await s.svc.watch(ROOT)
    expect(s.svc.current()).toEqual(snap)
  })
  it('R-09 a detached worktree has no branch and detached=true', async () => {
    const s = setup(world({ list: wtBlock(ROOT, 'main') + '\n' + wtBlock(WT1, null), status: { [ROOT]: '', [WT1]: '' } }))
    const snap = await s.svc.watch(ROOT)
    expect((snap.worktrees[1] as any)).toMatchObject({ detached: true })
    expect((snap.worktrees[1] as any).branch).toBeUndefined()
  })
  it('R-09 a bare entry is skipped', async () => {
    const s = setup(world({ list: ['worktree C:/Users/u/acme.git', 'bare', ''].join('\n') + '\n' + wtBlock(WT1, 'feat/x'), status: { [WT1]: '' } }))
    const snap = await s.svc.watch(ROOT)
    expect(snap.worktrees.map((w) => w.path)).toEqual([WT1])
  })
  it('R-09 a prunable worktree is shown with error "prunable" and gets no further git calls', async () => {
    const s = setup(world({ list: wtBlock(ROOT, 'main') + '\n' + wtBlock(WT1, 'feat/x', ['prunable gitdir file points to non-existent location']) }))
    const snap = await s.svc.watch(ROOT)
    expect((snap.worktrees[1] as any).error).toBe('prunable')
    expect(s.calls.filter((c) => c.args[1] === WT1)).toHaveLength(0)
  })
  it('R-09 a failing worktree sets error on that worktree only', async () => {
    const s = setup(world({ status: { [ROOT]: ' M a.ts\0', [WT1]: new Error('timeout') } }))
    const snap = await s.svc.watch(ROOT)
    expect((snap.worktrees[0] as any).error).toBeUndefined()
    expect((snap.worktrees[0] as any).files).toHaveLength(1)
    expect((snap.worktrees[1] as any).error).toBeTruthy()
    expect(snap.error).toBeUndefined()
  })
  it('R-09 a failing "worktree list" gives a snapshot-level error and no worktrees', async () => {
    const failing = createWorktreeService({
      exec: (async () => { throw new Error('fatal: not a git repository') }) as never, platform: 'win32', setTimer: () => 0, clearTimer: () => {}, now: () => new Date(0)
    })
    const snap = await failing.watch(ROOT)
    expect(snap.error).toBeTruthy()
    expect(snap.worktrees).toEqual([])
    failing.dispose()
  })
})

describe('R-09 base detection (D10)', () => {
  it('R-09 origin/HEAD target is the base when it resolves', async () => {
    const s = setup(world({ originHead: 'refs/remotes/origin/develop', refs: ['origin/develop', 'main'] }))
    const snap = await s.svc.watch(ROOT)
    expect(snap.base).toBe('origin/develop')
    expect(s.calls.some((c) => c.args.includes('origin/develop...HEAD'))).toBe(true)
  })
  it('R-09 origin/HEAD unset falls back to main, then master', async () => {
    expect((await setup(world({ refs: ['main'] })).svc.watch(ROOT)).base).toBe('main')
    expect((await setup(world({ refs: ['master'] })).svc.watch(ROOT)).base).toBe('master')
    expect((await setup(world({ refs: ['origin/master'] })).svc.watch(ROOT)).base).toBe('origin/master')
  })
  it('R-09 no base: ahead/behind are null and the committed diff is skipped (status only)', async () => {
    const s = setup(world({ refs: [] }))
    const snap = await s.svc.watch(ROOT)
    expect(snap.base).toBeNull()
    for (const w of snap.worktrees as any[]) {
      expect(w.ahead).toBeNull()
      expect(w.behind).toBeNull()
    }
    expect(s.count('rev-list')).toBe(0)
    expect(s.calls.some((c) => c.args.includes('--numstat'))).toBe(false)
    expect((snap.worktrees[1] as any).files.map((f: any) => f.path).sort()).toEqual(['n.txt', 'shared.ts'])
  })
  it('R-09 the base is cached: a second cycle inside 60 s does not re-run symbolic-ref / rev-parse', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    const n = s.count('symbolic-ref') + s.count('rev-parse')
    s.advance(5000)
    await s.settle()
    expect(s.count('symbolic-ref') + s.count('rev-parse')).toBe(n)
  })
})

describe('R-09 git invocation safety', () => {
  it('R-09 every call is `git -C <path> ...` with timeout 4000 and windowsHide (never a shell)', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    expect(s.calls.length).toBeGreaterThan(5)
    for (const c of s.calls) {
      expect(c.file).toBe('git')
      expect(c.args[0]).toBe('-C')
      expect(typeof c.args[1]).toBe('string')
      expect(c.opts).toMatchObject({ timeout: 4000, windowsHide: true })
    }
  })
  it('R-09 status uses --no-optional-locks, porcelain v1 -z and untracked files', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    const st = s.calls.find((c) => c.args.includes('status'))!
    expect(st.args).toEqual(expect.arrayContaining(['--no-optional-locks', '--porcelain=v1', '-z', '--untracked-files=all']))
  })
  it('R-09 at most 3 worktrees are processed in parallel', async () => {
    const paths = Array.from({ length: 7 }, (_, i) => `C:/Users/u/acme-wt/w${i}`)
    const list = wtBlock(ROOT, 'main') + '\n' + paths.map((p, i) => wtBlock(p, `b${i}`)).join('\n')
    const s = setup(world({ list, status: {} }))
    await s.svc.watch(ROOT)
    expect(s.count('status')).toBe(8)
    expect(s.maxStatus()).toBeLessThanOrEqual(3)
    expect(s.maxStatus()).toBeGreaterThan(1)
  })
  it('R-09 file lists are capped at 500 per worktree while changedFiles keeps the real count', async () => {
    const many = Array.from({ length: 650 }, (_, i) => `?? gen/f${i}.txt\0`).join('')
    const s = setup(world({ status: { [ROOT]: many, [WT1]: '' } }))
    const snap = await s.svc.watch(ROOT)
    expect((snap.worktrees[0] as any).files).toHaveLength(500)
    expect((snap.worktrees[0] as any).changedFiles).toBe(650)
  })
})

describe('R-09 scheduling: no overlapping runs, poll, triggers', () => {
  it('R-09 a slow cycle is never overlapped: timers and pokes during it start no second run', async () => {
    const s = setup()
    s.hold()
    const first = s.svc.watch(ROOT)
    await s.settle()
    expect(s.count('worktree')).toBe(1)
    s.svc.poke()
    s.advance(60_000)
    await s.settle()
    expect(s.count('worktree')).toBe(1)
    s.release()
    await first
    await s.settle()
    expect(s.count('worktree')).toBe(2) // exactly one extra run for the trigger that arrived mid-cycle
  })
  it('R-09 without a mid-cycle trigger there is no immediate re-run', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    await s.settle()
    expect(s.count('worktree')).toBe(1)
  })
  it('R-09 the poll timer is re-armed after each cycle: 5 s later the next run starts', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    s.advance(4999)
    await s.settle()
    expect(s.count('worktree')).toBe(1)
    s.advance(1)
    await s.settle()
    expect(s.count('worktree')).toBe(2)
    s.advance(5000)
    await s.settle()
    expect(s.count('worktree')).toBe(3)
  })
  it('R-09 poke is debounced 500 ms and several pokes make one run', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    s.svc.poke()
    s.svc.poke()
    s.svc.poke()
    s.advance(499)
    await s.settle()
    expect(s.count('worktree')).toBe(1)
    s.advance(1)
    await s.settle()
    expect(s.count('worktree')).toBe(2)
  })
  it('R-09 poke with no watched root does nothing', async () => {
    const s = setup()
    s.svc.poke()
    s.advance(10_000)
    await s.settle()
    expect(s.calls).toHaveLength(0)
  })
  it('R-09 switching roots cancels the old poll; only the new root is polled', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    const B = 'C:/Users/u/other'
    s.w.list = wtBlock(B, 'main')
    s.w.status[B] = ''
    await s.svc.watch(B)
    s.calls.length = 0
    s.advance(5000)
    await s.settle()
    const lists = s.calls.filter((c) => c.args.includes('worktree'))
    expect(lists).toHaveLength(1)
    expect(lists[0]!.args[1]).toBe(B)
  })
  it('R-09 watch(null) stops everything: no timers, watchers closed, empty snapshot', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    const snap = await s.svc.watch(null)
    expect(snap.root).toBeNull()
    expect(snap.worktrees).toEqual([])
    expect(s.pendingTimers()).toBe(0)
    expect(s.watchers.every((w) => w.closed)).toBe(true)
    s.calls.length = 0
    s.advance(60_000)
    await s.settle()
    expect(s.calls).toHaveLength(0)
  })
  it('R-09 dispose clears timers and watchers', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    s.svc.dispose()
    expect(s.pendingTimers()).toBe(0)
    expect(s.watchers.every((w) => w.closed)).toBe(true)
  })
  it('R-09 a cycle that finishes after the root changed does not push its stale snapshot', async () => {
    const s = setup()
    s.hold()
    const first = s.svc.watch(ROOT)
    await s.settle()
    const second = s.svc.watch(null)
    s.release()
    await Promise.allSettled([first, second])
    await s.settle()
    expect(s.pushes.every((p) => p.root !== ROOT)).toBe(true)
    expect(s.svc.current().root).toBeNull()
  })
})

describe('R-09 pushes and watchers', () => {
  it('R-09 identical cycles push nothing; a change pushes once', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    await s.settle()
    const n = s.pushes.length
    s.advance(5000)
    await s.settle()
    s.advance(5000)
    await s.settle()
    expect(s.pushes).toHaveLength(n)
    s.w.status[WT1] = ' M shared.ts\0?? n.txt\0?? more.txt\0'
    s.advance(5000)
    await s.settle()
    expect(s.pushes).toHaveLength(n + 1)
    expect((s.pushes[n].worktrees[1] as any).files.map((f: any) => f.path)).toContain('more.txt')
  })
  it('R-09 onChanged can be unsubscribed', async () => {
    const s = setup()
    const got: unknown[] = []
    const off = s.svc.onChanged((x) => got.push(x))
    await s.svc.watch(ROOT)
    await s.settle()
    off()
    const n = got.length
    s.w.status[ROOT] = ' M z.ts\0'
    s.advance(5000)
    await s.settle()
    expect(got).toHaveLength(n)
  })
  it('R-09 file watchers cover the main worktree HEAD and index; a change triggers a debounced run', async () => {
    const s = setup()
    await s.svc.watch(ROOT)
    const all = s.watchers.flatMap((w) => w.paths).map((p) => p.replace(/\\/g, '/'))
    expect(all).toEqual(expect.arrayContaining([`${ROOT}/.git/HEAD`, `${ROOT}/.git/index`]))
    const before = s.count('worktree')
    s.watchers[0]!.onChange()
    s.advance(500)
    await s.settle()
    expect(s.count('worktree')).toBe(before + 1)
  })
})

describe('R-09 compare diffs', () => {
  const diffWorld = () => world({
    diffs: {
      [`${ROOT}|base`]: 'diff --git a/shared.ts b/shared.ts\n+main side\n',
      [`${ROOT}|HEAD`]: '',
      [`${WT1}|base`]: 'diff --git a/shared.ts b/shared.ts\n+feat side\n',
      [`${WT1}|HEAD`]: '+uncommitted line\n'
    }
  })
  it('R-09 returns one FileDiff per worktree that has the file, with branch and path', async () => {
    const s = setup(diffWorld())
    await s.svc.watch(ROOT)
    const out = await s.svc.compare(ROOT, 'shared.ts')
    expect(out.map((d) => d.worktreePath).sort()).toEqual([ROOT, WT1].sort())
    const feat = out.find((d) => d.worktreePath === WT1)!
    expect(feat.branch).toBe('feat/x')
    expect(feat.diff).toContain('+feat side')
    expect(feat.diff).toContain('+uncommitted line')
    expect(feat.truncated).toBe(false)
  })
  it('R-09 skips worktrees that do not contain the file', async () => {
    const s = setup(diffWorld())
    await s.svc.watch(ROOT)
    const out = await s.svc.compare(ROOT, 'committed.ts')
    expect(out.map((d) => d.worktreePath)).toEqual([WT1])
  })
  it('R-09 diff calls use -C, --no-optional-locks and `--` before the path', async () => {
    const s = setup(diffWorld())
    await s.svc.watch(ROOT)
    s.calls.length = 0
    await s.svc.compare(ROOT, 'shared.ts')
    const diffs = s.calls.filter((c) => c.args.includes('diff'))
    expect(diffs.length).toBeGreaterThanOrEqual(2)
    for (const c of diffs) {
      expect(c.args[0]).toBe('-C')
      expect(c.args).toContain('--no-optional-locks')
      expect(c.args.indexOf('--')).toBe(c.args.length - 2)
      expect(c.args[c.args.length - 1]).toBe('shared.ts')
    }
  })
  it('R-09 output over 200 kB is cut and flagged truncated', async () => {
    const s = setup(world({ diffs: { [`${WT1}|base`]: 'x'.repeat(500_000), [`${ROOT}|base`]: '', [`${ROOT}|HEAD`]: '', [`${WT1}|HEAD`]: '' } }))
    await s.svc.watch(ROOT)
    const out = await s.svc.compare(ROOT, 'shared.ts')
    const feat = out.find((d) => d.worktreePath === WT1)!
    expect(feat.truncated).toBe(true)
    expect(feat.diff.length).toBeLessThanOrEqual(200_000 + 100)
  })
  it('R-09 invalid paths run no git and return nothing', async () => {
    const s = setup(diffWorld())
    await s.svc.watch(ROOT)
    s.calls.length = 0
    for (const bad of ['', '../secret.txt', 'a/../../b', '-rf', '--output=x', 'C:/Windows/win.ini', '/etc/passwd', 'a\0b']) {
      const r = await s.svc.compare(ROOT, bad).catch(() => [])
      expect(r).toEqual([])
    }
    expect(s.calls.filter((c) => c.args.includes('diff'))).toHaveLength(0)
  })
  it('R-09 a root that is not the watched root runs no git and returns nothing', async () => {
    const s = setup(diffWorld())
    await s.svc.watch(ROOT)
    s.calls.length = 0
    expect(await s.svc.compare('C:/Users/u/other', 'shared.ts').catch(() => [])).toEqual([])
    expect(s.calls).toHaveLength(0)
  })
})
