import { describe, expect, it, vi } from 'vitest'
import { createProjectResolver, type ExecFn } from '../../../src/main/transcripts/projectResolver'
import { createSessionIndex, type SessionIndexDeps } from '../../../src/main/transcripts/sessionIndex'
import { customTitle, jsonl, registryEntry, userPrompt, at, T0_MS } from '../../fixtures/transcripts/builders'
import {
  ACME_DIR,
  DEFAULT_DIR,
  HOME,
  NOW_MS,
  PID_DEAD,
  PID_LIVE,
  PROJ_DEMO,
  PROJ_OTHER,
  ROOTS,
  S1,
  S2,
  S3,
  S4,
  buildTranscriptTree
} from '../../fixtures/transcripts/trees'
import { createMemoryByteFs } from './memoryByteFs'

// Signature assumptions (T06 Notes): createSessionIndex({fs, platform, home, isPidAlive, nowMs}) with
// listSessions(roots, limit?), readRegistry(roots), pickAuto(roots, pty|null), resolve(roots, accountId, sessionId).
function setup(opts: { alive?: number[]; mutate?: (fs: ReturnType<typeof createMemoryByteFs>, tree: ReturnType<typeof buildTranscriptTree>) => void } = {}) {
  const tree = buildTranscriptTree()
  const fs = createMemoryByteFs(tree.files, { mtimes: tree.mtimes, caseInsensitive: true })
  opts.mutate?.(fs, tree)
  const alive = new Set(opts.alive ?? [PID_LIVE])
  const deps: SessionIndexDeps = { fs, platform: 'win32', home: HOME, isPidAlive: (pid) => alive.has(pid), nowMs: () => NOW_MS }
  return { tree, fs, alive, index: createSessionIndex(deps) }
}
const ids = (list: { sessionId: string }[]) => list.map((s) => s.sessionId)

describe('R-08 listSessions', () => {
  it('R-08 lists main transcripts across all roots, newest mtime first, never sub-agent files', async () => {
    const { index } = setup()
    const list = await index.listSessions(ROOTS)
    expect(ids(list)).toEqual([S1, S2, S4, S3])
  })

  it('R-08 summaries carry account, config dir, project dir, size and mtime', async () => {
    const { index, tree } = setup()
    const list = await index.listSessions(ROOTS)
    const s1 = list.find((s) => s.sessionId === S1)!
    expect(s1).toMatchObject({ accountId: 'acme', configDir: ACME_DIR, projectDir: PROJ_DEMO, mtimeMs: tree.mtimes[tree.paths.s1] })
    expect(s1.sizeBytes).toBe(new TextEncoder().encode(tree.files[tree.paths.s1]!).length)
    expect(list.find((s) => s.sessionId === S4)).toMatchObject({ accountId: '', configDir: DEFAULT_DIR, projectDir: PROJ_OTHER })
  })

  it('R-08 cwd comes from the first line that carries one', async () => {
    const { index } = setup()
    const list = await index.listSessions(ROOTS)
    expect(list.find((s) => s.sessionId === S1)!.cwd).toBe('d:\\work\\demo')
    expect(list.find((s) => s.sessionId === S3)!.cwd).toBe('C:\\Users\\u\\other')
  })

  it('R-08 title is the last custom > ai > agent-name record', async () => {
    const { index } = setup()
    const list = await index.listSessions(ROOTS)
    expect(list.find((s) => s.sessionId === S1)!.title).toBe('Renamed demo')
    expect(list.find((s) => s.sessionId === S2)!.title).toBe('Forked demo')
    expect(list.find((s) => s.sessionId === S4)!.title).toBeUndefined()
  })

  it('R-08 live and registryStatus come from the registry with a live pid; a dead pid does not count', async () => {
    const { index } = setup()
    const list = await index.listSessions(ROOTS)
    expect(list.find((s) => s.sessionId === S1)).toMatchObject({ live: true, registryStatus: 'waiting' })
    expect(list.find((s) => s.sessionId === S2)!.live).toBeFalsy() // registry says busy, but pid 9999 is dead
  })

  it('R-08 limit keeps the newest N', async () => {
    const { index } = setup()
    expect(ids(await index.listSessions(ROOTS, 2))).toEqual([S1, S2])
  })

  it('R-08 a missing projects dir is an empty list, not an error', async () => {
    const { index } = setup()
    expect(await index.listSessions([{ accountId: 'ghost', configDirAbs: 'C:/Users/u/.claude-ghost' }])).toEqual([])
  })

  it('R-08 an unchanged file is not re-read on the next listing (cache by mtime + size)', async () => {
    const { index, fs } = setup()
    await index.listSessions(ROOTS)
    fs.clearLog()
    await index.listSessions(ROOTS)
    expect(fs.rangeCalls).toHaveLength(0)
  })

  it('R-08 a changed file is re-read and picks up a new title', async () => {
    const { index, fs, tree } = setup()
    await index.listSessions(ROOTS)
    fs.append(tree.paths.s1, jsonl([customTitle('Brand new title')]))
    const list = await index.listSessions(ROOTS)
    expect(list.find((s) => s.sessionId === S1)!.title).toBe('Brand new title')
  })

  it('R-14 listing never opens a .key or credentials file', async () => {
    const { index, fs } = setup()
    await index.listSessions(ROOTS)
    await index.readRegistry(ROOTS)
    expect(fs.reads.filter((p) => /\.key$|credentials/i.test(p))).toEqual([])
  })
})

describe('R-08 readRegistry', () => {
  it('R-08 returns entries with a live pid, tagged with account and config dir', async () => {
    const { index } = setup()
    const reg = await index.readRegistry(ROOTS)
    expect(reg).toHaveLength(1)
    expect(reg[0]).toMatchObject({ accountId: 'acme', configDirAbs: ACME_DIR })
    expect(reg[0]!.entry).toMatchObject({ pid: PID_LIVE, sessionId: S1, status: 'waiting', waitingFor: 'dialog open' })
    expect(reg[0]!.entry).not.toHaveProperty('messagingSocketPath')
  })

  it('R-08 includes entries whose pid becomes alive', async () => {
    const { index } = setup({ alive: [PID_LIVE, PID_DEAD] })
    expect((await index.readRegistry(ROOTS)).map((r) => r.entry.pid).sort()).toEqual([PID_LIVE, PID_DEAD])
  })

  it('R-14 only digits.json registry files are read; the .key secret is never opened', async () => {
    const { index, fs, tree } = setup()
    await index.readRegistry(ROOTS)
    expect(fs.reads).not.toContain(tree.paths.registryKey)
    expect(fs.reads.every((p) => !p.endsWith('.key'))).toBe(true)
    expect(fs.reads.filter((p) => p.includes('/sessions/')).every((p) => /\/sessions\/\d+\.json$/.test(p))).toBe(true)
  })

  it('R-08 a corrupt registry file is ignored', async () => {
    const { index } = setup({ mutate: (fs) => fs.set(`${ACME_DIR}/sessions/777.json`, '{not json'), alive: [PID_LIVE, 777] })
    expect((await index.readRegistry(ROOTS)).map((r) => r.entry.pid)).toEqual([PID_LIVE])
  })

  it('R-08 a missing sessions dir is fine', async () => {
    const { index } = setup()
    expect(await index.readRegistry([{ accountId: 'ghost', configDirAbs: 'C:/Users/u/.claude-ghost' }])).toEqual([])
  })
})

describe('R-08 pickAuto: live registry, then newest within 24 h', () => {
  it('R-08 with no pty the live registry session wins', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, null)
    expect(r).toEqual({
      pick: { accountId: 'acme', sessionId: S1, configDirAbs: ACME_DIR, projectDir: PROJ_DEMO },
      waitingForSession: false
    })
  })

  it('O-3 live sessions are ordered by transcript mtime: a newer registry stamp with an older mtime loses', async () => {
    const { index } = setup({
      alive: [PID_LIVE, 5555],
      mutate: (fs, tree) => {
        // A = S1: newer statusUpdatedAt, older transcript. B = S4: older stamp, newer transcript.
        fs.set(tree.paths.registryLive, JSON.stringify(registryEntry({ sessionId: S1, status: 'busy', statusUpdatedAt: T0_MS + 99_000, updatedAt: T0_MS + 99_000 })))
        fs.set(`${DEFAULT_DIR}/sessions/5555.json`, JSON.stringify(registryEntry({ pid: 5555, sessionId: S4, status: 'busy', statusUpdatedAt: T0_MS + 1000, updatedAt: T0_MS + 1000 })))
        fs.setMtime(tree.paths.s1, NOW_MS - 100_000)
        fs.setMtime(tree.paths.s4, NOW_MS - 1000)
      }
    })
    expect((await index.pickAuto(ROOTS, null)).pick).toMatchObject({ accountId: '', sessionId: S4 })
  })

  it('O-3 registry stamps only break an mtime tie', async () => {
    const mk = (stampS4: number) =>
      setup({
        alive: [PID_LIVE, 5555],
        mutate: (fs, tree) => {
          fs.set(tree.paths.registryLive, JSON.stringify(registryEntry({ sessionId: S1, statusUpdatedAt: T0_MS + 50_000, updatedAt: T0_MS + 50_000 })))
          fs.set(`${DEFAULT_DIR}/sessions/5555.json`, JSON.stringify(registryEntry({ pid: 5555, sessionId: S4, statusUpdatedAt: stampS4, updatedAt: stampS4 })))
          fs.setMtime(tree.paths.s1, NOW_MS - 5000)
          fs.setMtime(tree.paths.s4, NOW_MS - 5000)
        }
      })
    expect((await mk(T0_MS + 99_000).index.pickAuto(ROOTS, null)).pick).toMatchObject({ sessionId: S4 })
    expect((await mk(T0_MS + 1000).index.pickAuto(ROOTS, null)).pick).toMatchObject({ sessionId: S1 })
  })

  it('R-08 a live registry entry whose session file does not exist is skipped', async () => {
    const { index } = setup({
      alive: [PID_LIVE, 5556],
      mutate: (fs) => fs.set(`${DEFAULT_DIR}/sessions/5556.json`, JSON.stringify(registryEntry({ pid: 5556, sessionId: 'no-such-session', statusUpdatedAt: T0_MS + 999_000 })))
    })
    expect((await index.pickAuto(ROOTS, null)).pick).toMatchObject({ sessionId: S1 })
  })

  it('R-08 with no live registry the newest session within 24 h is picked', async () => {
    const { index } = setup({ alive: [] })
    expect((await index.pickAuto(ROOTS, null)).pick).toMatchObject({ accountId: 'acme', sessionId: S1 })
  })

  it('R-08 sessions older than 24 h are not auto-picked', async () => {
    const { index, fs, tree } = setup({ alive: [] })
    for (const p of [tree.paths.s1, tree.paths.s2]) fs.setMtime(p, NOW_MS - 25 * 3_600_000)
    expect((await index.pickAuto(ROOTS, null)).pick).toMatchObject({ accountId: '', sessionId: S4 }) // 10 h old
    fs.setMtime(tree.paths.s4, NOW_MS - 25 * 3_600_000)
    expect(await index.pickAuto(ROOTS, null)).toEqual({ pick: null, waitingForSession: false })
  })

  it('R-08 no roots / empty disk gives no pick', async () => {
    const { index } = setup()
    expect(await index.pickAuto([], null)).toEqual({ pick: null, waitingForSession: false })
  })
})

describe('R-08 pickAuto: the app\'s own pty', () => {
  const ptyOther = (over: Record<string, unknown> = {}) => ({ pid: 7777, cwd: 'C:\\Users\\u\\other', startedAtMs: NOW_MS - 11 * 3_600_000, accountId: '', ...over })

  it('R-08 a pty whose pid is in the registry picks that registry session', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, { pid: PID_LIVE, cwd: 'anything', startedAtMs: NOW_MS, accountId: 'acme' })
    expect(r.pick).toMatchObject({ accountId: 'acme', sessionId: S1 })
  })

  it('R-08 otherwise the newest session in that account whose project dir matches the pty cwd', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, ptyOther())
    expect(r).toEqual({ pick: { accountId: '', sessionId: S4, configDirAbs: DEFAULT_DIR, projectDir: PROJ_OTHER }, waitingForSession: false })
  })

  it('R-08 the project-dir match is case-insensitive on win32', async () => {
    const { index } = setup()
    expect((await index.pickAuto(ROOTS, ptyOther({ cwd: 'c:\\USERS\\u\\Other' }))).pick).toMatchObject({ sessionId: S4 })
  })

  it('R-08 the session must be at least pty.startedAt - 5 s old (boundary inclusive)', async () => {
    const { index, tree } = setup()
    const s4m = tree.mtimes[tree.paths.s4]!
    expect((await index.pickAuto(ROOTS, ptyOther({ startedAtMs: s4m + 5000 }))).pick).toMatchObject({ sessionId: S4 })
    expect((await index.pickAuto(ROOTS, ptyOther({ startedAtMs: s4m + 5001 })).then((r) => r.pick))).toBeNull()
  })

  it('R-08 when the pty has no session file yet the answer is "waiting for session", not a fallback', async () => {
    const { index } = setup()
    expect(await index.pickAuto(ROOTS, ptyOther({ cwd: 'D:\\nowhere\\new', startedAtMs: NOW_MS }))).toEqual({ pick: null, waitingForSession: true })
    // a live registry session exists, but a running pty takes priority
    expect((await index.pickAuto(ROOTS, ptyOther({ startedAtMs: NOW_MS }))).waitingForSession).toBe(true)
  })

  it('R-08 pty pid in the registry but its transcript not written yet waits, even if another fresh session shares the cwd', async () => {
    const { index } = setup({
      alive: [PID_LIVE, 5600],
      mutate: (fs, tree) => {
        fs.set(`${DEFAULT_DIR}/sessions/5600.json`, JSON.stringify(registryEntry({ pid: 5600, sessionId: 'not-written-yet', cwd: "C:/Users/u/other" })))
        fs.setMtime(tree.paths.s4, NOW_MS - 1000) // a fresh session in the same cwd (e.g. VS Code)
      }
    })
    const r = await index.pickAuto(ROOTS, ptyOther({ pid: 5600, startedAtMs: NOW_MS - 3_600_000 }))
    expect(r).toEqual({ pick: null, waitingForSession: true })
  })

  it('R-08 a session in an oddly named folder still matches through the head cwd line', async () => {
    const odd = `${DEFAULT_DIR}/projects/very-long-hashed-folder-name-aaaaaaaa/55555555-aaaa-4bbb-8ccc-000000000005.jsonl`
    const { index } = setup({
      mutate: (fs) => fs.set(odd, jsonl([userPrompt('hello', { ts: at(0), cwd: 'C:\\Users\\u\\long project', sessionId: '55555555-aaaa-4bbb-8ccc-000000000005', parentUuid: null })]), { mtimeMs: NOW_MS - 1000 })
    })
    const r = await index.pickAuto(ROOTS, { pid: 8888, cwd: 'C:\\Users\\u\\long project', startedAtMs: NOW_MS - 3_600_000, accountId: '' })
    expect(r.pick).toMatchObject({ accountId: '', sessionId: '55555555-aaaa-4bbb-8ccc-000000000005', projectDir: 'very-long-hashed-folder-name-aaaaaaaa' })
  })

  it('R-08 a pty only looks in its own account', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, ptyOther({ accountId: 'acme' }))
    expect(r).toEqual({ pick: null, waitingForSession: true })
  })
})

describe('R-08 resolve (explicit pick)', () => {
  it('R-08 finds the config dir and project dir of a session', async () => {
    const { index } = setup()
    expect(await index.resolve(ROOTS, 'acme', S1)).toEqual({ configDirAbs: ACME_DIR, projectDir: PROJ_DEMO })
    expect(await index.resolve(ROOTS, '', S4)).toEqual({ configDirAbs: DEFAULT_DIR, projectDir: PROJ_OTHER })
  })

  it('R-08 unknown session or wrong account -> null', async () => {
    const { index } = setup()
    expect(await index.resolve(ROOTS, 'acme', 'nope')).toBeNull()
    expect(await index.resolve(ROOTS, '', S1)).toBeNull()
    expect(await index.resolve(ROOTS, 'ghost', S1)).toBeNull()
  })
})

describe('P3-T11 project grouping', () => {
  const DEMO_KEY = 'd:/repos/main'
  const OTHER_KEY = 'c:/users/u/other'
  // d:\work\demo is a linked worktree of d:/repos/main; C:\Users\u\other is not a git repo
  const exec: ExecFn = vi.fn(async (_f, args) => {
    if (String(args[1]).toLowerCase().startsWith('d:')) return { stdout: 'D:/repos/main/.git\n' }
    throw new Error('not a git repository')
  })
  function withProjects(opts: Parameters<typeof setup>[0] = {}) {
    const tree = buildTranscriptTree()
    const fs = createMemoryByteFs(tree.files, { mtimes: tree.mtimes, caseInsensitive: true })
    opts.mutate?.(fs, tree)
    const alive = new Set(opts.alive ?? [PID_LIVE])
    const projects = createProjectResolver({ exec, platform: 'win32' })
    const index = createSessionIndex({ fs, platform: 'win32', home: HOME, isPidAlive: (p) => alive.has(p), nowMs: () => NOW_MS, projects })
    return { fs, tree, index, projects }
  }

  it('listSessions carries a provisional project first, the git one once git answered', async () => {
    const { index, projects } = withProjects()
    const first = await index.listSessions(ROOTS)
    expect(first.find((s) => s.sessionId === S1)!.project).toMatchObject({ key: 'd:/work/demo', git: false })
    await projects.resolve('d:\\work\\demo')
    await projects.resolve('C:\\Users\\u\\other')
    const second = await index.listSessions(ROOTS)
    expect(second.find((s) => s.sessionId === S1)!.project).toEqual({ key: DEMO_KEY, name: 'main', root: 'D:/repos/main', git: true })
    expect(second.find((s) => s.sessionId === S2)!.project!.key).toBe(DEMO_KEY)
    expect(second.find((s) => s.sessionId === S3)!.project).toMatchObject({ key: OTHER_KEY, name: 'other', git: false })
  })

  it('pickAuto with projectKey only considers that project (live first)', async () => {
    const { index } = withProjects()
    expect((await index.pickAuto(ROOTS, null, DEMO_KEY)).pick).toMatchObject({ sessionId: S1 })
    // the other project has no live session: its newest (S4, 10 h) wins
    expect((await index.pickAuto(ROOTS, null, OTHER_KEY)).pick).toMatchObject({ accountId: '', sessionId: S4 })
  })

  it('pickAuto without projectKey is unchanged', async () => {
    const { index } = withProjects()
    expect((await index.pickAuto(ROOTS, null)).pick).toMatchObject({ sessionId: S1 })
  })

  it('a project with no session in 24 h falls back to its newest session, however old', async () => {
    const { index, fs, tree } = withProjects({ alive: [] })
    fs.setMtime(tree.paths.s4, NOW_MS - 30 * 3_600_000)
    fs.setMtime(tree.paths.s3, NOW_MS - 40 * 3_600_000)
    expect((await index.pickAuto(ROOTS, null, OTHER_KEY)).pick).toMatchObject({ sessionId: S4 })
    expect((await index.pickAuto(ROOTS, null, 'c:/nowhere')).pick).toBeNull()
  })

  it('the app pty wins only when it runs in the chosen project', async () => {
    const { index } = withProjects()
    const pty = { pid: 7777, cwd: 'C:\\Users\\u\\other', startedAtMs: NOW_MS - 11 * 3_600_000, accountId: '' }
    expect((await index.pickAuto(ROOTS, pty, OTHER_KEY)).pick).toMatchObject({ sessionId: S4 })
    // the pty is in another project: ignored, the demo project's live session is picked
    const r = await index.pickAuto(ROOTS, pty, DEMO_KEY)
    expect(r.pick).toMatchObject({ sessionId: S1 })
    expect(r.waitingForSession).toBe(false)
  })
})

describe('R-05 controlled session hints and registry fields', () => {
  it('R-05 a hint with sessionId picks that transcript, whichever session is newer', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, { pid: 1, cwd: 'C:/Users/u/other', startedAtMs: 0, accountId: '', sessionId: S4 })
    expect(r.pick).toMatchObject({ accountId: '', sessionId: S4, projectDir: PROJ_OTHER })
    expect(r.waitingForSession).toBe(false)
  })

  it('R-05 a hint whose transcript does not exist yet is waitingForSession (no cwd/mtime fallback)', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, { pid: 1, cwd: 'd:/work/demo', startedAtMs: 0, accountId: 'acme', sessionId: 'not-written-yet' })
    expect(r).toEqual({ pick: null, waitingForSession: true })
  })

  it('R-05 the session id is looked up inside the hint account only', async () => {
    const { index } = setup()
    const r = await index.pickAuto(ROOTS, { pid: 1, cwd: 'd:/work/demo', startedAtMs: 0, accountId: '', sessionId: S1 })
    expect(r).toEqual({ pick: null, waitingForSession: true })
  })

  it('R-05 listSessions carries registryPid for a live session only', async () => {
    const { index } = setup()
    const list = await index.listSessions(ROOTS)
    expect(list.find((s) => s.sessionId === S1)).toMatchObject({ live: true, registryPid: PID_LIVE })
    expect(list.find((s) => s.sessionId === S4)!.registryPid).toBeUndefined()
  })

  it('R-05 entrypoint comes from the head line of the transcript', async () => {
    const { index } = setup({
      mutate: (fs, tree) => fs.replace(tree.paths.s4, jsonl([{ ...userPrompt('hi', { ts: at(1) }), entrypoint: 'sdk-cli' }]))
    })
    const list = await index.listSessions(ROOTS)
    expect(list.find((s) => s.sessionId === S4)!.entrypoint).toBe('sdk-cli')
    expect(list.find((s) => s.sessionId === S1)!.entrypoint).toBe('cli')
  })
})
