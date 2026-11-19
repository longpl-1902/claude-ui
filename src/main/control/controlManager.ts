// Registry of controlled sessions + 50 ms batching of stream events. Spawning is delegated to controlSession.
import { randomUUID } from 'node:crypto'
import type { ClaudeCommand } from '../pty/claudeBinary'
import type { ControlPermissionMode, ControlResume, ControlSessionInfo, ControlStreamEvent, ControlStreamState, OkResult, PermissionAnswer } from '../../shared/types'
import { createControlSession, type ChildLike, type ControlSession, type SpawnFn } from './controlSession'

export type { ChildLike, SpawnFn }

export interface ControlManagerDeps {
  spawn: SpawnFn
  resolveClaude: () => ClaudeCommand | null
  baseEnv: Readonly<Record<string, string | undefined>>
  platform: NodeJS.Platform
  killTree: (pid: number) => Promise<void>
  now?: () => Date
  newId?: () => string
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export interface ControlManager {
  create(o: { cwd: string; accountId: string; configDirAbs: string | null; model?: string; permissionMode: ControlPermissionMode; resume?: ControlResume }): ControlSessionInfo
  send(id: string, text: string): Promise<OkResult>
  interrupt(id: string): OkResult
  interruptAll(): number
  answer(id: string, requestId: string, a: PermissionAnswer): OkResult
  setModel(id: string, model: string | null): OkResult
  setMode(id: string, mode: ControlPermissionMode): OkResult
  stop(id: string): Promise<OkResult>
  remove(id: string): OkResult
  list(): ControlSessionInfo[]
  get(id: string): ControlSessionInfo | undefined
  streamState(id: string): ControlStreamState | null
  onChanged(cb: (l: ControlSessionInfo[]) => void): () => void
  onStream(cb: (e: ControlStreamEvent[]) => void): () => void
  disposeAll(): void
}

const BATCH_MS = 50
const UNKNOWN: OkResult = { ok: false, reason: 'unknown-session' }

export function createControlManager(deps: ControlManagerDeps): ControlManager {
  const now = deps.now ?? ((): Date => new Date())
  const newId = deps.newId ?? ((): string => randomUUID())
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((t: unknown): void => clearTimeout(t as ReturnType<typeof setTimeout>))
  const sessions = new Map<string, ControlSession>()
  const changedCbs = new Set<(l: ControlSessionInfo[]) => void>()
  const streamCbs = new Set<(e: ControlStreamEvent[]) => void>()
  let queue: ControlStreamEvent[] = []
  let batchTimer: unknown = null
  let reqSeq = 0

  const list = (): ControlSessionInfo[] => [...sessions.values()].map((s) => s.info())
  const changed = (): void => {
    const l = list()
    for (const cb of [...changedCbs]) cb(l)
  }
  const flush = (): void => {
    batchTimer = null
    if (queue.length === 0) return
    const batch = queue
    queue = []
    for (const cb of [...streamCbs]) cb(batch)
  }
  const emit = (e: ControlStreamEvent): void => {
    const last = queue[queue.length - 1]
    if (e.kind === 'typing' && last && last.kind === 'typing' && last.controlId === e.controlId) queue[queue.length - 1] = e
    else queue.push(e)
    if (batchTimer === null) batchTimer = setTimer(flush, BATCH_MS)
  }

  const withSession = <T>(id: string, fn: (s: ControlSession) => T, miss: T): T => {
    const s = sessions.get(id)
    return s ? fn(s) : miss
  }

  return {
    create(o) {
      const id = newId()
      const s = createControlSession(
        { ...deps, now, setTimer, clearTimer, nextRequestId: () => `ctl_${++reqSeq}`, emit, changed },
        { id, ...o }
      )
      sessions.set(id, s)
      changed()
      return s.info()
    },
    send: (id, text) => withSession(id, (s) => s.send(text), Promise.resolve(UNKNOWN)),
    interrupt: (id) => withSession(id, (s) => s.interrupt(), UNKNOWN),
    interruptAll() {
      let n = 0
      for (const s of sessions.values()) if (s.info().state === 'busy' && s.interrupt().ok) n++
      return n
    },
    answer: (id, requestId, a) => withSession(id, (s) => s.answer(requestId, a), UNKNOWN),
    setModel: (id, model) => withSession(id, (s) => s.setModel(model), UNKNOWN),
    setMode: (id, mode) => withSession(id, (s) => s.setMode(mode), UNKNOWN),
    async stop(id) {
      const s = sessions.get(id)
      if (!s) return UNKNOWN
      if (s.info().state === 'draft') {
        sessions.delete(id)
        changed()
        return { ok: true }
      }
      return s.stop()
    },
    remove(id) {
      const s = sessions.get(id)
      if (!s) return UNKNOWN
      const st = s.info().state
      if (st !== 'draft' && st !== 'exited') return { ok: false, reason: 'session-live' }
      sessions.delete(id)
      changed()
      return { ok: true }
    },
    list,
    get: (id) => sessions.get(id)?.info(),
    streamState: (id) => sessions.get(id)?.streamState() ?? null,
    onChanged(cb) {
      changedCbs.add(cb)
      return () => void changedCbs.delete(cb)
    },
    onStream(cb) {
      streamCbs.add(cb)
      return () => void streamCbs.delete(cb)
    },
    disposeAll() {
      if (batchTimer !== null) {
        clearTimer(batchTimer)
        batchTimer = null
      }
      for (const s of sessions.values()) s.dispose()
    }
  }
}
