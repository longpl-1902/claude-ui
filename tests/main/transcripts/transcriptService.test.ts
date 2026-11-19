import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranscriptService, type TranscriptService, type WatchDir } from '../../../src/main/transcripts/transcriptService'
import type { PtyHint } from '../../../src/main/transcripts/sessionIndex'
import type { SessionSummary, TeamSnapshot, UsageToday } from '../../../src/shared/types'
import {
  assistantBlocks,
  at,
  jsonl,
  registryEntry,
  subMeta,
  textBlock,
  toolResult,
  toolUseBlock,
  usage,
  userPrompt,
  T0_MS
} from '../../fixtures/transcripts/builders'
import {
  ACME_DIR,
  CREDENTIALS_BASENAME,
  DEFAULT_DIR,
  HOME,
  NOW_MS,
  PID_LIVE,
  PROJ_OTHER,
  ROOTS,
  S1,
  S4,
  SUB1,
  TEAM,
  buildTranscriptTree,
  utcDay
} from '../../fixtures/transcripts/trees'
import { createMemoryByteFs } from './memoryByteFs'

// Signature assumptions (T08 Notes): createTranscriptService(deps) with
// deps = { fs, host, roots(), ptyHint(), watchDir, isPidAlive, nowMs, localDay, setTimer, clearTimer } and the
// TranscriptService methods start/snapshot/listSessions/select/getSelection/usageToday/refreshRoots/onPtyChanged/
// onTeam/onSessions/onUsage/dispose. Timers are driven with vi.useFakeTimers (setTimer/clearTimer wrap them).

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
const agentOf = (s: TeamSnapshot, id: string) => s.agents.find((a) => a.id === id)!

interface FakeWatcher {
  dir: string
  opts: { depth: number }
  cb: (kind: 'add' | 'change' | 'unlink', p: string) => void
  closed: boolean
}

function setup(opts: { pty?: () => PtyHint | null; alive?: number[]; roots?: () => Promise<typeof ROOTS>; extraFiles?: Record<string, string>; localDay?: (ms: number) => string } = {}) {
  const tree = buildTranscriptTree()
  const fs = createMemoryByteFs({ ...tree.files, ...(opts.extraFiles ?? {}) }, { mtimes: tree.mtimes, caseInsensitive: true })
  const watchers: FakeWatcher[] = []
  const watchDir: WatchDir = (dir, o, cb) => {
    const w: FakeWatcher = { dir, opts: o, cb, closed: false }
    watchers.push(w)
    return { close: () => void (w.closed = true) }
  }
  const emit = (kind: 'add' | 'change' | 'unlink', p: string): void => {
    for (const w of watchers) if (!w.closed && norm(p).startsWith(norm(w.dir) + '/')) w.cb(kind, p)
  }
  const alive = new Set(opts.alive ?? [PID_LIVE])
  const svc = createTranscriptService({
    fs,
    host: { home: HOME, platform: 'win32', env: {} },
    roots: opts.roots ?? (async () => ROOTS),
    ptyHint: opts.pty ?? (() => null),
    watchDir,
    isPidAlive: (pid) => alive.has(pid),
    nowMs: () => Date.now(),
    localDay: opts.localDay ?? utcDay,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
  })
  const teams: TeamSnapshot[] = []
  const sessions: SessionSummary[][] = []
  const usages: UsageToday[] = []
  svc.onTeam((s) => teams.push(s))
  svc.onSessions((s) => sessions.push(s))
  svc.onUsage((u) => usages.push(u))
  return { tree, fs, svc, watchers, emit, teams, sessions, usages, alive }
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
})
afterEach(() => {
  current?.dispose()
  current = undefined
  vi.useRealTimers()
})

describe('R-10 start and auto selection', () => {
  it('R-10 watches projects (depth 4) and sessions (depth 0) of every root', async () => {
    const { watchers } = track(await boot())
    const dirs = watchers.map((w) => `${norm(w.dir)}|${w.opts.depth}`).sort()
    expect(dirs).toEqual(
      [`${norm(ACME_DIR)}/projects|4`, `${norm(ACME_DIR)}/sessions|0`, `${norm(DEFAULT_DIR)}/projects|4`, `${norm(DEFAULT_DIR)}/sessions|0`].sort()
    )
  })

  it('R-10 auto mode picks the live registry session and pushes a live snapshot with the tree', async () => {
    const { svc, teams, tree } = track(await boot())
    expect(svc.getSelection()).toEqual({ mode: 'auto' })
    const snap = svc.snapshot()
    expect(snap).toMatchObject({ source: 'live', sessionId: S1, accountId: 'acme' })
    expect(snap.agents.map((a) => a.id)).toContain(SUB1)
    expect(agentOf(snap, 'lead').tokens).toBe(tree.expect.headline.lead)
    expect(teams.length).toBeGreaterThan(0)
    expect(teams[teams.length - 1]!.sessionId).toBe(S1)
  })

  it('R-10 sub-agent metas are read and linked (named teammate, nested parent)', async () => {
    const { svc } = track(await boot())
    const snap = svc.snapshot()
    expect(agentOf(snap, TEAM).name).toBe('reviewer')
    expect(snap.agents.find((a) => a.parentId === SUB1)).toBeDefined()
  })

  it('R-10 the registry entry of the selected session reaches the lead runtime', async () => {
    const { svc } = track(await boot())
    expect(agentOf(svc.snapshot(), 'lead').runtime?.registry).toMatchObject({ status: 'waiting', waitingFor: 'dialog open' })
  })

  it('R-10 with nothing on disk the snapshot is the empty one', async () => {
    const env = setup({ roots: async () => [{ accountId: '', configDirAbs: 'C:/Users/u/.claude-empty' }] })
    track(env)
    await env.svc.start()
    await flush(2000)
    expect(env.svc.snapshot()).toMatchObject({ source: 'empty', agents: [] })
  })

  it('R-08 an app pty without a session file yet gives waitingForSession', async () => {
    const pty = { pid: 9090, cwd: 'D:\\nowhere\\new', startedAtMs: NOW_MS, accountId: '' }
    const { svc } = track(await boot({ pty: () => pty }))
    expect(svc.snapshot()).toMatchObject({ source: 'empty', waitingForSession: true })
  })

  it('R-08 onPtyChanged re-picks: a running pty beats the live registry session', async () => {
    let pty: PtyHint | null = null
    const { svc } = track(await boot({ pty: () => pty }))
    expect(svc.snapshot().sessionId).toBe(S1)
    pty = { pid: 9091, cwd: 'C:\\Users\\u\\other', startedAtMs: NOW_MS - 11 * 3_600_000, accountId: '' }
    svc.onPtyChanged()
    await flush(1500)
    expect(svc.snapshot().sessionId).toBe(S4)
  })
})

describe('R-08 explicit selection', () => {
  it('R-08 select pins a session, returns its snapshot at once and pushes it immediately', async () => {
    const { svc, teams } = track(await boot())
    const before = teams.length
    const snap = await svc.select({ mode: 'session', accountId: '', sessionId: S4 })
    expect(snap).toMatchObject({ source: 'live', sessionId: S4, accountId: '' })
    expect(svc.getSelection()).toEqual({ mode: 'session', accountId: '', sessionId: S4 })
    expect(teams.length).toBeGreaterThan(before)
    expect(teams[teams.length - 1]!.sessionId).toBe(S4)
  })

  it('R-08 a pinned session survives pty and registry changes; {mode:"auto"} releases it', async () => {
    let pty: PtyHint | null = null
    const { svc, emit, tree } = track(await boot({ pty: () => pty }))
    await svc.select({ mode: 'session', accountId: '', sessionId: S4 })
    pty = { pid: 1, cwd: 'D:\\x', startedAtMs: NOW_MS, accountId: 'acme' }
    svc.onPtyChanged()
    emit('change', tree.paths.registryLive)
    await flush(2000)
    expect(svc.snapshot().sessionId).toBe(S4)
    pty = null
    await svc.select({ mode: 'auto' })
    await flush(500)
    expect(svc.getSelection()).toEqual({ mode: 'auto' })
    expect(svc.snapshot().sessionId).toBe(S1)
  })

  it('R-08 listSessions returns the index listing newest first', async () => {
    const { svc } = track(await boot())
    expect((await svc.listSessions()).map((s) => s.sessionId)[0]).toBe(S1)
  })
})

describe('R-10 tailing and push throttle', () => {
  const lineAt = (i: number) => jsonl([userPrompt(`more ${i}`, { ts: at(100 + i), uuid: `new-uuid-${i}`, parentUuid: 'p' })])

  it('R-10 a changed file event reads only the appended bytes and updates the snapshot', async () => {
    const { svc, fs, emit, tree } = track(await boot())
    const before = agentOf(svc.snapshot(), 'lead').toolCalls
    fs.append(
      tree.paths.s1,
      jsonl(assistantBlocks([toolUseBlock('toolu_new_1', 'Bash', { command: 'echo hi' })], { ts: at(101), messageId: 'msg_new_1', stopReason: 'tool_use', usage: usage(1, 1) }))
    )
    emit('change', tree.paths.s1)
    await flush(400)
    expect(agentOf(svc.snapshot(), 'lead').toolCalls).toBe(before + 1)
  })

  it('R-10 pushes are throttled to at most one per 250 ms and only when something changed', async () => {
    const { fs, emit, teams, tree } = track(await boot())
    const base = teams.length
    for (let i = 0; i < 20; i++) {
      fs.append(tree.paths.s1, lineAt(i))
      emit('change', tree.paths.s1)
      await flush(50)
    }
    await flush(300)
    const burst = teams.length - base
    expect(burst).toBeGreaterThanOrEqual(1)
    expect(burst).toBeLessThanOrEqual(5) // 1.3 s window / 250 ms
    const settled = teams.length
    await flush(5000) // idle: polls run but nothing is dirty
    expect(teams.length).toBe(settled)
  })

  it('R-10 the 1 s stat poll notices growth even when the watcher missed the event', async () => {
    const { svc, fs, tree } = track(await boot())
    fs.append(
      tree.paths.s1,
      jsonl(assistantBlocks([toolUseBlock('toolu_poll_1', 'Read', { file_path: 'poll.ts' })], { ts: at(110), messageId: 'msg_poll_1', stopReason: 'tool_use', usage: usage(1, 1) }))
    )
    await flush(1600)
    expect(agentOf(svc.snapshot(), 'lead').activity.some((a) => a.target === 'poll.ts')).toBe(true)
  })

  it('R-10 a new sub-agent file is discovered by the 2 s subagents readdir without any watcher event', async () => {
    const { svc, fs, tree } = track(await boot())
    const id = 'bbbb000000000009a'
    const dir = tree.paths.sub1.replace(/agent-[^/]+$/, '')
    fs.set(`${dir}agent-${id}.meta.json`, JSON.stringify(subMeta({ agentType: 'Plan', description: 'Late agent', toolUseId: 'toolu_lead_agent1' })))
    fs.set(`${dir}agent-${id}.jsonl`, jsonl([userPrompt('late task', { ts: at(120), agentId: id, parentUuid: null, uuid: 'late-1' })]))
    await flush(3000)
    expect(svc.snapshot().agents.map((a) => a.id)).toContain(id)
  })

  it('R-10 a new sub-agent file announced by a watcher add event is picked up too', async () => {
    const { svc, fs, emit, tree } = track(await boot())
    const id = 'bbbb000000000008b'
    const dir = tree.paths.sub1.replace(/agent-[^/]+$/, '')
    fs.set(`${dir}agent-${id}.meta.json`, JSON.stringify(subMeta({ agentType: 'Plan', description: 'Evt agent', toolUseId: 'toolu_lead_agent1' })))
    fs.set(`${dir}agent-${id}.jsonl`, jsonl([userPrompt('evt task', { ts: at(121), agentId: id, parentUuid: null, uuid: 'late-2' })]))
    emit('add', `${dir}agent-${id}.meta.json`)
    emit('add', `${dir}agent-${id}.jsonl`)
    await flush(500)
    expect(svc.snapshot().agents.map((a) => a.id)).toContain(id)
  })

  it('R-10 a registry change updates the lead runtime', async () => {
    const { svc, fs, emit, tree } = track(await boot())
    fs.set(tree.paths.registryLive, JSON.stringify(registryEntry({ status: 'busy', statusUpdatedAt: T0_MS + 90_000 })))
    emit('change', tree.paths.registryLive)
    await flush(1500)
    expect(agentOf(svc.snapshot(), 'lead').runtime?.registry?.status).toBe('busy')
  })

  it('R-10 a replaced (rotated) transcript is re-read from the start', async () => {
    const { svc, fs, emit, tree } = track(await boot())
    fs.replace(tree.paths.s1, jsonl([userPrompt('fresh start', { ts: at(0), uuid: 'rot-1', parentUuid: null })]))
    emit('change', tree.paths.s1)
    await flush(1500)
    const lead = agentOf(svc.snapshot(), 'lead')
    expect(lead.toolCalls).toBe(0)
    expect(lead.tokens).toBe(0)
  })

  it('R-10 a history window larger than 16 MiB sets historyTruncated', async () => {
    const big = `${DEFAULT_DIR}/projects/${PROJ_OTHER}/55555555-aaaa-4bbb-8ccc-000000000005.jsonl`
    const line = jsonl([userPrompt('p'.repeat(900), { ts: at(5), uuid: 'big-1', parentUuid: null, cwd: 'C:\\Users\\u\\other' })])
    const { svc } = track(await boot({ extraFiles: { [big]: line.repeat(20_000) } }))
    const snap = await svc.select({ mode: 'session', accountId: '', sessionId: '55555555-aaaa-4bbb-8ccc-000000000005' })
    expect(snap.historyTruncated).toBe(true)
  })
})

describe('R-08 sessions-changed push', () => {
  it('R-08 a new main transcript file triggers one debounced (1 s) sessions push that includes it', async () => {
    const { fs, emit, sessions } = track(await boot())
    const base = sessions.length
    const sid = '66666666-aaaa-4bbb-8ccc-000000000006'
    const p = `${DEFAULT_DIR}/projects/${PROJ_OTHER}/${sid}.jsonl`
    fs.set(p, jsonl([userPrompt('hello', { ts: at(130), sessionId: sid, cwd: 'C:\\Users\\u\\other', parentUuid: null, uuid: 'six-1' })]), { mtimeMs: NOW_MS })
    emit('add', p)
    emit('add', p)
    await flush(500)
    expect(sessions.length).toBe(base) // still debouncing
    await flush(800)
    expect(sessions.length).toBe(base + 1)
    expect(sessions[sessions.length - 1]!.map((s) => s.sessionId)).toContain(sid)
  })
})

describe('R-09 usage today through the service', () => {
  it('R-09 start enqueues the files modified today and pushes totals (deduped across the fork copy)', async () => {
    const { svc, usages, tree } = track(await boot())
    expect(svc.usageToday().day).toBe('2026-11-18')
    expect(svc.usageToday().byAccount.acme).toEqual(tree.expect.acmeTotals)
    // S4 (10 h old) counts when it was modified after local midnight; S3 (3 days old) never does.
    const midnight = new Date(NOW_MS)
    midnight.setHours(0, 0, 0, 0)
    const s4Today = tree.mtimes[tree.paths.s4]! >= midnight.getTime()
    expect(svc.usageToday().byAccount[''] ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }).toEqual(
      s4Today ? { input: 3, output: 4, cacheCreation: 0, cacheRead: 0 } : { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
    )
    expect(usages.length).toBeGreaterThan(0)
    expect(usages[usages.length - 1]!.byAccount.acme).toEqual(tree.expect.acmeTotals)
  })

  it('R-09 a changed transcript adds its new usage once and pushes after the 2 s debounce', async () => {
    const { svc, fs, emit, usages, tree } = track(await boot())
    const base = usages.length
    const before = svc.usageToday().byAccount.acme!.input
    fs.append(tree.paths.s1, jsonl(assistantBlocks([textBlock('more')], { ts: at(140), messageId: 'msg_usage_new', stopReason: 'end_turn', usage: usage(11, 2) })))
    emit('change', tree.paths.s1)
    await flush(500)
    expect(usages.length).toBe(base)
    await flush(2500)
    expect(usages.length).toBeGreaterThan(base)
    expect(svc.usageToday().byAccount.acme!.input).toBe(before + 11)
  })
})

describe('R-10 roots, dispose', () => {
  it('R-10 refreshRoots closes watchers of removed roots and watches new ones', async () => {
    let roots: typeof ROOTS = [...ROOTS]
    const { svc, watchers } = track(await boot({ roots: async () => roots }))
    roots = [ROOTS[1]!, { accountId: 'newacct', configDirAbs: 'C:/Users/u/.claude-new' }]
    await svc.refreshRoots()
    const open = watchers.filter((w) => !w.closed).map((w) => norm(w.dir))
    expect(open.some((d) => d.startsWith(norm(ACME_DIR)))).toBe(false)
    expect(open).toContain(`${norm('C:/Users/u/.claude-new')}/projects`)
    expect(open).toContain(`${norm(DEFAULT_DIR)}/projects`)
  })

  it('R-10 dispose closes every watcher, clears all timers and silences pushes', async () => {
    const { svc, watchers, emit, fs, teams, tree } = await boot()
    svc.dispose()
    expect(watchers.every((w) => w.closed)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    const n = teams.length
    fs.append(tree.paths.s1, jsonl([userPrompt('late', { ts: at(150), uuid: 'after-dispose', parentUuid: 'p' })]))
    emit('change', tree.paths.s1)
    await flush(3000)
    expect(teams.length).toBe(n)
  })

  it('R-10 the onTeam unsubscribe stops deliveries', async () => {
    const env = setup()
    track(env)
    const extra: TeamSnapshot[] = []
    const off = env.svc.onTeam((s) => extra.push(s))
    await env.svc.start()
    await flush(1000)
    expect(extra.length).toBeGreaterThan(0)
    off()
    const n = extra.length
    await env.svc.select({ mode: 'session', accountId: '', sessionId: S4 })
    expect(extra.length).toBe(n)
  })
})

describe('R-14 privacy', () => {
  it('R-14 the service never asks the fs for a .key or credentials file and has no write API', async () => {
    const { svc, fs, emit, tree } = await boot()
    track({ svc })
    await svc.select({ mode: 'session', accountId: '', sessionId: S4 })
    emit('change', tree.paths.registryKey) // a stray watcher event for a secret must be ignored too
    emit('add', tree.paths.acmeCredentials)
    await flush(3000)
    const touched = [...fs.reads, ...fs.readdirs]
    expect(touched.filter((p) => /\.key$/i.test(p))).toEqual([])
    expect(touched.filter((p) => p.toLowerCase().endsWith(CREDENTIALS_BASENAME))).toEqual([])
    expect(fs.writes).toEqual([])
  })

  it('R-14 only allowlisted file kinds are ever read', async () => {
    const { fs } = track(await boot())
    const bad = fs.reads.filter((p) => !/(\.jsonl|\.meta\.json|[\\/]sessions[\\/]\d+\.json)$/i.test(p))
    expect(bad).toEqual([])
  })
})

describe('P3-B auto stability (R-10)', () => {
  it('R-10 auto keeps the current live pick when another session becomes newer; switches once it stops being live', async () => {
    const { svc, fs, emit, tree, alive, teams } = track(await boot())
    expect(svc.snapshot().sessionId).toBe(S1)
    const pushesBefore = teams.length
    // B = S4 becomes live and more recently written than A = S1
    const regB = `${DEFAULT_DIR}/sessions/5555.json`
    alive.add(5555)
    fs.set(regB, JSON.stringify(registryEntry({ pid: 5555, sessionId: S4, status: 'busy', statusUpdatedAt: NOW_MS })))
    fs.setMtime(tree.paths.s4, NOW_MS + 500)
    emit('add', regB)
    emit('change', tree.paths.registryLive)
    await flush(2000)
    expect(svc.snapshot().sessionId).toBe(S1)
    expect(teams.slice(pushesBefore).some((t) => t.sessionId === S4)).toBe(false)
    // A's process dies: the view moves to B
    alive.delete(PID_LIVE)
    emit('change', tree.paths.registryLive)
    await flush(2000)
    expect(svc.snapshot().sessionId).toBe(S4)
  })
})

describe('P3-B usage at local midnight (R-09)', () => {
  const localDay = (ms: number): string => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  it('R-09 an idle app pushes the new day with empty totals just after local midnight, and again the next midnight', async () => {
    const d = new Date(NOW_MS)
    d.setHours(23, 59, 0, 0)
    vi.setSystemTime(d.getTime())
    const env = track(await boot({ localDay }))
    const before = env.usages.length
    const day0 = localDay(Date.now())
    await flush(30_000) // still before midnight: nothing new from the midnight timer
    expect(env.usages.slice(before).some((u) => u.day !== day0)).toBe(false)
    await flush(40_000) // crosses midnight + 1 s
    const pushed = env.usages.slice(before).filter((u) => u.day !== day0)
    expect(pushed.length).toBe(1)
    expect(pushed[0]!.byAccount).toEqual({})
    expect(pushed[0]!.day).toBe(localDay(Date.now()))
    env.svc.dispose()
    const n = env.usages.length
    await flush(5000)
    expect(env.usages.length).toBe(n)
  })
})

describe('P3-B snapshot size (advisory)', () => {
  it('a 55-agent team with 160 tool calls each stays well under 300 kB per push', async () => {
    const tree = buildTranscriptTree()
    const dir = tree.paths.sub1.replace(/\/[^/]+$/, '')
    const extra: Record<string, string> = {}
    const ids: string[] = []
    for (let n = 0; n < 55; n++) {
      const id = `b${String(n).padStart(2, '0')}c3d4e5f6a7b81`.slice(0, 17)
      ids.push(id)
      const lines: unknown[] = [userPrompt(`Task ${n}`, { ts: at(0), parentUuid: null, agentId: id, sessionId: S1 })]
      for (let i = 0; i < 160; i++) {
        const tid = `toolu_${n}_${i}`
        lines.push(
          ...assistantBlocks([toolUseBlock(tid, 'Bash', { command: `npm run build --workspace=packages/pkg-${n}-${i} && echo done` })], {
            ts: at(1 + i * 2), messageId: `msg_sz_${n}_${i}`, stopReason: 'tool_use', usage: usage(10, 5), agentId: id, sessionId: S1
          }),
          toolResult(tid, `ok ${i}: ` + 'x'.repeat(60), { ts: at(2 + i * 2), agentId: id, sessionId: S1 })
        )
      }
      extra[`${dir}/agent-${id}.jsonl`] = jsonl(lines)
      // 50 finished, 5 still running
      extra[`${dir}/agent-${id}.meta.json`] = JSON.stringify(subMeta({ toolUseId: `toolu_none_${n}`, description: `Worker number ${n} builds package ${n}`, ...(n < 50 ? { finished: true } : {}) }))
    }
    const { svc } = track(await boot({ extraFiles: extra }))
    const snap = svc.snapshot()
    expect(snap.agents.length).toBeGreaterThanOrEqual(56)
    const fin = snap.agents.filter((a) => a.runtime?.finished && ids.includes(a.id))
    expect(fin.length).toBe(50)
    for (const a of fin) expect(a.activity.length).toBeLessThanOrEqual(10)
    const bytes = JSON.stringify(snap).length
    expect(bytes).toBeLessThan(300_000)
    expect(snap.events.length).toBeLessThanOrEqual(150)
  })
})
