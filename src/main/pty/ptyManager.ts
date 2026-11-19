import { randomUUID } from 'node:crypto'
import type { PtyInfo } from '@shared/types'
import type { ClaudeCommand } from './claudeBinary'
import { buildChildEnv } from './childEnv'
import type { PtyClaudeRequest, PtyManagerApi, PtySpawnOutcome } from './types'

export interface IPtyLike {
  pid: number
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
  onData(cb: (d: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void }
}
export interface NodePtyLike {
  spawn(
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string>; useConpty?: boolean }
  ): IPtyLike
}

const DEFAULT_BUFFER = 256 * 1024
const MAX_EXITED = 20

interface Entry {
  info: PtyInfo
  pty: IPtyLike
  buf: string
  alive: boolean
}

export async function loadNodePty(): Promise<NodePtyLike | null> {
  try {
    const mod = (await import('node-pty')) as unknown as { default?: NodePtyLike } & NodePtyLike
    const m = typeof mod.spawn === 'function' ? mod : mod.default
    return m && typeof m.spawn === 'function' ? (m as NodePtyLike) : null
  } catch {
    return null
  }
}

export function createPtyManager(deps: {
  loadPty: () => Promise<NodePtyLike | null>
  resolveClaude: () => ClaudeCommand | null
  baseEnv: Readonly<Record<string, string | undefined>>
  platform: NodeJS.Platform
  now?: () => Date
  newId?: () => string
  bufferLimit?: number
}): PtyManagerApi {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => randomUUID())
  const limit = deps.bufferLimit ?? DEFAULT_BUFFER
  const entries = new Map<string, Entry>()
  const dataCbs = new Set<(id: string, data: string) => void>()
  const exitCbs = new Set<(id: string, code: number) => void>()
  let loaded: Promise<NodePtyLike | null> | null = null

  const load = (): Promise<NodePtyLike | null> => {
    loaded ??= deps.loadPty().catch(() => null)
    return loaded
  }
  const emit = <A extends unknown[]>(set: Set<(...a: A) => void>, ...args: A): void => {
    for (const cb of [...set]) {
      try {
        cb(...args)
      } catch {
        // a failing listener must not affect the others
      }
    }
  }
  const prune = (): void => {
    const exited = [...entries.values()].filter((e) => !e.alive)
    for (const e of exited.slice(0, Math.max(0, exited.length - MAX_EXITED))) entries.delete(e.info.id)
  }
  const live = (id: string): Entry | undefined => {
    const e = entries.get(id)
    return e && e.alive ? e : undefined
  }

  return {
    async available() {
      return (await load()) !== null
    },
    async spawnClaude(req: PtyClaudeRequest): Promise<PtySpawnOutcome> {
      const node = await load()
      if (!node) return { ok: false, reason: 'pty-unavailable' }
      const cmd = deps.resolveClaude()
      if (!cmd) return { ok: false, reason: 'claude-not-found' }
      let pty: IPtyLike
      try {
        pty = node.spawn(cmd.file, [...cmd.argsPrefix, ...(req.args ?? [])], {
          name: 'xterm-256color',
          cols: req.cols ?? 120,
          rows: req.rows ?? 30,
          cwd: req.cwd,
          env: buildChildEnv(deps.baseEnv, { configDirAbs: req.configDirAbs, platform: deps.platform })
        })
      } catch {
        return { ok: false, reason: 'spawn-failed' }
      }
      const id = newId()
      const entry: Entry = {
        pty,
        buf: '',
        alive: true,
        info: {
          id,
          purpose: req.purpose,
          cwd: req.cwd,
          ...(req.accountId !== undefined ? { accountId: req.accountId } : {}),
          configDir: req.configDirDisplay,
          pid: pty.pid,
          startedAt: now().toISOString()
        }
      }
      entries.set(id, entry)
      pty.onData((d) => {
        entry.buf += d
        if (entry.buf.length > limit) entry.buf = entry.buf.slice(entry.buf.length - limit)
        emit(dataCbs, id, d)
      })
      pty.onExit((e) => {
        if (!entry.alive) return
        entry.alive = false
        entry.info.exitCode = e.exitCode
        prune()
        emit(exitCbs, id, e.exitCode)
      })
      return { ok: true, id }
    },
    write(id, data) {
      const e = live(id)
      if (!e) return false
      try {
        e.pty.write(data)
        return true
      } catch {
        return false
      }
    },
    resize(id, cols, rows) {
      const e = live(id)
      if (!e) return false
      try {
        e.pty.resize(cols, rows)
        return true
      } catch {
        return false
      }
    },
    kill(id) {
      const e = live(id)
      if (!e) return false
      try {
        e.pty.kill()
        return true
      } catch {
        return false
      }
    },
    buffer: (id) => entries.get(id)?.buf ?? '',
    list: () => [...entries.values()].map((e) => ({ ...e.info })),
    onData(cb) {
      dataCbs.add(cb)
      return () => void dataCbs.delete(cb)
    },
    onExit(cb) {
      exitCbs.add(cb)
      return () => void exitCbs.delete(cb)
    },
    disposeAll() {
      for (const e of entries.values()) {
        if (!e.alive) continue
        try {
          e.pty.kill()
        } catch {
          // already gone
        }
      }
    }
  }
}
