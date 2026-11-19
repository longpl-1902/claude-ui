import { create } from 'zustand'
import type {
  ControlPermissionMode,
  ControlSessionInfo,
  ControlStartRequest,
  ControlStartResult,
  ControlStreamEvent,
  ControlStreamState,
  OkResult,
  PermissionAnswer
} from '@shared/types'

const MAX_NOTICES = 20

export interface StartFormState {
  open: boolean
  cwd?: string
  accountId?: string
}

export interface ControlStoreState {
  sessions: ControlSessionInfo[]
  streams: Record<string, ControlStreamState>
  error?: string
  init(): () => void
  start(req: ControlStartRequest): Promise<ControlStartResult>
  /** The ONLY caller of window.api.control.send (R-19). */
  send(controlId: string, text: string): Promise<OkResult>
  interrupt(id: string): Promise<OkResult>
  stop(id: string): Promise<OkResult>
  interruptAll(): Promise<number>
  answer(id: string, requestId: string, a: PermissionAnswer): Promise<OkResult>
  setModel(id: string, m: string | null): Promise<OkResult>
  setMode(id: string, m: ControlPermissionMode): Promise<OkResult>
  applyStream(events: ControlStreamEvent[]): void
  applySessions(l: ControlSessionInfo[]): void
  startForm: StartFormState
  openStartForm(p?: { cwd?: string; accountId?: string }): void
  closeStartForm(): void
}

const NO_API: OkResult = { ok: false, reason: 'unavailable' }

function emptyStream(controlId: string): ControlStreamState {
  return { controlId, thinking: false, permissions: [], notices: [] }
}

function addNotice(st: ControlStreamState, level: 'info' | 'error', text: string): ControlStreamState {
  const notices = [...st.notices, { level, text, time: new Date().toISOString() }].slice(-MAX_NOTICES)
  return { ...st, notices }
}

function withoutTyping(st: ControlStreamState): ControlStreamState {
  const { typing: _typing, ...rest } = st
  void _typing
  return rest
}

function reduceEvent(st: ControlStreamState, e: ControlStreamEvent): ControlStreamState {
  switch (e.kind) {
    case 'typing':
      return { ...st, typing: { messageId: e.messageId, text: e.text } }
    case 'typing-clear':
      return withoutTyping(st)
    case 'thinking':
      return { ...st, thinking: e.active }
    case 'permission':
      if (st.permissions.some((p) => p.requestId === e.prompt.requestId)) return st
      return { ...st, permissions: [...st.permissions, e.prompt] }
    case 'permission-resolved':
      return { ...st, permissions: st.permissions.filter((p) => p.requestId !== e.requestId) }
    case 'turn-end': {
      const cleared: ControlStreamState = { ...withoutTyping(st), thinking: false }
      if (e.result === 'interrupted') return addNotice(cleared, 'info', 'Interrupted')
      if (e.result === 'error') return addNotice(cleared, 'error', e.text || 'The turn ended with an error')
      return cleared
    }
    case 'notice':
      return addNotice(st, e.level, e.text)
  }
}

type Api = NonNullable<Window['api']>

async function call<T>(fn: (api: Api) => Promise<T>, fallback: T): Promise<T> {
  const api = typeof window === 'undefined' ? undefined : window.api
  if (!api?.control) return fallback
  try {
    return await fn(api)
  } catch (err) {
    useControlStore.setState({ error: err instanceof Error ? err.message : String(err) })
    return fallback
  }
}

export const useControlStore = create<ControlStoreState>((set, get) => ({
  sessions: [],
  streams: {},
  startForm: { open: false },

  init() {
    const api = typeof window === 'undefined' ? undefined : window.api
    if (!api?.control) return () => {}
    const offChanged = api.control.onChanged((l) => get().applySessions(l))
    const offStream = api.control.onStream((e) => get().applyStream(e))
    void (async () => {
      try {
        get().applySessions(await api.control.list())
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      offChanged()
      offStream()
    }
  },

  start: (req) => call((a) => a.control.start(req), { ok: false, reason: 'invalid-args' } as ControlStartResult),
  send: (controlId, text) => call((a) => a.control.send(controlId, text), NO_API),
  interrupt: (id) => call((a) => a.control.interrupt(id), NO_API),
  stop: (id) => call((a) => a.control.stop(id), NO_API),
  async interruptAll() {
    const busy = get().sessions.filter((s) => s.state === 'busy')
    await Promise.all(busy.map((s) => get().interrupt(s.id)))
    await call((a) => a.team.pauseAll(), NO_API)
    return busy.length
  },
  answer: (id, requestId, ans) => call((a) => a.control.answer(id, requestId, ans), NO_API),
  setModel: (id, m) => call((a) => a.control.setModel(id, m), NO_API),
  setMode: (id, m) => call((a) => a.control.setMode(id, m), NO_API),

  applyStream(events) {
    if (!events.length) return
    set((s) => {
      const streams = { ...s.streams }
      for (const e of events) streams[e.controlId] = reduceEvent(streams[e.controlId] ?? emptyStream(e.controlId), e)
      return { streams }
    })
  },

  applySessions(l) {
    set((s) => {
      const ids = new Set(l.map((x) => x.id))
      const streams: Record<string, ControlStreamState> = {}
      for (const [k, v] of Object.entries(s.streams)) if (ids.has(k)) streams[k] = v
      return { sessions: l, streams }
    })
  },

  openStartForm(p) {
    set({
      startForm: {
        open: true,
        ...(p?.cwd !== undefined ? { cwd: p.cwd } : {}),
        ...(p?.accountId !== undefined ? { accountId: p.accountId } : {})
      }
    })
  },
  closeStartForm() {
    set({ startForm: { open: false } })
  }
}))

export const selectControlForSession =
  (sessionId?: string) =>
  (s: ControlStoreState): ControlSessionInfo | undefined =>
    sessionId ? s.sessions.find((x) => x.sessionId === sessionId) : undefined

export const selectDraftControl = (s: ControlStoreState): ControlSessionInfo | undefined => {
  for (let i = s.sessions.length - 1; i >= 0; i--) {
    const x = s.sessions[i]!
    if (x.state === 'draft' && !x.sessionId) return x
  }
  return undefined
}

export const selectPendingPermissionCount = (s: ControlStoreState): number =>
  s.sessions.reduce((n, x) => n + (s.streams[x.id]?.permissions.length ?? x.pendingPermissions), 0)
