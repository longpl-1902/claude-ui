import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecFn } from '../../../src/main/transcripts/projectResolver'
import { createTranscriptService, DEFAULT_VIEWER, type TranscriptService, type WatchDir } from '../../../src/main/transcripts/transcriptService'
import type { PtyHint } from '../../../src/main/transcripts/sessionIndex'
import type { TeamSnapshot } from '../../../src/shared/types'
import { jsonl, userPrompt, at } from '../../fixtures/transcripts/builders'
import { HOME, NOW_MS, PID_LIVE, ROOTS, S1, S4, buildTranscriptTree, utcDay } from '../../fixtures/transcripts/trees'
import { createMemoryByteFs } from './memoryByteFs'

// Per-window selection (T36): every viewer has its own selection / auto pick; sessions are shared and refcounted.

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
const V2 = 'wc:2'
const V3 = 'wc:3'

interface FakeWatcher {
  dir: string
  cb: (kind: 'add' | 'change' | 'unlink', p: string) => void
  closed: boolean
}

function setup(opts: { pty?: () => PtyHint | null; execGit?: ExecFn } = {}) {
  const tree = buildTranscriptTree()
  const fs = createMemoryByteFs({ ...tree.files }, { mtimes: tree.mtimes, caseInsensitive: true })
  const watchers: FakeWatcher[] = []
  const watchDir: WatchDir = (dir, _o, cb) => {
    const w: FakeWatcher = { dir, cb, closed: false }
    watchers.push(w)
    return { close: () => void (w.closed = true) }
  }
  const emit = (kind: 'add' | 'change' | 'unlink', p: string): void => {
    for (const w of watchers) if (!w.closed && norm(p).startsWith(norm(w.dir) + '/')) w.cb(kind, p)
  }
  const svc = createTranscriptService({
    fs,
    host: { home: HOME, platform: 'win32', env: {} },
    roots: async () => ROOTS,
    ptyHint: opts.pty ?? (() => null),
    watchDir,
    isPidAlive: (pid) => pid === PID_LIVE,
    nowMs: () => Date.now(),
    localDay: utcDay,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    ...(opts.execGit ? { execGit: opts.execGit } : {})
  })
  const teams: Array<[TeamSnapshot, string]> = []
  svc.onTeam((s, v) => teams.push([s, v]))
  return { tree, fs, svc, emit, teams }
}
const flush = (ms: number) => vi.advanceTimersByTimeAsync(ms)
async function boot(opts: Parameters<typeof setup>[0] = {}) {
  const env = setup(opts)
  await env.svc.start()
  await flush(3000)
  return env
}
let current: TranscriptService | undefined
const track = <T extends { svc: TranscriptService }>(env: T): T => {
  current = env.svc
  return env
}
const selectS4 = { mode: 'session' as const, accountId: '', sessionId: S4 }
const reads = (env: Awaited<ReturnType<typeof boot>>): number => env.fs.rangeCalls.filter((c) => norm(c.path) === norm(env.tree.paths.s4)).length
const newLine = (n: number): string => jsonl([userPrompt(`neutral line ${n}`, { ts: at(100 + n), uuid: `viewer-uuid-${n}`, parentUuid: 'p', sessionId: S4 })])
const forViewer = (env: Awaited<ReturnType<typeof boot>>, v: string): TeamSnapshot[] => env.teams.filter(([, id]) => id === v).map(([s]) => s)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
})
afterEach(() => {
  current?.dispose()
  current = undefined
  vi.useRealTimers()
})

describe('T36 per-window selection', () => {
  it('the default viewer behaves as before', async () => {
    const { svc } = track(await boot())
    expect(DEFAULT_VIEWER).toBe('main')
    expect(svc.snapshot().sessionId).toBe(S1)
    expect(svc.getSelection()).toEqual({ mode: 'auto' })
  })

  it('two viewers show two sessions; the main selection and pushes are untouched', async () => {
    const env = track(await boot())
    const { svc, teams } = env
    const snap = await svc.select(selectS4, V2)
    expect(snap.sessionId).toBe(S4)
    expect(svc.snapshot(V2).sessionId).toBe(S4)
    expect(svc.snapshot().sessionId).toBe(S1)
    expect(svc.getSelection()).toEqual({ mode: 'auto' })
    expect(svc.getSelection(V2)).toEqual({ mode: 'session', accountId: '', sessionId: S4 })
    expect(forViewer(env, V2).some((s) => s.sessionId === S4)).toBe(true)
    expect(forViewer(env, DEFAULT_VIEWER).some((s) => s.sessionId === S4)).toBe(false)
    expect(teams.every(([, v]) => v === V2 || v === DEFAULT_VIEWER)).toBe(true)
  })

  it('a shared session is tailed once and pushed to every viewer', async () => {
    const env = track(await boot())
    const { svc, fs, emit, tree } = env
    await svc.select(selectS4, V2)
    const n = reads(env)
    expect(n).toBeGreaterThan(0)
    const second = await svc.select(selectS4, V3)
    expect(second.sessionId).toBe(S4)
    expect(reads(env)).toBe(n)
    env.teams.length = 0
    fs.append(tree.paths.s4, newLine(1))
    emit('change', tree.paths.s4)
    await flush(1000)
    const after = reads(env)
    expect(after).toBeGreaterThan(n)
    const single = after - n
    for (const v of [V2, V3]) {
      const last = forViewer(env, v).at(-1)
      expect(JSON.stringify(last)).toContain('neutral line 1')
    }
    // a second append costs the same number of reads as the first: no per-viewer tailing
    fs.append(tree.paths.s4, newLine(2))
    emit('change', tree.paths.s4)
    await flush(1000)
    expect(reads(env) - after).toBe(single)
  })

  it('releasing viewers drops the session with its last viewer', async () => {
    const env = track(await boot())
    const { svc, fs, emit, tree } = env
    await svc.select(selectS4, V2)
    await svc.select(selectS4, V3)
    svc.releaseViewer(V2)
    expect(svc.viewing().map((x) => x.viewer)).toEqual([DEFAULT_VIEWER, V3])
    env.teams.length = 0
    const before = reads(env)
    fs.append(tree.paths.s4, newLine(1))
    emit('change', tree.paths.s4)
    await flush(1000)
    const viewedDelta = reads(env) - before
    expect(JSON.stringify(forViewer(env, V3).at(-1))).toContain('neutral line 1')
    expect(forViewer(env, V2)).toEqual([])

    svc.releaseViewer(V3)
    const n = reads(env)
    env.teams.length = 0
    fs.append(tree.paths.s4, newLine(2))
    emit('change', tree.paths.s4)
    await flush(3000)
    // the app-wide usage counter still reads the file; the session tailer no longer does
    expect(reads(env) - n).toBeLessThan(viewedDelta)
    expect(env.teams.filter(([, v]) => v === V2 || v === V3)).toEqual([])
    expect(svc.viewing().map((x) => x.viewer)).toEqual([DEFAULT_VIEWER])
  })

  it('releasing the default viewer or an unknown id is a no-op', async () => {
    const { svc } = track(await boot())
    svc.releaseViewer(DEFAULT_VIEWER)
    svc.releaseViewer('wc:404')
    expect(svc.snapshot().sessionId).toBe(S1)
    expect(svc.viewing()).toEqual([{ viewer: DEFAULT_VIEWER, accountId: 'acme', sessionId: S1 }])
  })

  it('auto mode is per viewer, and a re-pick keeps both', async () => {
    const execGit: ExecFn = async (_f, args) => {
      if (String(args[1]).toLowerCase().startsWith('d:')) return { stdout: 'D:/repos/main/.git\n' }
      throw new Error('not a git repository')
    }
    const { svc, emit, tree } = track(await boot({ execGit }))
    await svc.listSessions()
    await flush(3000)
    const snap = await svc.select({ mode: 'auto', projectKey: 'c:/users/u/other' }, V2)
    expect(snap.sessionId).toBe(S4)
    expect(svc.snapshot().sessionId).toBe(S1)
    svc.onPtyChanged()
    emit('change', tree.paths.registryLive)
    await flush(3000)
    expect(svc.snapshot(V2).sessionId).toBe(S4)
    expect(svc.snapshot().sessionId).toBe(S1)
    expect(svc.getSelection(V2)).toEqual({ mode: 'auto', projectKey: 'c:/users/u/other' })
  })

  it('a lazily created viewer starts empty and gets a background auto pick', async () => {
    const env = track(await boot())
    expect(env.svc.snapshot('wc:9').sessionId).not.toBe(S1)
    expect(env.svc.getSelection('wc:9')).toEqual({ mode: 'auto' })
    await flush(1500)
    const last = forViewer(env, 'wc:9').at(-1)
    expect(last?.sessionId).toBe(S1)
    expect(env.svc.snapshot('wc:9').sessionId).toBe(S1)
  })

  it('a hook for a session only the pop-out views reaches only that viewer', async () => {
    const env = track(await boot())
    await env.svc.select(selectS4, V2)
    await flush(1000)
    env.teams.length = 0
    env.svc.ingestHook({ event: 'PermissionRequest', sessionId: S4, receivedMs: NOW_MS - 1000, toolName: 'Bash' } as never)
    await flush(1000)
    expect(forViewer(env, V2).length).toBeGreaterThan(0)
    expect(forViewer(env, DEFAULT_VIEWER).some((s) => s.sessionId === S4)).toBe(false)
  })

  it('viewing() lists each viewer that has a session', async () => {
    const { svc } = track(await boot())
    await svc.select(selectS4, V2)
    expect(svc.viewing()).toEqual([
      { viewer: DEFAULT_VIEWER, accountId: 'acme', sessionId: S1 },
      { viewer: V2, accountId: '', sessionId: S4 }
    ])
  })

  it('after dispose nothing is pushed', async () => {
    const env = await boot()
    await env.svc.select(selectS4, V2)
    env.svc.dispose()
    const n = env.teams.length
    env.fs.append(env.tree.paths.s4, newLine(1))
    env.emit('change', env.tree.paths.s4)
    await flush(3000)
    expect(env.teams.length).toBe(n)
  })
})
