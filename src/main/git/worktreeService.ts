// Worktree service (R-09): polls git for the selected project, builds a WorkspaceSnapshot and serves "Compare diffs".
// Git is always spawned through the injected exec (execFile style, never a shell) with `-C <path>`.
import type { FileDiff, WorkspaceSnapshot, WorktreeInfo } from '../../shared/types'
import { detectOverlaps } from '../../shared/overlap'
import type { ExecFn } from '../transcripts/projectResolver'
import {
  mergeChanged,
  parseLeftRight,
  parseNumstatZ,
  parseStatusZ,
  parseSymbolicRef,
  parseWorktreeList,
  pickBase,
  type NumstatEntry,
  type RawWorktree
} from './gitParse'

export interface WorktreeServiceDeps {
  exec: ExecFn
  platform: NodeJS.Platform
  watchFiles?: (paths: string[], onChange: () => void) => { close(): void }
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
  now: () => Date
}

export interface WorktreeService {
  watch(root: string | null): Promise<WorkspaceSnapshot>
  poke(): void
  current(): WorkspaceSnapshot
  compare(root: string, path: string): Promise<FileDiff[]>
  onChanged(cb: (s: WorkspaceSnapshot) => void): () => void
  dispose(): void
}

const GIT_TIMEOUT_MS = 4000
const POLL_MS = 5000
const DEBOUNCE_MS = 500
const BASE_TTL_MS = 60_000
const PARALLEL = 3
const DIFF_CAP = 200_000
const NOLOCK = '--no-optional-locks'

interface Session {
  root: string
  timer: unknown
  debounce: unknown
  running: boolean
  pending: boolean
  watchKey: string
  watcher: { close(): void } | null
  lastJson: string
  base: { value: string | null; at: number } | null
  first: Promise<WorkspaceSnapshot> | null
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'git failed'

export function createWorktreeService(deps: WorktreeServiceDeps): WorktreeService {
  const { exec, platform } = deps
  const listeners = new Set<(s: WorkspaceSnapshot) => void>()
  const empty = (): WorkspaceSnapshot => ({ root: null, base: null, worktrees: [], overlaps: [], updatedAt: deps.now().toISOString() })
  let snapshot: WorkspaceSnapshot = empty()
  let session: Session | null = null

  const git = (cwd: string, ...args: string[]): Promise<{ stdout: string }> =>
    exec('git', ['-C', cwd, NOLOCK, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true })

  const norm = (p: string): string => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? s.toLowerCase() : s
  }

  const emit = (s: WorkspaceSnapshot): void => {
    for (const cb of [...listeners]) cb(s)
  }

  function stopSession(s: Session | null): void {
    if (!s) return
    if (s.timer !== undefined) deps.clearTimer(s.timer)
    if (s.debounce !== undefined) deps.clearTimer(s.debounce)
    s.timer = undefined
    s.debounce = undefined
    s.watcher?.close()
    s.watcher = null
  }

  async function resolveBase(s: Session): Promise<string | null> {
    const t = deps.now().getTime()
    if (s.base && t - s.base.at < BASE_TTL_MS) return s.base.value
    let originHead: string | null = null
    try {
      originHead = parseSymbolicRef((await git(s.root, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD')).stdout)
    } catch {
      originHead = null
    }
    const candidates = [...new Set([originHead, 'main', 'master', 'origin/main', 'origin/master'].filter((x): x is string => !!x))]
    const ok = new Set<string>()
    await Promise.all(
      candidates.map(async (ref) => {
        try {
          await git(s.root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
          ok.add(ref)
        } catch {
          /* missing ref */
        }
      })
    )
    const value = pickBase({ originHead, existing: (r) => ok.has(r) })
    s.base = { value, at: t }
    return value
  }

  async function inspect(w: RawWorktree, isMain: boolean, base: string | null): Promise<WorktreeInfo> {
    const info: WorktreeInfo = {
      path: w.path,
      head: w.head,
      detached: w.detached,
      isMain,
      ahead: null,
      behind: null,
      files: [],
      changedFiles: 0,
      ...(w.branch !== undefined ? { branch: w.branch } : {}),
      ...(w.locked ? { locked: true } : {}),
      ...(w.prunable ? { prunable: true } : {})
    }
    if (w.prunable) return { ...info, error: 'prunable' }
    try {
      const range = `${base}...HEAD`
      const [status, lr, ns] = await Promise.all([
        git(w.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
        base ? git(w.path, 'rev-list', '--left-right', '--count', range) : null,
        base ? git(w.path, 'diff', '--numstat', '-z', range) : null
      ])
      let committed: NumstatEntry[] = []
      if (lr && ns) {
        const counts = parseLeftRight(lr.stdout)
        if (counts) {
          info.ahead = counts.ahead
          info.behind = counts.behind
        }
        committed = parseNumstatZ(ns.stdout)
      }
      const merged = mergeChanged(committed, parseStatusZ(status.stdout))
      info.files = merged.files
      info.changedFiles = merged.total
      return info
    } catch (e) {
      return { ...info, ahead: null, behind: null, files: [], changedFiles: 0, error: msg(e) }
    }
  }

  async function mapLimit<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!, i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
    return out
  }

  function syncWatchers(s: Session, raws: RawWorktree[]): void {
    if (!deps.watchFiles) return
    const first = raws[0]
    const common = first ? (first.bare ? first.path : `${first.path}/.git`) : `${s.root}/.git`
    const paths = [`${common}/HEAD`, `${common}/index`, `${common}/worktrees/*/HEAD`, `${common}/worktrees/*/index`]
    const key = raws.map((r) => r.path).join('|')
    if (s.watcher && s.watchKey === key) return
    s.watcher?.close()
    s.watchKey = key
    s.watcher = deps.watchFiles(paths, () => trigger(s))
  }

  async function cycle(s: Session): Promise<WorkspaceSnapshot> {
    try {
      const raws = parseWorktreeList((await git(s.root, 'worktree', 'list', '--porcelain')).stdout)
      const live = raws.filter((r) => !r.bare)
      const base = live.some((r) => !r.prunable) ? await resolveBase(s) : null
      const worktrees = await mapLimit(live, PARALLEL, (w) => inspect(w, w === raws[0], base))
      if (session === s) syncWatchers(s, raws)
      return { root: s.root, base, worktrees, overlaps: detectOverlaps(worktrees), updatedAt: deps.now().toISOString() }
    } catch (e) {
      return { root: s.root, base: null, worktrees: [], overlaps: [], updatedAt: deps.now().toISOString(), error: msg(e) }
    }
  }

  async function run(s: Session): Promise<WorkspaceSnapshot> {
    s.running = true
    if (s.timer !== undefined) deps.clearTimer(s.timer)
    s.timer = undefined
    let snap = snapshot
    try {
      do {
        s.pending = false
        const next = await cycle(s)
        if (session !== s) return snapshot
        snap = next
        snapshot = next
        const json = JSON.stringify({ ...next, updatedAt: '' })
        if (json !== s.lastJson) {
          s.lastJson = json
          emit(next)
        }
      } while (s.pending && session === s)
    } finally {
      s.running = false
      if (session === s) s.timer = deps.setTimer(() => trigger(s), POLL_MS)
    }
    return snap
  }

  function trigger(s: Session): void {
    if (session !== s) return
    if (s.running) {
      s.pending = true
      return
    }
    void run(s)
  }

  const validPath = (p: string): boolean => {
    if (p === '' || p.includes('\0') || p.startsWith('-') || p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) return false
    return !p.split(/[\\/]/).includes('..')
  }

  const capText = (t: string): { text: string; cut: boolean } =>
    t.length > DIFF_CAP ? { text: t.slice(0, DIFF_CAP), cut: true } : { text: t, cut: false }

  return {
    async watch(root) {
      if (root !== null && session && session.first && norm(session.root) === norm(root)) return session.first
      stopSession(session)
      session = null
      if (root === null) {
        const had = snapshot.root !== null
        snapshot = empty()
        if (had) emit(snapshot)
        return snapshot
      }
      const s: Session = {
        root,
        timer: undefined,
        debounce: undefined,
        running: false,
        pending: false,
        watchKey: '',
        watcher: null,
        lastJson: '',
        base: null,
        first: null
      }
      session = s
      s.first = run(s)
      return s.first
    },
    poke() {
      const s = session
      if (!s) return
      if (s.debounce !== undefined) deps.clearTimer(s.debounce)
      s.debounce = deps.setTimer(() => {
        s.debounce = undefined
        trigger(s)
      }, DEBOUNCE_MS)
    },
    current: () => snapshot,
    async compare(root, path) {
      const s = session
      if (!s || norm(root) !== norm(s.root) || !validPath(path)) return []
      const rel = path.replace(/\\/g, '/')
      const base = snapshot.base
      const targets = snapshot.worktrees.filter((w) => !w.error && w.files.some((f) => f.path === rel))
      return Promise.all(
        targets.map(async (w): Promise<FileDiff> => {
          const diffOf = (spec: string): Promise<string> =>
            git(w.path, 'diff', spec, '--', rel).then((r) => r.stdout, () => '')
          const [committed, uncommitted] = await Promise.all([base ? diffOf(`${base}...HEAD`) : Promise.resolve(''), diffOf('HEAD')])
          const a = capText(committed)
          const b = capText(uncommitted)
          const joined = capText([a.text, b.text].filter((x) => x !== '').join('\n'))
          return {
            worktreePath: w.path,
            ...(w.branch !== undefined ? { branch: w.branch } : {}),
            diff: joined.text,
            truncated: a.cut || b.cut || joined.cut
          }
        })
      )
    },
    onChanged(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    dispose() {
      stopSession(session)
      session = null
      listeners.clear()
    }
  }
}
