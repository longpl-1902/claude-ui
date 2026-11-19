import { watch } from 'chokidar'
import { join as pathJoin } from 'node:path'
import { EMPTY_TEAM_SNAPSHOT } from '../../shared/teamDefaults'
import type { HookEvent, SessionSummary, TeamSelection, TeamSnapshot, TokenTotals, UsageToday } from '../../shared/types'
import type { HostEnv } from '../contracts'
import { expandHome, normalizeForCompare, samePath } from '../accounts/paths'
import { classifyTranscriptPath, projectsRoot, sessionsRegistryDir } from './layout'
import { parseLine, shouldSkipRaw } from './parseLine'
import { createProjectResolver, provisionalProject, type ExecFn } from './projectResolver'
import type { TranscriptRecord } from './records'
import { createSessionIndex, type AutoPick, type ConfigRoot, type PtyHint, type SessionIndex } from './sessionIndex'
import { createSessionModel, parseSubagentMeta, type SessionModel } from './sessionModel'
import { createTailer, type Tailer } from './tailer'
import { isTranscriptReadable, type ByteReadFs } from './transcriptFs'
import { createUsageCounter } from './usageToday'
import { DEFAULT_VIEWER, type ViewerId } from './viewer'

export { DEFAULT_VIEWER, type ViewerId } from './viewer'

export interface DirWatcher {
  close(): void
}
export type WatchDir = (
  absDir: string,
  opts: { depth: number },
  onEvent: (kind: 'add' | 'change' | 'unlink', absPath: string) => void
) => DirWatcher

export interface TranscriptServiceDeps {
  fs: ByteReadFs
  host: HostEnv
  roots(): Promise<ConfigRoot[]>
  ptyHint(): PtyHint | null
  /** Newest controlled session with state != draft/exited; wins over ptyHint in auto mode. */
  controlHint?: () => PtyHint | null
  /** Controlled sessions whose transcript id is known (marks them in the session list). */
  controlledSessions?: () => { sessionId: string; controlId: string }[]
  watchDir: WatchDir
  isPidAlive(pid: number): boolean
  nowMs(): number
  localDay(ms: number): string
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
  /** execFile-shaped runner used for `git rev-parse` (project grouping). Absent: sessions group by cwd only. */
  execGit?: ExecFn
}

export interface TranscriptService {
  start(): Promise<void>
  snapshot(viewer?: ViewerId): TeamSnapshot
  listSessions(): Promise<SessionSummary[]>
  select(sel: TeamSelection, viewer?: ViewerId): Promise<TeamSnapshot>
  getSelection(viewer?: ViewerId): TeamSelection
  /** Drops a closed window's viewer; its session goes when no viewer is left. No-op for DEFAULT_VIEWER / unknown ids. */
  releaseViewer(viewer: ViewerId): void
  /** Viewers that currently show a session (for toast suppression). */
  viewing(): { viewer: ViewerId; accountId: string; sessionId: string }[]
  usageToday(): UsageToday
  usageByProject(): Record<string, TokenTotals>
  ingestHook(e: HookEvent): void
  onActivity(cb: (kind: 'file-edit') => void): () => void
  isSessionLive(accountId: string, sessionId: string): Promise<boolean>
  onFileChange(cb: (path: string) => void): () => void
  refreshRoots(): Promise<void>
  onPtyChanged(): void
  onTeam(cb: (s: TeamSnapshot, viewer: ViewerId) => void): () => void
  onSessions(cb: (s: SessionSummary[]) => void): () => void
  onUsage(cb: (u: UsageToday) => void): () => void
  dispose(): void
}

/** Config roots for the service: every account's dir plus the default `~/.claude` (accountId '') when no account uses it. */
export function buildRoots(accounts: { id: string; configDir: string }[], host: HostEnv): ConfigRoot[] {
  const out: ConfigRoot[] = []
  const has = (abs: string): boolean => out.some((r) => samePath(r.configDirAbs, abs, host.home, host.platform))
  for (const a of accounts) {
    const abs = expandHome(a.configDir, host.home)
    if (abs && !has(abs)) out.push({ accountId: a.id, configDirAbs: abs })
  }
  const def = pathJoin(host.home, '.claude')
  if (!has(def)) out.push({ accountId: '', configDirAbs: def })
  return out
}

export function createChokidarWatchDir(): WatchDir {
  return (absDir, opts, onEvent) => {
    let closed = false
    const w = watch(absDir, {
      depth: opts.depth,
      ignoreInitial: true,
      followSymlinks: false,
      // Files are admitted only when the transcript allowlist would let us read them (never *.key / credentials).
      ignored: (p, stats) => {
        if (stats?.isFile()) return !isTranscriptReadable(p)
        if (stats) return false
        const base = p.split(/[\\/]/).pop() ?? ''
        return base.includes('.') && !isTranscriptReadable(p)
      }
    })
    w.on('add', (p) => !closed && onEvent('add', p))
    w.on('change', (p) => !closed && onEvent('change', p))
    w.on('unlink', (p) => !closed && onEvent('unlink', p))
    w.on('error', () => undefined)
    return {
      close: () => {
        closed = true
        void w.close().catch(() => undefined)
      }
    }
  }
}

// Real (never faked) clock and macrotask yield: used only to cut long synchronous work into <= SLICE_MS pieces.
const realNow = performance.now.bind(performance)
const realImmediate = globalThis.setImmediate.bind(globalThis)
const SLICE_MS = 8

const PUSH_MS = 250
const POLL_MS = 1000
const SESSIONS_DEBOUNCE_MS = 1000
const USAGE_DEBOUNCE_MS = 2000
const BATCH_LINES = 400
const MAX_SUB_DEPTH = 4
/** Pushed snapshots trim activity: finished agents always, running ones too in a large team (the model keeps more). */
const LARGE_TEAM = 12
const FINISHED_ACTIVITY_CAP = 30
const LARGE_FINISHED_ACTIVITY_CAP = 25
/** Finished agents of a large team share this many activity items, so a push stays small however many finish. */
const LARGE_FINISHED_ITEM_BUDGET = 750
const MIN_LARGE_FINISHED_ACTIVITY_CAP = 10
const LARGE_RUNNING_ACTIVITY_CAP = 30
/** A push carries the newest part of the feed only (the model keeps more for history). */
const SNAPSHOT_EVENTS_CAP = 150
const SNAPSHOT_CONSOLE_CAP = 100
const MIDNIGHT_SLACK_MS = 1000
const ACTIVITY_DEBOUNCE_MS = 500
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type Kind = 'main' | 'sub' | 'meta'
interface FileRec {
  path: string
  kind: Kind
  /** 'lead' or the agentId */
  source: string
  size: number
  mtimeMs: number
  metaPath?: string
}
interface Session {
  /** pickKey(pick) = `${accountId}|${sessionId}|${norm(configDirAbs)}` */
  key: string
  pick: AutoPick
  model: SessionModel
  tailer: Tailer
  files: Map<string, FileRec>
  subDir: string
  registryJson: string
  /** refcount: the viewers that show this session */
  viewers: Set<ViewerId>
}
interface Viewer {
  id: ViewerId
  selection: TeamSelection
  session: Session | null
  waiting: boolean
}
interface RootWatch {
  key: string
  root: ConfigRoot
  watchers: { dir: string; depth: number; existed: boolean; w: DirWatcher }[]
}

export function createTranscriptService(deps: TranscriptServiceDeps): TranscriptService {
  const { fs, host } = deps
  const platform = host.platform
  const norm = (p: string): string => normalizeForCompare(p, platform)
  // a git answer re-pushes the session list (its projects were provisional until then)
  const projects = deps.execGit ? createProjectResolver({ exec: deps.execGit, platform, onResolved: () => scheduleSessions() }) : undefined
  const index: SessionIndex = createSessionIndex({ fs, platform, home: host.home, isPidAlive: deps.isPidAlive, nowMs: deps.nowMs, ...(projects ? { projects } : {}) })
  /** encoded project dir (normalized) -> cwd, learned from session listings; feeds the per-project usage keys */
  const dirCwd = new Map<string, string>()
  const projectKeyOf = (filePath: string): string => {
    for (const r of roots) {
      const info = classifyTranscriptPath(filePath, projectsRoot(r.configDirAbs))
      if (!info) continue
      const cwd = dirCwd.get(norm(info.projectDir))
      const hit = cwd !== undefined ? projects?.cached(cwd) : undefined
      return (hit ?? provisionalProject(cwd, info.projectDir, platform)).key
    }
    return ''
  }
  const counter = createUsageCounter({ fs, nowMs: deps.nowMs, localDay: deps.localDay, projectKeyOf })

  let disposed = false
  let roots: ConfigRoot[] = []
  const rootWatches = new Map<string, RootWatch>()
  let started = false
  const sessions = new Map<string, Session>()
  const viewers = new Map<ViewerId, Viewer>([[DEFAULT_VIEWER, { id: DEFAULT_VIEWER, selection: { mode: 'auto' }, session: null, waiting: false }]])
  const pendingTail = new Map<string, Session>()
  /** viewers owed a throttled push */
  const pushQueue = new Set<ViewerId>()
  const isActive = (s: Session): boolean => !disposed && sessions.get(s.key) === s
  const isLiveViewer = (v: Viewer): boolean => !disposed && viewers.get(v.id) === v
  const viewersOf = (s: Session): Viewer[] => [...s.viewers].flatMap((id) => viewers.get(id) ?? [])
  let drainQueued = false
  let repickQueued = false
  let pollTick = 0

  let pushTimer: unknown = null
  let sessionsTimer: unknown = null
  let usageTimer: unknown = null
  let pollTimer: unknown = null
  let midnightTimer: unknown = null
  let pumping = false
  const usageEnumerated = new Set<string>()

  const teamCbs = new Set<(s: TeamSnapshot, v: ViewerId) => void>()
  const sessionCbs = new Set<(s: SessionSummary[]) => void>()
  const usageCbs = new Set<(u: UsageToday) => void>()
  const activityCbs = new Set<(k: 'file-edit') => void>()
  const fileChangeCbs = new Set<(p: string) => void>()
  let activityTimer: unknown = null
  const knownSessions = new Set<string>()
  const fire = <T>(cbs: Set<(v: T) => void>, v: T): void => {
    for (const cb of [...cbs]) {
      try {
        cb(v)
      } catch {
        /* a listener must not break the service */
      }
    }
  }

  const fireTeam = (s: TeamSnapshot, v: ViewerId): void => {
    for (const cb of [...teamCbs]) {
      try {
        cb(s, v)
      } catch {
        /* a listener must not break the service */
      }
    }
  }

  // ---- cooperative scheduling -------------------------------------------------------------------------------
  let sliceStart = realNow()
  const startSlice = (): void => void (sliceStart = realNow())
  async function slice(): Promise<void> {
    if (realNow() - sliceStart < SLICE_MS) return
    await new Promise<void>((r) => realImmediate(r))
    sliceStart = realNow()
  }

  // One serial lane for everything that touches the selected session (switch, tail, poll, registry).
  let chain: Promise<unknown> = Promise.resolve()
  function run<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(() => {
      if (disposed) return undefined as T
      startSlice()
      return fn()
    })
    chain = p.catch(() => undefined)
    return p
  }
  const bg = (fn: () => Promise<unknown>): void => void run(fn).catch(() => undefined)

  const clear = (t: unknown): void => {
    if (t !== null) deps.clearTimer(t)
  }

  // ---- snapshots ---------------------------------------------------------------------------------------------
  function sessionSnapshot(s: Session): TeamSnapshot {
    const snap = s.model.snapshot(deps.nowMs())
    const large = snap.agents.length > LARGE_TEAM
    const finishedCount = snap.agents.filter((a) => a.runtime?.finished).length
    const largeFinishedCap = Math.max(
      MIN_LARGE_FINISHED_ACTIVITY_CAP,
      Math.min(LARGE_FINISHED_ACTIVITY_CAP, Math.floor(LARGE_FINISHED_ITEM_BUDGET / Math.max(1, finishedCount)))
    )
    for (const a of snap.agents) {
      const cap = a.runtime?.finished ? (large ? largeFinishedCap : FINISHED_ACTIVITY_CAP) : large ? LARGE_RUNNING_ACTIVITY_CAP : Infinity
      if (a.activity.length > cap) a.activity = a.activity.slice(-cap)
    }
    if (snap.events.length > SNAPSHOT_EVENTS_CAP) snap.events = snap.events.slice(-SNAPSHOT_EVENTS_CAP)
    if (snap.console.length > SNAPSHOT_CONSOLE_CAP) snap.console = snap.console.slice(-SNAPSHOT_CONSOLE_CAP)
    return snap
  }
  function emptySnapshot(waiting: boolean): TeamSnapshot {
    const s = structuredClone(EMPTY_TEAM_SNAPSHOT)
    if (waiting) s.waitingForSession = true
    return s
  }
  function viewerSnapshot(v: Viewer): TeamSnapshot {
    const sel = v.session
    if (!sel) return emptySnapshot(v.waiting)
    // model.snapshot() clears the dirty flag: when this read consumed pending changes (e.g. while ingestLines awaits),
    // afterIngest would see "clean" and the session's other viewers would never get the push. Schedule it here.
    const wasDirty = sel.model.isDirty()
    const snap = sessionSnapshot(sel)
    if (wasDirty && isActive(sel)) schedulePush(sel)
    return snap
  }
  function pushNow(vs: Iterable<Viewer>): void {
    if (disposed) return
    // a session's snapshot is computed once per call (model.snapshot() clears its dirty flag)
    const memo = new Map<Session, TeamSnapshot>()
    for (const v of [...vs]) {
      if (!isLiveViewer(v)) continue
      pushQueue.delete(v.id)
      let snap: TeamSnapshot
      if (v.session) {
        snap = memo.get(v.session) ?? sessionSnapshot(v.session)
        memo.set(v.session, snap)
      } else snap = emptySnapshot(v.waiting)
      fireTeam(snap, v.id)
    }
    if (pushQueue.size === 0) {
      clear(pushTimer)
      pushTimer = null
    }
  }
  function schedulePush(s: Session): void {
    if (disposed) return
    for (const id of s.viewers) pushQueue.add(id)
    if (pushTimer !== null) return
    pushTimer = deps.setTimer(() => {
      pushTimer = null
      pushNow([...pushQueue].flatMap((id) => viewers.get(id) ?? []))
    }, PUSH_MS)
  }
  const afterIngest = (sel: Session): void => {
    if (isActive(sel) && sel.model.isDirty()) schedulePush(sel)
  }

  // ---- file registration -------------------------------------------------------------------------------------
  const subDirOf = (pick: AutoPick): string => `${pick.configDirAbs.replace(/[\\/]+$/, '')}/projects/${pick.projectDir}/${pick.sessionId}/subagents`

  function register(sel: Session, path: string, kind: Kind, source: string, metaPath?: string): FileRec | null {
    const key = norm(path)
    if (sel.files.has(key)) return null
    const rec: FileRec = { path, kind, source, size: -1, mtimeMs: -1 }
    if (metaPath !== undefined) rec.metaPath = metaPath
    sel.files.set(key, rec)
    return rec
  }

  function registerSubPath(sel: Session, path: string): FileRec | null {
    const m = /(?:^|[\\/])agent-(.+?)\.(jsonl|meta\.json)$/i.exec(path)
    if (!m) return null
    const agentId = m[1]!
    if (m[2]!.toLowerCase() === 'jsonl') return register(sel, path, 'sub', agentId, path.slice(0, path.length - '.jsonl'.length) + '.meta.json')
    return register(sel, path, 'meta', agentId)
  }

  async function scanSubagents(sel: Session, dir: string, depth: number, found: FileRec[]): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) {
        if (depth < MAX_SUB_DEPTH) await scanSubagents(sel, p, depth + 1, found)
      } else if (e.isFile()) {
        const rec = registerSubPath(sel, p)
        if (rec) found.push(rec)
      }
    }
  }

  // ---- activity ----------------------------------------------------------------------------------------------
  const isEdit = (rec: TranscriptRecord): boolean =>
    rec.t === 'assistant'
      ? rec.toolUses.some((u) => EDIT_TOOLS.has(u.name))
      : rec.t === 'tool_results' && rec.results.some((r) => r.fileChange !== undefined && !r.isError)
  function scheduleActivity(): void {
    if (activityTimer !== null || disposed) return
    activityTimer = deps.setTimer(() => {
      activityTimer = null
      if (!disposed) fire(activityCbs, 'file-edit')
    }, ACTIVITY_DEBOUNCE_MS)
  }

  // ---- tail --------------------------------------------------------------------------------------------------
  async function ingestLines(sel: Session, source: string, lines: string[]): Promise<void> {
    let batch: TranscriptRecord[] = []
    let n = 0
    for (const line of lines) {
      if (shouldSkipRaw(line)) continue
      const rec = parseLine(line)
      if (rec) {
        batch.push(rec)
        if (isActive(sel) && isEdit(rec)) scheduleActivity()
      }
      if (++n % BATCH_LINES === 0) {
        sel.model.ingest(source, batch)
        batch = []
        await slice()
        if (!isActive(sel)) return
      }
    }
    if (batch.length > 0) sel.model.ingest(source, batch)
  }

  async function loadMeta(sel: Session, agentId: string, metaPath: string): Promise<void> {
    let text: string
    try {
      text = await fs.readText(metaPath)
    } catch {
      return
    }
    const meta = parseSubagentMeta(text)
    if (meta && isActive(sel)) sel.model.setMeta(agentId, meta)
  }

  async function processFile(sel: Session, rec: FileRec): Promise<void> {
    let st
    try {
      st = await fs.stat(rec.path)
    } catch {
      return
    }
    if (!st || !isActive(sel)) return
    const first = rec.size < 0
    rec.size = st.size
    rec.mtimeMs = st.mtimeMs
    if (rec.kind === 'meta') {
      await loadMeta(sel, rec.source, rec.path)
    } else {
      // a sub-agent's meta is read with its first tail unless the meta file is tracked (and processed) on its own
      if (rec.kind === 'sub' && first && rec.metaPath && !sel.files.has(norm(rec.metaPath))) await loadMeta(sel, rec.source, rec.metaPath)
      for (;;) {
        let r
        try {
          r = await sel.tailer.read(rec.path)
        } catch {
          break
        }
        if (!isActive(sel)) return
        if (r.reset) sel.model.reset(rec.source)
        if (r.skippedBytes > 0) sel.model.markHistoryTruncated()
        await ingestLines(sel, rec.source, r.lines)
        if (!isActive(sel) || r.eof) break
        await slice()
        if (!isActive(sel)) return
      }
    }
    afterIngest(sel)
  }

  function enqueue(sel: Session, rec: FileRec): void {
    pendingTail.set(norm(rec.path), sel)
    if (drainQueued || disposed) return
    drainQueued = true
    bg(async () => {
      drainQueued = false
      while (pendingTail.size > 0 && !disposed) {
        const [key, sel] = pendingTail.entries().next().value as [string, Session]
        pendingTail.delete(key)
        if (!isActive(sel)) continue
        const rec2 = sel.files.get(key)
        if (rec2) await processFile(sel, rec2)
      }
    })
  }

  async function refreshRegistry(sel: Session): Promise<void> {
    const live = (await index.readRegistry(roots)).filter((l) => l.accountId === sel.pick.accountId && l.entry.sessionId === sel.pick.sessionId)
    if (!isActive(sel)) return
    const stamp = (e: { statusUpdatedAt?: number; updatedAt?: number }): number => e.statusUpdatedAt ?? e.updatedAt ?? 0
    const best = live.sort((a, b) => stamp(b.entry) - stamp(a.entry))[0]
    const value = best
      ? {
          ...(best.entry.status ? { status: best.entry.status } : {}),
          ...(best.entry.waitingFor !== undefined ? { waitingFor: best.entry.waitingFor } : {}),
          updatedMs: stamp(best.entry)
        }
      : null
    const json = JSON.stringify(value)
    if (json === sel.registryJson) return
    sel.registryJson = json
    sel.model.setRegistry(value)
    afterIngest(sel)
  }

  // ---- selection ---------------------------------------------------------------------------------------------
  const samePick = (a: AutoPick, b: AutoPick): boolean =>
    a.accountId === b.accountId && a.sessionId === b.sessionId && norm(a.configDirAbs) === norm(b.configDirAbs)

  const pickKey = (p: AutoPick): string => `${p.accountId}|${p.sessionId}|${norm(p.configDirAbs)}`

  /** Unlinks the viewer from its session; the session is dropped (no more reads) once no viewer is left. */
  function detach(v: Viewer): void {
    const s = v.session
    if (!s) return
    v.session = null
    s.viewers.delete(v.id)
    if (s.viewers.size > 0) return
    if (sessions.get(s.key) === s) sessions.delete(s.key)
    for (const [k, owner] of [...pendingTail]) if (owner === s) pendingTail.delete(k)
  }

  async function attach(v: Viewer, pick: AutoPick | null): Promise<void> {
    if (!isLiveViewer(v)) return
    if (pick && v.session && v.session.key === pickKey(pick)) {
      pushNow([v])
      return
    }
    detach(v)
    if (!pick) {
      pushNow([v])
      return
    }
    const key = pickKey(pick)
    const have = sessions.get(key)
    if (have) {
      // lane tasks are serial, so an existing session is already loaded
      have.viewers.add(v.id)
      v.session = have
      pushNow([v])
      return
    }
    const sess: Session = {
      key,
      pick,
      model: createSessionModel({ sessionId: pick.sessionId, accountId: pick.accountId }),
      tailer: createTailer(fs),
      files: new Map(),
      subDir: subDirOf(pick),
      registryJson: 'null',
      viewers: new Set([v.id])
    }
    sessions.set(key, sess)
    v.session = sess
    const main = register(sess, `${pick.configDirAbs.replace(/[\\/]+$/, '')}/projects/${pick.projectDir}/${pick.sessionId}.jsonl`, 'main', 'lead')!
    const subs: FileRec[] = []
    await scanSubagents(sess, sess.subDir, 0, subs)
    // metas first (so tree links exist), then the main file, then sub-agent files
    for (const rec of [...subs.filter((r) => r.kind === 'meta'), main, ...subs.filter((r) => r.kind === 'sub')]) {
      if (!isActive(sess)) return
      await processFile(sess, rec)
    }
    if (!isActive(sess)) return
    await refreshRegistry(sess)
    if (!isActive(sess)) return
    pushNow(viewersOf(sess))
  }

  async function isLive(pick: AutoPick): Promise<boolean> {
    return (await index.readRegistry(roots)).some((l) => l.accountId === pick.accountId && l.entry.sessionId === pick.sessionId)
  }

  /** `force`: a user's choice of project/auto, which must not be held back by the keep-current-pick stability rule. */
  async function applyAuto(v: Viewer, force = false, memo?: Map<string, ReturnType<SessionIndex['pickAuto']>>): Promise<void> {
    if (!isLiveViewer(v) || v.selection.mode !== 'auto') return
    const hint = deps.controlHint?.() ?? deps.ptyHint()
    const projectKey = v.selection.projectKey
    const memoKey = projectKey ?? ''
    let picking = memo?.get(memoKey)
    if (!picking) {
      picking = index.pickAuto(roots, hint, projectKey)
      memo?.set(memoKey, picking)
    }
    const { pick, waitingForSession: waiting } = await picking
    if (!isLiveViewer(v) || v.selection.mode !== 'auto') return
    // Stability: without a pty (the highest tier) keep the current pick while it is still live, so two busy
    // sessions do not make the view flip (each flip re-backfills every sub-agent file).
    if (!force && v.session && hint === null && (await isLive(v.session.pick))) {
      if (!isLiveViewer(v) || v.selection.mode !== 'auto') return
      if (v.waiting) {
        v.waiting = false
        pushNow([v])
      }
      return
    }
    const waitChanged = waiting !== v.waiting
    v.waiting = waiting
    if (pick && v.session && samePick(pick, v.session.pick)) return
    if (!pick && !v.session) {
      if (waitChanged) pushNow([v])
      return
    }
    await attach(v, pick)
  }

  /** One re-pick pass over every viewer in auto mode (the pick is shared per project key). */
  async function repickAll(): Promise<void> {
    const memo = new Map<string, ReturnType<SessionIndex['pickAuto']>>()
    for (const v of [...viewers.values()]) if (v.selection.mode === 'auto') await applyAuto(v, false, memo)
  }

  function scheduleRepick(): void {
    if (repickQueued || ![...viewers.values()].some((v) => v.selection.mode === 'auto')) return
    repickQueued = true
    bg(async () => {
      repickQueued = false
      await repickAll()
    })
  }

  /** The viewer of a window; created on first use in auto mode (with a background pick once the service runs). */
  function viewerFor(id: ViewerId, autoPick = true): Viewer {
    let v = viewers.get(id)
    if (!v) {
      const fresh: Viewer = { id, selection: { mode: 'auto' }, session: null, waiting: false }
      v = fresh
      viewers.set(id, fresh)
      if (autoPick && started && !disposed) bg(() => applyAuto(fresh))
    }
    return v
  }

  // ---- sessions / usage pushes -------------------------------------------------------------------------------

  async function listAll(): Promise<SessionSummary[]> {
    const list = await index.listSessions(roots)
    const ctl = new Map((deps.controlledSessions?.() ?? []).map((c) => [c.sessionId, c.controlId]))
    knownSessions.clear()
    for (const s of list) {
      knownSessions.add(s.sessionId)
      if (s.cwd !== undefined) dirCwd.set(norm(s.projectDir), s.cwd)
      const controlId = ctl.get(s.sessionId)
      if (controlId !== undefined) {
        s.controlled = true
        s.controlId = controlId
      }
    }
    return list
  }
  function scheduleSessions(): void {
    if (disposed) return
    clear(sessionsTimer)
    sessionsTimer = deps.setTimer(() => {
      sessionsTimer = null
      bg(async () => {
        const list = await listAll()
        if (!disposed) fire(sessionCbs, list)
      })
    }, SESSIONS_DEBOUNCE_MS)
  }
  function scheduleUsagePush(): void {
    if (disposed) return
    clear(usageTimer)
    usageTimer = deps.setTimer(() => {
      usageTimer = null
      if (!disposed) fire(usageCbs, counter.today())
    }, USAGE_DEBOUNCE_MS)
  }
  /** Arms a timer for the next local midnight (+1 s) that pushes today's (now empty) totals, then re-arms itself. */
  function scheduleMidnight(): void {
    if (disposed) return
    clear(midnightTimer)
    const d = new Date(deps.nowMs())
    d.setHours(24, 0, 0, 0)
    const delay = Math.max(MIDNIGHT_SLACK_MS, d.getTime() - deps.nowMs() + MIDNIGHT_SLACK_MS)
    midnightTimer = deps.setTimer(() => {
      midnightTimer = null
      if (disposed) return
      fire(usageCbs, counter.today())
      scheduleMidnight()
    }, delay)
  }
  function kickPump(): void {
    if (pumping || disposed) return
    pumping = true
    void (async () => {
      startSlice()
      try {
        while (!disposed && (await counter.pump())) await slice()
      } catch {
        /* the counter skips unreadable files itself */
      } finally {
        pumping = false
      }
      scheduleUsagePush()
    })()
  }

  function localMidnight(): number {
    const d = new Date(deps.nowMs())
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  /** Queue today's transcripts (main + sub-agents) of one root for the usage counter. Async, yields between files. */
  async function enumerateUsage(root: ConfigRoot): Promise<void> {
    const midnight = localMidnight()
    const base = projectsRoot(root.configDirAbs).replace(/\\/g, '/')
    const tryAdd = async (path: string): Promise<void> => {
      try {
        const st = await fs.stat(path)
        if (st && st.isFile && st.mtimeMs >= midnight) {
          counter.addFile(path, root.accountId)
          kickPump()
        }
      } catch {
        /* skip */
      }
    }
    const safeDir = async (p: string) => {
      try {
        return await fs.readdir(p)
      } catch {
        return []
      }
    }
    const walkSubs = async (dir: string, depth: number): Promise<void> => {
      for (const e of await safeDir(dir)) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) {
          if (depth < MAX_SUB_DEPTH) await walkSubs(p, depth + 1)
        } else if (e.isFile() && /^agent-.+\.jsonl$/i.test(e.name)) {
          await tryAdd(p)
          await slice()
        }
      }
    }
    for (const proj of await safeDir(base)) {
      if (disposed) return
      if (!proj.isDirectory()) continue
      const dir = `${base}/${proj.name}`
      for (const f of await safeDir(dir)) {
        if (disposed) return
        if (f.isFile() && /\.jsonl$/i.test(f.name)) await tryAdd(`${dir}/${f.name}`)
        else if (f.isDirectory()) await walkSubs(`${dir}/${f.name}/subagents`, 0)
        await slice()
      }
    }
    kickPump()
  }

  // ---- watchers ----------------------------------------------------------------------------------------------
  const rootKey = (r: ConfigRoot): string => `${r.accountId}|${norm(r.configDirAbs)}`

  async function dirExists(p: string): Promise<boolean> {
    try {
      await fs.readdir(p)
      return true
    } catch {
      return false
    }
  }

  async function openWatchers(rw: RootWatch): Promise<void> {
    const specs = [
      { dir: projectsRoot(rw.root.configDirAbs), depth: 4 },
      { dir: sessionsRegistryDir(rw.root.configDirAbs), depth: 0 }
    ]
    for (const s of specs) {
      const existed = await dirExists(s.dir)
      if (disposed) return
      rw.watchers.push({ ...s, existed, w: deps.watchDir(s.dir, { depth: s.depth }, (kind, p) => onFsEvent(rw.root, kind, p)) })
    }
  }

  async function syncRoots(): Promise<void> {
    const next = await deps.roots()
    const deduped: ConfigRoot[] = []
    for (const r of next) {
      if (!deduped.some((d) => samePath(d.configDirAbs, r.configDirAbs, host.home, platform))) deduped.push(r)
    }
    roots = deduped
    const keys = new Set(roots.map(rootKey))
    for (const [k, rw] of [...rootWatches]) {
      if (keys.has(k)) continue
      for (const w of rw.watchers) w.w.close()
      rootWatches.delete(k)
      usageEnumerated.delete(k)
      if (!roots.some((r) => r.accountId === rw.root.accountId)) counter.forgetAccount(rw.root.accountId)
    }
    for (const r of roots) {
      const k = rootKey(r)
      const have = rootWatches.get(k)
      if (!have) {
        const rw: RootWatch = { key: k, root: r, watchers: [] }
        rootWatches.set(k, rw)
        await openWatchers(rw)
      } else {
        // a dir that did not exist yet may exist now: watch it again
        for (const w of have.watchers) {
          if (!w.existed && (await dirExists(w.dir))) {
            w.w.close()
            w.existed = true
            w.w = deps.watchDir(w.dir, { depth: w.depth }, (kind, p) => onFsEvent(r, kind, p))
          }
        }
      }
      if (!usageEnumerated.has(k)) {
        usageEnumerated.add(k)
        void enumerateUsage(r)
      }
    }
    for (const sess of [...sessions.values()]) {
      if (roots.some((r) => r.accountId === sess.pick.accountId && norm(r.configDirAbs) === norm(sess.pick.configDirAbs))) continue
      for (const v of viewersOf(sess)) await attach(v, null)
    }
  }

  function onFsEvent(root: ConfigRoot, kind: 'add' | 'change' | 'unlink', path: string): void {
    if (disposed || !isTranscriptReadable(path)) return
    const regDir = norm(sessionsRegistryDir(root.configDirAbs))
    const cmp = norm(path)
    if (cmp.startsWith(regDir + '/')) {
      scheduleSessions()
      scheduleRepick()
      for (const sel of sessions.values()) bg(() => refreshRegistry(sel))
      return
    }
    const info = classifyTranscriptPath(path, projectsRoot(root.configDirAbs))
    if (!info) return
    if (/\.jsonl$/i.test(path)) fire(fileChangeCbs, path)
    if (info.kind !== 'meta' && kind !== 'unlink') {
      counter.addFile(path, root.accountId)
      kickPump()
    }
    if (info.kind === 'main' && kind !== 'change') {
      scheduleSessions()
      if (kind === 'add') scheduleRepick()
    }
    if (kind === 'unlink') return
    const sel = sessions.get(`${root.accountId}|${info.sessionId}|${norm(root.configDirAbs)}`)
    if (!sel) return
    let rec = sel.files.get(cmp)
    if (!rec) {
      if (info.kind === 'main') return // the main file is registered at selection time
      rec = registerSubPath(sel, path) ?? undefined
    }
    if (rec) enqueue(sel, rec)
  }

  // ---- polling backup ----------------------------------------------------------------------------------------
  async function pollOnce(): Promise<void> {
    if (sessions.size === 0) return
    pollTick++
    for (const sel of [...sessions.values()]) {
      for (const rec of [...sel.files.values()]) {
        if (!isActive(sel)) break
        let st
        try {
          st = await fs.stat(rec.path)
        } catch {
          continue
        }
        if (st && (st.size !== rec.size || st.mtimeMs !== rec.mtimeMs)) enqueue(sel, rec)
      }
      if (pollTick % 2 === 0 && isActive(sel)) {
        const found: FileRec[] = []
        await scanSubagents(sel, sel.subDir, 0, found)
        for (const rec of found) enqueue(sel, rec)
        await refreshRegistry(sel)
      }
    }
  }
  function schedulePoll(): void {
    if (disposed) return
    pollTimer = deps.setTimer(() => {
      pollTimer = null
      bg(async () => {
        try {
          await pollOnce()
        } finally {
          schedulePoll()
        }
      })
    }, POLL_MS)
  }

  // ---- public ------------------------------------------------------------------------------------------------
  return {
    start() {
      return run(async () => {
        await syncRoots()
        started = true
        await applyAuto(viewerFor(DEFAULT_VIEWER))
        schedulePoll()
        scheduleMidnight()
      })
    },
    snapshot: (viewer = DEFAULT_VIEWER) => viewerSnapshot(viewerFor(viewer)),
    listSessions: () => listAll(),
    select(sel, viewer = DEFAULT_VIEWER) {
      const existed = viewers.has(viewer)
      const v = viewerFor(viewer, false)
      return run(async () => {
        if (sel.mode === 'auto') {
          v.selection = sel.projectKey !== undefined ? { mode: 'auto', projectKey: sel.projectKey } : { mode: 'auto' }
          await applyAuto(v, true)
        } else {
          const r = await index.resolve(roots, sel.accountId, sel.sessionId)
          if (r && isLiveViewer(v)) {
            v.selection = { mode: 'session', accountId: sel.accountId, sessionId: sel.sessionId }
            v.waiting = false
            await attach(v, { accountId: sel.accountId, sessionId: sel.sessionId, configDirAbs: r.configDirAbs, projectDir: r.projectDir })
          } else if (!existed && started) await applyAuto(v)
        }
        return viewerSnapshot(v)
      })
    },
    getSelection: (viewer = DEFAULT_VIEWER) => ({ ...viewerFor(viewer).selection }) as TeamSelection,
    releaseViewer(viewer) {
      if (viewer === DEFAULT_VIEWER) return
      const v = viewers.get(viewer)
      if (!v) return
      viewers.delete(viewer)
      pushQueue.delete(viewer)
      detach(v)
    },
    viewing: () =>
      [...viewers.values()].flatMap((v) => (v.session ? [{ viewer: v.id, accountId: v.session.pick.accountId, sessionId: v.session.pick.sessionId }] : [])),
    usageToday: () => counter.today(),
    usageByProject: () => counter.todayByProject(),
    refreshRoots() {
      return run(async () => {
        await syncRoots()
        scheduleSessions()
        await repickAll()
      })
    },
    ingestHook(e) {
      if (disposed) return
      let hit = false
      for (const sel of [...sessions.values()]) {
        if (e.sessionId !== sel.pick.sessionId) continue
        hit = true
        sel.model.applyHook(e)
        afterIngest(sel)
        // same lane as the poll: pick up whatever the hook just announced without waiting for the next tick
        bg(async () => {
          if (!isActive(sel)) return
          for (const rec of [...sel.files.values()]) {
            if (!isActive(sel)) return
            await processFile(sel, rec)
          }
        })
      }
      if (hit) return
      if (!knownSessions.has(e.sessionId) && sessionsTimer === null) scheduleSessions()
    },
    onActivity(cb) {
      activityCbs.add(cb)
      return () => void activityCbs.delete(cb)
    },
    async isSessionLive(accountId, sessionId) {
      return (await index.readRegistry(roots)).some((l) => l.accountId === accountId && l.entry.sessionId === sessionId)
    },
    onFileChange(cb) {
      fileChangeCbs.add(cb)
      return () => void fileChangeCbs.delete(cb)
    },
    onPtyChanged() {
      scheduleRepick()
    },
    onTeam(cb) {
      teamCbs.add(cb)
      return () => void teamCbs.delete(cb)
    },
    onSessions(cb) {
      sessionCbs.add(cb)
      return () => void sessionCbs.delete(cb)
    },
    onUsage(cb) {
      usageCbs.add(cb)
      return () => void usageCbs.delete(cb)
    },
    dispose() {
      disposed = true
      for (const rw of rootWatches.values()) for (const w of rw.watchers) w.w.close()
      rootWatches.clear()
      for (const t of [pushTimer, sessionsTimer, usageTimer, pollTimer, midnightTimer, activityTimer]) clear(t)
      pushTimer = sessionsTimer = usageTimer = pollTimer = midnightTimer = activityTimer = null
      sessions.clear()
      viewers.clear()
      pendingTail.clear()
      pushQueue.clear()
      teamCbs.clear()
      sessionCbs.clear()
      usageCbs.clear()
      activityCbs.clear()
      fileChangeCbs.clear()
    }
  }
}
