import { watch } from 'chokidar'
import { basename, dirname, resolve } from 'node:path'
import type { HostEnv, ReadFs } from '../contracts'
import type { PtyManagerApi } from '../pty/types'
import type { OkResult, SignInStatus } from '@shared/types'
import { readDisplayFields } from './claudeJson'
import { claudeJsonPathFor, expandHome, isAbsoluteFor, isDefaultConfigDir, normalizeForCompare } from './paths'
import { isDeniedPath, safeNodeFs } from './safeFs'

export interface FileWatcher {
  close(): void
}
export type WatchFile = (absFile: string, onChange: () => void) => FileWatcher

const samePathFs = (a: string, b: string): boolean =>
  normalizeForCompare(resolve(a), process.platform) === normalizeForCompare(resolve(b), process.platform)

/** Watches one file (never the credentials file). Works even when the parent dir does not exist yet. */
export function createChokidarWatchFile(fs: ReadFs = safeNodeFs): WatchFile {
  return (absFile, onChange) => {
    let closed = false
    let watcher: ReturnType<typeof watch> | null = null
    const dir = dirname(absFile)
    void (async () => {
      let dirExists = false
      try {
        dirExists = await fs.exists(dir)
      } catch {
        dirExists = false
      }
      if (closed) return
      const root = dirExists ? dir : dirname(dir)
      const w = watch(root, {
        depth: dirExists ? 0 : 2,
        ignoreInitial: true,
        atomic: true,
        ignored: (p: string) => {
          if (isDeniedPath(p)) return true
          if (samePathFs(p, root) || samePathFs(p, absFile)) return false
          return !(!dirExists && samePathFs(p, dir))
        }
      })
      const handle = (p: string): void => {
        if (!closed && samePathFs(p, absFile) && basename(p).length > 0) onChange()
      }
      w.on('add', handle)
      w.on('change', handle)
      w.on('error', () => undefined)
      watcher = w
      if (closed) void w.close()
    })()
    return {
      close() {
        closed = true
        if (watcher) void watcher.close()
        watcher = null
      }
    }
  }
}

export interface SignInController {
  start(configDir: string): Promise<OkResult>
  check(configDir: string): Promise<SignInStatus>
  reopen(configDir: string): Promise<OkResult>
  cancel(configDir: string): Promise<OkResult>
  status(configDir: string): SignInStatus
  onStatus(cb: (s: SignInStatus) => void): () => void
  disposeAll(): void
}

interface Entry {
  display: string
  abs: string
  jsonPath: string
  ptyId: string | null
  watcher: FileWatcher | null
  baselineMtime: number | null
  baselineHadEmail: boolean
  exitCode: number | null
  status: SignInStatus
  busy: boolean
}

export function createSignInController(deps: { pty: PtyManagerApi; fs: ReadFs; host: HostEnv; watchFile: WatchFile }): SignInController {
  const { pty, fs, host } = deps
  const entries = new Map<string, Entry>()
  const cbs = new Set<(s: SignInStatus) => void>()

  const resolveDir = (dir: string): { abs: string; key: string } | null => {
    const abs = expandHome(dir, host.home)
    if (!isAbsoluteFor(abs, host.platform)) return null
    return { abs, key: normalizeForCompare(abs, host.platform) }
  }
  const emit = (s: SignInStatus): void => {
    for (const cb of [...cbs]) {
      try {
        cb({ ...s })
      } catch {
        // listener errors must not break the controller
      }
    }
  }
  const setStatus = (e: Entry, s: Omit<SignInStatus, 'configDir'>): void => {
    e.status = { configDir: e.display, ...s }
    emit(e.status)
  }
  const closeWatcher = (e: Entry): void => {
    e.watcher?.close()
    e.watcher = null
  }
  const mtimeOf = async (path: string): Promise<number | null> => {
    try {
      return await fs.mtimeMs(path)
    } catch {
      return null
    }
  }

  async function evaluate(e: Entry): Promise<void> {
    if (e.status.step !== 'waiting' || e.busy) return
    e.busy = true
    try {
      const fields = await readDisplayFields(fs, e.abs, host.home, host.platform)
      const mtime = await mtimeOf(e.jsonPath)
      if (e.status.step !== 'waiting') return
      const changed = mtime !== null && (e.baselineMtime === null || mtime > e.baselineMtime)
      const done = fields.email !== undefined && (changed || e.exitCode === 0 || !e.baselineHadEmail)
      const ptyPart = e.ptyId ? { ptyId: e.ptyId } : {}
      if (done) {
        closeWatcher(e)
        setStatus(e, {
          step: 'done',
          email: fields.email,
          ...(fields.org !== undefined ? { org: fields.org } : {}),
          ...ptyPart
        })
      } else if (e.exitCode !== null && e.exitCode !== 0) {
        closeWatcher(e)
        setStatus(e, { step: 'error', reason: 'login-exited', ...ptyPart })
      }
    } finally {
      e.busy = false
    }
  }

  pty.onExit((id, code) => {
    for (const e of entries.values()) {
      if (e.ptyId === id && e.status.step === 'waiting') {
        e.exitCode = code
        void evaluate(e)
      }
    }
  })

  const none = (dir: string): SignInStatus => ({ configDir: dir, step: 'none' })

  async function start(dir: string): Promise<OkResult> {
    const r = resolveDir(dir)
    if (!r) return { ok: false, reason: 'invalid-folder' }
    const existing = entries.get(r.key)
    if (existing && existing.status.step === 'waiting') return { ok: true }
    if (existing) closeWatcher(existing)

    const jsonPath = claudeJsonPathFor(dir, host.home, host.platform)
    const before = await readDisplayFields(fs, r.abs, host.home, host.platform)
    const e: Entry = {
      display: dir,
      abs: r.abs,
      jsonPath,
      ptyId: null,
      watcher: null,
      baselineMtime: await mtimeOf(jsonPath),
      baselineHadEmail: before.email !== undefined,
      exitCode: null,
      status: none(dir),
      busy: false
    }
    entries.set(r.key, e)
    const out = await pty.spawnClaude({
      purpose: 'login',
      cwd: host.home,
      configDirAbs: isDefaultConfigDir(r.abs, host.home, host.platform) ? null : r.abs,
      configDirDisplay: dir,
      args: ['auth', 'login']
    })
    if (!out.ok) {
      setStatus(e, { step: 'error', reason: out.reason })
      return { ok: false, reason: out.reason }
    }
    e.ptyId = out.id
    e.watcher = deps.watchFile(jsonPath, () => void evaluate(e))
    setStatus(e, { step: 'waiting', ptyId: out.id })
    return { ok: true }
  }

  function kill(e: Entry): void {
    closeWatcher(e)
    if (e.ptyId) pty.kill(e.ptyId)
  }

  return {
    start,
    async check(dir) {
      const r = resolveDir(dir)
      const e = r ? entries.get(r.key) : undefined
      if (!e) return none(dir)
      await evaluate(e)
      return { ...e.status }
    },
    async reopen(dir) {
      const r = resolveDir(dir)
      if (!r) return { ok: false, reason: 'invalid-folder' }
      const e = entries.get(r.key)
      if (e) {
        kill(e)
        entries.delete(r.key)
      }
      return start(dir)
    },
    async cancel(dir) {
      const r = resolveDir(dir)
      if (!r) return { ok: false, reason: 'invalid-folder' }
      const e = entries.get(r.key)
      if (e) {
        kill(e)
        setStatus(e, { step: 'none' })
      }
      return { ok: true }
    },
    status(dir) {
      const r = resolveDir(dir)
      const e = r ? entries.get(r.key) : undefined
      return e ? { ...e.status } : none(dir)
    },
    onStatus(cb) {
      cbs.add(cb)
      return () => void cbs.delete(cb)
    },
    disposeAll() {
      for (const e of entries.values()) if (e.status.step === 'waiting') kill(e)
      entries.clear()
    }
  }
}
