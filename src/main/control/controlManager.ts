// Registry of controlled sessions + 50 ms batching of stream events. Spawning is delegated to controlSession.
import { randomUUID } from 'node:crypto'
import type { ClaudeCommand } from '../pty/claudeBinary'
import type {
  ControlDetails, ControlPermissionMode, ControlResume, ControlSessionInfo, ControlStartResult, ControlStreamEvent, ControlStreamState, Effort,
  FileSuggestion, ImageAttachment, OkResult, PermissionAnswer, RewindPreview
} from '../../shared/types'
import { createControlSession, type ChildLike, type ControlSession, type SpawnFn } from './controlSession'
import type { CtlReq } from './protocol'

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

export interface ControlCreateOptions {
  cwd: string
  accountId: string
  configDirAbs: string | null
  model?: string
  permissionMode: ControlPermissionMode
  resume?: ControlResume
  effort?: Effort
  outputStyle?: string
  resumeAt?: string
}

export interface ControlManager {
  create(o: ControlCreateOptions): ControlSessionInfo
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
  // ---- v2 (T26) ----
  request(id: string, req: CtlReq, timeoutMs?: number): Promise<unknown>
  details(id: string): ControlDetails | null
  onDetails(cb: (d: ControlDetails) => void): () => void
  sendRich(id: string, text: string, images: ImageAttachment[]): Promise<OkResult>
  refreshContext(id: string): Promise<OkResult>
  mcpToggle(id: string, name: string, enabled: boolean): Promise<OkResult>
  mcpReconnect(id: string, name: string): Promise<OkResult>
  /** null when the session is not running (the caller falls back to git ls-files). */
  fileSuggestions(id: string, query: string): Promise<FileSuggestion[] | null>
  rewindPreview(id: string, uuid: string): Promise<RewindPreview>
  rewind(id: string, uuid: string): Promise<OkResult>
  /** Creates a draft that forks the session at a user message; nothing is spawned or sent. */
  forkAt(id: string, uuid: string): ControlStartResult
  setEffort(id: string, effort: Effort | null): Promise<OkResult>
  setOutputStyle(id: string, style: string | null): Promise<OkResult>
  rename(id: string, title: string): Promise<OkResult>
  getPlan(id: string): Promise<{ exists: boolean; content?: string }>
}

const BATCH_MS = 50
const UNKNOWN: OkResult = { ok: false, reason: 'unknown-session' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createControlManager(deps: ControlManagerDeps): ControlManager {
  const now = deps.now ?? ((): Date => new Date())
  const newId = deps.newId ?? ((): string => randomUUID())
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((t: unknown): void => clearTimeout(t as ReturnType<typeof setTimeout>))
  const sessions = new Map<string, ControlSession>()
  const changedCbs = new Set<(l: ControlSessionInfo[]) => void>()
  const streamCbs = new Set<(e: ControlStreamEvent[]) => void>()
  const detailsCbs = new Set<(d: ControlDetails) => void>()
  const created = new Map<string, ControlCreateOptions>()
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

  const onDetails = (d: ControlDetails): void => {
    for (const cb of [...detailsCbs]) cb(d)
  }

  const withSession = <T>(id: string, fn: (s: ControlSession) => T, miss: T): T => {
    const s = sessions.get(id)
    return s ? fn(s) : miss
  }

  const api: ControlManager = {
    create(o) {
      const id = newId()
      const s = createControlSession(
        { ...deps, now, setTimer, clearTimer, nextRequestId: () => `ac-${++reqSeq}`, emit, changed, onDetails },
        { id, ...o }
      )
      sessions.set(id, s)
      created.set(id, o)
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
        created.delete(id)
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
      created.delete(id)
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
    request: (id, req, timeoutMs) => {
      const s = sessions.get(id)
      return s ? s.request(req, timeoutMs) : Promise.reject(new Error('unknown-session'))
    },
    details: (id) => sessions.get(id)?.details() ?? null,
    onDetails(cb) {
      detailsCbs.add(cb)
      return () => void detailsCbs.delete(cb)
    },
    sendRich: (id, text, images) => withSession(id, (s) => s.sendRich(text, images), Promise.resolve(UNKNOWN)),
    refreshContext: (id) => withSession(id, (s) => s.refreshContext(), Promise.resolve(UNKNOWN)),
    mcpToggle: (id, name, enabled) => withSession(id, (s) => s.mcpToggle(name, enabled), Promise.resolve(UNKNOWN)),
    mcpReconnect: (id, name) => withSession(id, (s) => s.mcpReconnect(name), Promise.resolve(UNKNOWN)),
    fileSuggestions: (id, query) => withSession(id, (s) => s.fileSuggestions(query), Promise.resolve(null)),
    rewindPreview: (id, uuid) =>
      withSession(
        id,
        (s) => s.rewindPreview(uuid),
        Promise.resolve({ canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'unknown-session' })
      ),
    rewind: (id, uuid) => withSession(id, (s) => s.rewind(uuid), Promise.resolve(UNKNOWN)),
    forkAt(id, uuid) {
      const s = sessions.get(id)
      const o = created.get(id)
      if (!s || !o) return { ok: false, reason: 'invalid-args' }
      const info = s.info()
      const d = s.details()
      if (!UUID_RE.test(uuid) || info.sessionId === undefined) return { ok: false, reason: 'invalid-args' }
      const child = api.create({
        cwd: o.cwd,
        accountId: o.accountId,
        configDirAbs: o.configDirAbs,
        permissionMode: info.permissionMode,
        ...(info.model !== undefined ? { model: info.model } : {}),
        ...(d.effort !== undefined ? { effort: d.effort } : {}),
        ...(d.outputStyle !== undefined ? { outputStyle: d.outputStyle } : {}),
        resume: { kind: 'resume', sessionId: info.sessionId, fork: true },
        resumeAt: uuid
      })
      return { ok: true, controlId: child.id }
    },
    setEffort: (id, effort) => withSession(id, (s) => s.setEffort(effort), Promise.resolve(UNKNOWN)),
    setOutputStyle: (id, style) => withSession(id, (s) => s.setOutputStyle(style), Promise.resolve(UNKNOWN)),
    rename: (id, title) => withSession(id, (s) => s.rename(title), Promise.resolve(UNKNOWN)),
    getPlan: (id) => withSession(id, (s) => s.getPlan(), Promise.resolve<{ exists: boolean; content?: string }>({ exists: false })),
    disposeAll() {
      if (batchTimer !== null) {
        clearTimer(batchTimer)
        batchTimer = null
      }
      for (const s of sessions.values()) s.dispose()
    }
  }
  return api
}
