import type { RegistryStatus, SessionProject, SessionSummary } from '../../shared/types'
import { samePath } from '../accounts/paths'
import { encodeProjectDir, parseRegistryEntry, sameProjectDir, type RegistryEntry } from './layout'
import { parseLine } from './parseLine'
import { provisionalProject, type ProjectResolver } from './projectResolver'
import type { ByteReadFs } from './transcriptFs'

export interface ConfigRoot {
  accountId: string
  configDirAbs: string
}
export interface PtyHint {
  pid: number
  cwd: string
  startedAtMs: number
  accountId: string
  /** A controlled session: its transcript is known by id (null until the file exists). */
  sessionId?: string
}
export interface LiveRegistry {
  entry: RegistryEntry
  accountId: string
  configDirAbs: string
}
export interface SessionIndexDeps {
  fs: ByteReadFs
  platform: NodeJS.Platform
  home: string
  isPidAlive(pid: number): boolean
  nowMs(): number
  /** Git project resolution; without it sessions are grouped by cwd only. */
  projects?: ProjectResolver
}
export interface AutoPick {
  accountId: string
  sessionId: string
  configDirAbs: string
  projectDir: string
}
export interface SessionIndex {
  listSessions(roots: ConfigRoot[], limit?: number): Promise<SessionSummary[]>
  readRegistry(roots: ConfigRoot[]): Promise<LiveRegistry[]>
  pickAuto(
    roots: ConfigRoot[],
    pty: PtyHint | null,
    projectKey?: string
  ): Promise<{ pick: AutoPick | null; waitingForSession: boolean }>
  resolve(roots: ConfigRoot[], accountId: string, sessionId: string): Promise<{ configDirAbs: string; projectDir: string } | null>
}

const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 256 * 1024
const DAY_MS = 24 * 3_600_000
const PTY_SLACK_MS = 5000

interface FileInfo {
  accountId: string
  configDirAbs: string
  projectDir: string
  sessionId: string
  path: string
  mtimeMs: number
  sizeBytes: number
}
interface Meta {
  mtimeMs: number
  size: number
  cwd?: string
  title?: string
  entrypoint?: string
}

const join = (dir: string, name: string): string => dir.replace(/[\\/]+$/, '') + '/' + name
const decoder = new TextDecoder('utf-8', { fatal: false })

export function createSessionIndex(deps: SessionIndexDeps): SessionIndex {
  const { fs, platform } = deps
  const metaCache = new Map<string, Meta>()

  async function safeReaddir(p: string) {
    try {
      return await fs.readdir(p)
    } catch {
      return []
    }
  }

  /** Main transcripts of one root, stat'ed. */
  async function scanRoot(root: ConfigRoot): Promise<FileInfo[]> {
    const projects = join(root.configDirAbs, 'projects')
    const out: FileInfo[] = []
    for (const d of await safeReaddir(projects)) {
      if (!d.isDirectory()) continue
      const dirPath = join(projects, d.name)
      for (const f of await safeReaddir(dirPath)) {
        if (!f.isFile() || !f.name.toLowerCase().endsWith('.jsonl')) continue
        const path = join(dirPath, f.name)
        let st
        try {
          st = await fs.stat(path)
        } catch {
          continue
        }
        if (!st || !st.isFile) continue
        out.push({
          accountId: root.accountId,
          configDirAbs: root.configDirAbs,
          projectDir: d.name,
          sessionId: f.name.slice(0, -'.jsonl'.length),
          path,
          mtimeMs: st.mtimeMs,
          sizeBytes: st.size
        })
      }
    }
    return out
  }

  async function scanAll(roots: ConfigRoot[]): Promise<FileInfo[]> {
    const all: FileInfo[] = []
    for (const r of roots) all.push(...(await scanRoot(r)))
    return all.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  async function readMeta(f: FileInfo): Promise<Meta> {
    const cached = metaCache.get(f.path)
    if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.sizeBytes) return cached
    const meta: Meta = { mtimeMs: f.mtimeMs, size: f.sizeBytes }
    const titles: Record<'custom' | 'ai' | 'agent-name', string | undefined> = {
      custom: undefined,
      ai: undefined,
      'agent-name': undefined
    }
    const scan = (text: string, dropFirst: boolean, dropLast: boolean): void => {
      const lines = text.split('\n')
      if (dropFirst) lines.shift()
      if (dropLast) lines.pop()
      for (const line of lines) {
        if (line.trim() === '') continue
        if (meta.cwd === undefined && line.includes('"cwd"')) {
          try {
            const o = JSON.parse(line) as { cwd?: unknown }
            if (typeof o.cwd === 'string' && o.cwd !== '') meta.cwd = o.cwd
          } catch {
            /* partial or malformed line */
          }
        }
        if (meta.entrypoint === undefined && line.includes('"entrypoint"')) {
          try {
            const o = JSON.parse(line) as { entrypoint?: unknown }
            if (typeof o.entrypoint === 'string' && o.entrypoint !== '') meta.entrypoint = o.entrypoint
          } catch {
            /* partial or malformed line */
          }
        }
        if (line.includes('-title"') || line.includes('"agent-name"')) {
          const rec = parseLine(line)
          if (rec && rec.t === 'title') titles[rec.kind] = rec.value
        }
      }
    }
    try {
      const headEnd = Math.min(f.sizeBytes, HEAD_BYTES)
      scan(decoder.decode(await fs.readRange(f.path, 0, headEnd)), false, f.sizeBytes > HEAD_BYTES)
      if (f.sizeBytes > HEAD_BYTES) {
        const start = Math.max(0, f.sizeBytes - TAIL_BYTES)
        scan(decoder.decode(await fs.readRange(f.path, start, f.sizeBytes)), start > 0, false)
      }
    } catch {
      /* unreadable: keep what we have */
    }
    const title = titles.custom ?? titles.ai ?? titles['agent-name']
    if (title !== undefined) meta.title = title
    metaCache.set(f.path, meta)
    return meta
  }

  async function readRegistry(roots: ConfigRoot[]): Promise<LiveRegistry[]> {
    const out: LiveRegistry[] = []
    for (const r of roots) {
      const dir = join(r.configDirAbs, 'sessions')
      for (const e of await safeReaddir(dir)) {
        if (!e.isFile() || !/^\d+\.json$/.test(e.name)) continue
        let entry: RegistryEntry | null
        try {
          entry = parseRegistryEntry(await fs.readText(join(dir, e.name)))
        } catch {
          continue
        }
        if (entry && deps.isPidAlive(entry.pid)) out.push({ entry, accountId: r.accountId, configDirAbs: r.configDirAbs })
      }
    }
    return out
  }

  async function findSession(roots: ConfigRoot[], accountId: string, sessionId: string): Promise<FileInfo | null> {
    for (const r of roots) {
      if (r.accountId !== accountId) continue
      for (const f of await scanRoot(r)) if (f.sessionId === sessionId) return f
    }
    return null
  }

  /** Resolved project when known, else the cwd-only one; kicks git off in the background for unknown cwds. */
  function projectNow(cwd: string | undefined, projectDir: string): SessionProject {
    const r = deps.projects
    if (cwd !== undefined && r) {
      const hit = r.cached(cwd)
      if (hit) return hit
      void r.resolve(cwd)
    }
    return provisionalProject(cwd, projectDir, platform)
  }
  async function projectOf(f: FileInfo): Promise<SessionProject> {
    const cwd = (await readMeta(f)).cwd
    if (cwd !== undefined && deps.projects) return deps.projects.resolve(cwd)
    return provisionalProject(cwd, f.projectDir, platform)
  }
  async function ptyInProject(pty: PtyHint, projectKey: string): Promise<boolean> {
    const p = deps.projects ? await deps.projects.resolve(pty.cwd) : provisionalProject(pty.cwd, "", platform)
    return p.key === projectKey
  }

  async function listSessions(roots: ConfigRoot[], limit = 50): Promise<SessionSummary[]> {
    const kept = (await scanAll(roots)).slice(0, limit)
    const live = new Map<string, RegistryEntry>()
    for (const l of await readRegistry(roots)) live.set(`${l.accountId}|${l.entry.sessionId}`, l.entry)
    const out: SessionSummary[] = []
    for (const f of kept) {
      const meta = await readMeta(f)
      const s: SessionSummary = {
        sessionId: f.sessionId,
        accountId: f.accountId,
        configDir: f.configDirAbs,
        projectDir: f.projectDir,
        mtimeMs: f.mtimeMs,
        sizeBytes: f.sizeBytes
      }
      if (meta.cwd !== undefined) s.cwd = meta.cwd
      s.project = projectNow(meta.cwd, f.projectDir)
      if (meta.title !== undefined) s.title = meta.title
      const reg = live.get(`${f.accountId}|${f.sessionId}`)
      if (meta.entrypoint !== undefined) s.entrypoint = meta.entrypoint
      if (reg) {
        s.live = true
        s.registryPid = reg.pid
        const regEntry = (reg as { entrypoint?: unknown }).entrypoint
        if (typeof regEntry === 'string' && regEntry !== '') s.entrypoint = regEntry
        if (reg.status) s.registryStatus = reg.status as RegistryStatus
      }
      out.push(s)
    }
    return out
  }

  const toPick = (f: FileInfo): AutoPick => ({
    accountId: f.accountId,
    sessionId: f.sessionId,
    configDirAbs: f.configDirAbs,
    projectDir: f.projectDir
  })

  async function pickFromPty(roots: ConfigRoot[], pty: PtyHint): Promise<AutoPick | null> {
    const own = roots.filter((r) => r.accountId === pty.accountId)
    if (pty.sessionId !== undefined) {
      const f = await findSession(own, pty.accountId, pty.sessionId)
      return f ? toPick(f) : null // controlled session: its id is known, wait for the file
    }
    const reg = (await readRegistry(own)).find((l) => l.entry.pid === pty.pid)
    if (reg) {
      const f = await findSession(own, reg.accountId, reg.entry.sessionId)
      return f ? toPick(f) : null // registry knows the pty's session: wait for its transcript
    }
    const wantDir = encodeProjectDir(pty.cwd)
    for (const f of await scanAll(own)) {
      if (f.mtimeMs < pty.startedAtMs - PTY_SLACK_MS) continue
      if (sameProjectDir(f.projectDir, wantDir, platform)) return toPick(f)
      const cwd = (await readMeta(f)).cwd
      if (cwd !== undefined && samePath(cwd, pty.cwd, deps.home, platform)) return toPick(f)
    }
    return null
  }

  async function pickAuto(roots: ConfigRoot[], pty: PtyHint | null, projectKey?: string): Promise<{ pick: AutoPick | null; waitingForSession: boolean }> {
    if (pty && (projectKey === undefined || (await ptyInProject(pty, projectKey)))) {
      const pick = await pickFromPty(roots, pty)
      return { pick, waitingForSession: pick === null }
    }
    const stamp = (e: RegistryEntry): number => Math.max(e.statusUpdatedAt ?? 0, e.updatedAt ?? 0, e.startedAt ?? 0)
    // Registry stamps change only on status changes; transcript mtime is the real activity signal.
    const files = await scanAll(roots)
    const ranked: { f: FileInfo; stamp: number }[] = []
    for (const l of await readRegistry(roots)) {
      const f = files.find((x) => x.accountId === l.accountId && x.sessionId === l.entry.sessionId)
      if (f) ranked.push({ f, stamp: stamp(l.entry) })
    }
    ranked.sort((a, b) => b.f.mtimeMs - a.f.mtimeMs || b.stamp - a.stamp)
    if (projectKey === undefined) {
      if (ranked[0]) return { pick: toPick(ranked[0].f), waitingForSession: false }
      const newest = files[0]
      if (newest && newest.mtimeMs >= deps.nowMs() - DAY_MS) return { pick: toPick(newest), waitingForSession: false }
      return { pick: null, waitingForSession: false }
    }
    const inProject = async (f: FileInfo): Promise<boolean> => (await projectOf(f)).key === projectKey
    for (const r of ranked) if (await inProject(r.f)) return { pick: toPick(r.f), waitingForSession: false }
    // no live session here: the newest of the project, however old (files are newest first)
    for (const f of files) if (await inProject(f)) return { pick: toPick(f), waitingForSession: false }
    return { pick: null, waitingForSession: false }
  }

  async function resolve(roots: ConfigRoot[], accountId: string, sessionId: string) {
    const f = await findSession(roots, accountId, sessionId)
    return f ? { configDirAbs: f.configDirAbs, projectDir: f.projectDir } : null
  }

  return { listSessions, readRegistry, pickAuto, resolve }
}
