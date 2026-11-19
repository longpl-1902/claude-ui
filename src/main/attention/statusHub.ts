import { createHash } from 'node:crypto'
import { tokenHeadline } from '../../shared/teamDefaults'
import { HOOK_STALE_MS } from '../../shared/liveStatus'
import type {
  AttentionItem, AttentionSnapshot, ControlSessionInfo, HookEvent, PermissionPrompt, ProjectStatus, SessionProject, SessionSummary, TokenTotals
} from '../../shared/types'
import { parseLine, shouldSkipRaw } from '../transcripts/parseLine'
import type { ByteReadFs } from '../transcripts/transcriptFs'

type ControlEntry = { info: ControlSessionInfo; permissions: PermissionPrompt[] }

export interface StatusHubDeps {
  fs: ByteReadFs
  nowMs: () => number
  listSessions: () => Promise<SessionSummary[]>
  controls: () => ControlEntry[]
  sessionFile: (s: SessionSummary) => string
  usageByProject: () => Record<string, TokenTotals>
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
}
export interface StatusHub {
  refresh(): Promise<void>
  ingestHook(e: HookEvent): void
  onFileChanged(path: string): void
  snapshot(): AttentionSnapshot
  onChanged(cb: (s: AttentionSnapshot) => void): () => void
  dispose(): void
}

const TAIL_BYTES = 256 * 1024
const MAX_TRACKED = 20
const HOOK_TRACK_MS = 10 * 60_000
const HOOK_PROJECT_MS = 24 * 3_600_000
const PROJECT_WINDOW_MS = 24 * 3_600_000
const API_ERROR_MS = 30 * 60_000
const DEBOUNCE_MS = 1000
const INPUT_CAP = 4096
const DETAIL_CAP = 200
const LEAD = 'lead'
const NEEDS_YOU_NOTIFICATIONS = new Set(['agent_needs_input', 'elicitation_dialog'])
const IDLE_NOTIFICATIONS = new Set(['idle_prompt', 'agent_completed'])
const CLEAR_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'UserPromptSubmit', 'StopFailure'])

const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1) + '…')
const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase()
const hash = (...parts: (string | number)[]): string => createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16)

interface OpenTool { kind: 'question' | 'plan'; sinceMs: number; detail: string }
interface Light {
  path: string
  offset: number // -1 = not read yet
  open: Map<string, OpenTool>
  apiError?: { tsMs: number; kind: string }
  hasAssistant: boolean
  lastAssistantMs: number
  lastActivityMs: number
}
interface HookSlot { sinceMs: number; detail: string; toolName?: string; cwd?: string; agentType?: string }
interface HookAgent { permission?: HookSlot; blockedInput?: HookSlot; idle?: HookSlot }
interface HookSession { lastEventMs: number; agents: Map<string, HookAgent> }

function projectOf(s: SessionSummary): SessionProject {
  if (s.project) return s.project
  const root = s.cwd ?? s.projectDir
  const name = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root
  return { key: normPath(root), name, root, git: false }
}

export function createStatusHub(deps: StatusHubDeps): StatusHub {
  const lights = new Map<string, Light>()
  const hooks = new Map<string, HookSession>()
  const hookProject = new Map<string, string>() // sessionId -> project key, remembered from past lists
  const listeners = new Set<(s: AttentionSnapshot) => void>()
  let tracked = new Map<string, string>() // normalized transcript path -> sessionId
  let snap: AttentionSnapshot = { items: [], projects: [], updatedAt: new Date(deps.nowMs()).toISOString() }
  let sig = JSON.stringify({ items: snap.items, projects: snap.projects })
  let timer: unknown
  let disposed = false
  let running: Promise<void> | null = null
  let again = false

  // ---- transcript tail: main transcript only, read-only, bounded ----
  function applyLine(l: Light, line: string): void {
    if (shouldSkipRaw(line)) return
    const r = parseLine(line)
    if (!r || r.t === 'title' || r.agentId !== undefined) return
    if (r.tsMs > l.lastActivityMs) l.lastActivityMs = r.tsMs
    if (r.t === 'assistant') {
      l.hasAssistant = true
      l.lastAssistantMs = r.tsMs
      l.apiError = r.isApiError ? { tsMs: r.tsMs, kind: r.errorKind ?? 'error' } : undefined
      for (const u of r.toolUses) {
        if (u.name === 'AskUserQuestion') l.open.set(u.id, { kind: 'question', sinceMs: r.tsMs, detail: clip(u.target || 'Question', DETAIL_CAP) })
        else if (u.name === 'ExitPlanMode') l.open.set(u.id, { kind: 'plan', sinceMs: r.tsMs, detail: clip(u.target || 'Plan approval', DETAIL_CAP) })
      }
    } else if (r.t === 'tool_results') {
      for (const x of r.results) l.open.delete(x.toolUseId)
    } else if (r.t === 'prompt') {
      l.apiError = undefined
    }
  }

  async function tail(l: Light): Promise<void> {
    const st = await deps.fs.stat(l.path)
    if (!st || !st.isFile) return
    if (st.size < l.offset) {
      // truncated or rotated: start over
      l.offset = -1
      l.open.clear()
      l.apiError = undefined
      l.hasAssistant = false
    }
    let start = l.offset
    let skipPartial = false
    if (start < 0) {
      start = Math.max(0, st.size - TAIL_BYTES)
      skipPartial = start > 0
    }
    if (st.size <= start) {
      l.offset = start
      return
    }
    const bytes = await deps.fs.readRange(l.path, start, st.size)
    let from = 0
    if (skipPartial) {
      const nl = bytes.indexOf(10)
      if (nl < 0) {
        l.offset = start + bytes.length
        return
      }
      from = nl + 1
    }
    const lastNl = bytes.lastIndexOf(10)
    let end = lastNl >= from ? lastNl + 1 : from
    const dec = new TextDecoder()
    if (end > from) for (const line of dec.decode(bytes.subarray(from, end)).split('\n')) applyLine(l, line)
    if (end < bytes.length) {
      const rest = dec.decode(bytes.subarray(end)).trim()
      let complete = false
      try {
        JSON.parse(rest)
        complete = true
      } catch {
        // partial last line: wait for more bytes
      }
      if (complete) {
        applyLine(l, rest)
        end = bytes.length
      }
    }
    l.offset = start + end
  }

  async function compute(): Promise<void> {
    const sessions = await deps.listSessions()
    const now = deps.nowMs()

    const controlById = new Map<string, ControlEntry>()
    const controlBySession = new Map<string, ControlEntry>()
    for (const c of deps.controls()) {
      controlById.set(c.info.id, c)
      if (c.info.sessionId) controlBySession.set(c.info.sessionId, c)
    }
    const ctlOf = (s: SessionSummary): ControlEntry | undefined =>
      s.controlled ? ((s.controlId ? controlById.get(s.controlId) : undefined) ?? controlBySession.get(s.sessionId)) : undefined
    const isActive = (s: SessionSummary): boolean => {
      if (s.live === true) return true
      const c = ctlOf(s)
      return !!c && c.info.state !== 'draft' && c.info.state !== 'exited'
    }

    for (const [id, h] of hooks) if (now - h.lastEventMs > HOOK_PROJECT_MS) hooks.delete(id)
    const hookRecent = (id: string): boolean => {
      const h = hooks.get(id)
      return !!h && now - h.lastEventMs <= HOOK_TRACK_MS
    }

    const trackedSessions = sessions
      .filter((s) => isActive(s) || hookRecent(s.sessionId))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_TRACKED)

    const keep = new Set(trackedSessions.map((s) => s.sessionId))
    for (const id of [...lights.keys()]) if (!keep.has(id)) lights.delete(id)
    const nextTracked = new Map<string, string>()
    await Promise.all(
      trackedSessions.map(async (s) => {
        const path = deps.sessionFile(s)
        nextTracked.set(normPath(path), s.sessionId)
        let l = lights.get(s.sessionId)
        if (!l || l.path !== path) {
          l = { path, offset: -1, open: new Map(), hasAssistant: false, lastAssistantMs: 0, lastActivityMs: 0 }
          lights.set(s.sessionId, l)
        }
        try {
          await tail(l)
        } catch {
          // unreadable transcript: keep what we know
        }
      })
    )
    tracked = nextTracked

    // ---- items ----
    const items: AttentionItem[] = []
    for (const s of trackedSessions) {
      const proj = projectOf(s)
      const l = lights.get(s.sessionId)
      const ctl = ctlOf(s)
      const base = {
        projectKey: proj.key, projectName: proj.name, accountId: s.accountId, sessionId: s.sessionId,
        agentId: LEAD, agentName: 'Lead', external: !s.controlled
      }
      const mine: AttentionItem[] = []

      if (ctl) {
        for (const p of ctl.permissions) {
          mine.push({
            ...base, id: hash(s.sessionId, 'permission', p.requestId), kind: 'permission', severity: 'blocked',
            detail: clip(`${p.displayName || p.toolName}: ${p.inputPreview}`, DETAIL_CAP), sinceMs: Date.parse(p.receivedAt) || now,
            cwd: ctl.info.cwd, controlId: ctl.info.id, requestId: p.requestId, canAllowSession: p.canAllowSession === true,
            toolName: p.toolName, input: clip(p.inputPreview, INPUT_CAP)
          })
        }
      }
      if (l) {
        for (const [toolId, o] of l.open) {
          mine.push({ ...base, id: hash(s.sessionId, o.kind, toolId), kind: o.kind, severity: 'blocked', detail: o.detail, sinceMs: o.sinceMs })
        }
        if (l.apiError && now - l.apiError.tsMs <= API_ERROR_MS) {
          mine.push({ ...base, id: hash(s.sessionId, 'api-error', l.apiError.tsMs), kind: 'api-error', severity: 'blocked', detail: `API error: ${l.apiError.kind}`, sinceMs: l.apiError.tsMs })
        }
      }
      const h = hooks.get(s.sessionId)
      if (h) {
        const fresh = (x: HookSlot | undefined): x is HookSlot => !!x && now - x.sinceMs <= HOOK_STALE_MS
        for (const [agentKey, a] of h.agents) {
          const who = agentKey === LEAD
            ? { agentId: LEAD, agentName: 'Lead' }
            : { agentId: agentKey, agentName: a.permission?.agentType ?? a.blockedInput?.agentType ?? a.idle?.agentType ?? agentKey }
          // a controlled session already reports its own prompts (with ids); hooks would only duplicate the lead's
          if (fresh(a.permission) && !(ctl && agentKey === LEAD && ctl.permissions.length > 0)) {
            const x = a.permission
            mine.push({
              ...base, ...who, id: hash(s.sessionId, agentKey, 'permission', x.sinceMs), kind: 'permission', severity: 'blocked',
              detail: x.detail, sinceMs: x.sinceMs, ...(x.cwd ? { cwd: x.cwd } : {}), ...(x.toolName ? { toolName: x.toolName } : {})
            })
          }
          if (fresh(a.blockedInput)) {
            mine.push({ ...base, ...who, id: hash(s.sessionId, agentKey, 'input', a.blockedInput.sinceMs), kind: 'input', severity: 'blocked', detail: a.blockedInput.detail, sinceMs: a.blockedInput.sinceMs })
          }
          if (fresh(a.idle)) {
            mine.push({ ...base, ...who, id: hash(s.sessionId, agentKey, 'idle', a.idle.sinceMs), kind: 'input', severity: 'idle', detail: a.idle.detail, sinceMs: a.idle.sinceMs })
          }
        }
      }
      if (mine.length === 0) {
        const since = l?.lastAssistantMs || l?.lastActivityMs || s.mtimeMs
        if (s.live && s.registryStatus === 'waiting') {
          mine.push({ ...base, id: hash(s.sessionId, 'registry-waiting', since), kind: 'input', severity: 'blocked', detail: 'Waiting for input', sinceMs: since })
        } else if (((s.live && s.registryStatus === 'idle') || (ctl && ctl.info.state === 'idle')) && l?.hasAssistant) {
          mine.push({ ...base, id: hash(s.sessionId, 'registry-idle', since), kind: 'input', severity: 'idle', detail: 'Ready for your next prompt', sinceMs: since })
        }
      }
      items.push(...mine)
    }
    items.sort((a, b) => a.sinceMs - b.sinceMs || (a.id < b.id ? -1 : 1))

    // ---- projects: all sessions of the last 24 h (and anything live) ----
    const usage = deps.usageByProject()
    for (const s of sessions) hookProject.set(s.sessionId, projectOf(s).key)
    const hookKeys = new Set<string>()
    for (const [id, h] of hooks) {
      const k = hookProject.get(id)
      if (k && now - h.lastEventMs <= HOOK_PROJECT_MS) hookKeys.add(k)
    }
    const groups = new Map<string, { p: SessionProject; accounts: Set<string>; live: number; running: number; last: number }>()
    for (const s of sessions) {
      const active = isActive(s)
      if (!active && now - s.mtimeMs > PROJECT_WINDOW_MS) continue
      const p = projectOf(s)
      let g = groups.get(p.key)
      if (!g) groups.set(p.key, (g = { p, accounts: new Set(), live: 0, running: 0, last: 0 }))
      if (active) {
        g.live++
        g.accounts.add(s.accountId)
        if (s.registryStatus === 'busy' || ctlOf(s)?.info.state === 'busy') g.running++
      }
      if (s.mtimeMs > g.last) g.last = s.mtimeMs
    }
    const projects: ProjectStatus[] = [...groups.values()]
      .map((g) => {
        const mine = items.filter((i) => i.projectKey === g.p.key)
        const t = usage[g.p.key]
        return {
          key: g.p.key, name: g.p.name, root: g.p.root, git: g.p.git,
          accountIds: [...g.accounts], mixedAccounts: g.accounts.size > 1,
          liveSessions: g.live, running: g.running,
          waiting: mine.filter((i) => i.severity === 'idle').length,
          needsYou: mine.filter((i) => i.severity === 'blocked').length,
          tokensToday: t ? tokenHeadline(t) : 0,
          lastActivityMs: g.last,
          hooksActive: hookKeys.has(g.p.key)
        }
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.key < b.key ? -1 : 1))

    const nextSig = JSON.stringify({ items, projects })
    if (nextSig === sig) return
    sig = nextSig
    snap = { items, projects, updatedAt: new Date(now).toISOString() }
    for (const cb of [...listeners]) {
      try {
        cb(snap)
      } catch {
        // a listener must not break the hub
      }
    }
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          await compute()
        } catch {
          // keep the previous snapshot
        }
      } while (again && !disposed)
    })().finally(() => {
      running = null
    })
    return running
  }

  function schedule(): void {
    if (disposed || timer !== undefined) return
    timer = deps.setTimer(() => {
      timer = undefined
      void refresh()
    }, DEBOUNCE_MS)
  }

  return {
    refresh,
    ingestHook(e) {
      let h = hooks.get(e.sessionId)
      if (!h) hooks.set(e.sessionId, (h = { lastEventMs: 0, agents: new Map() }))
      h.lastEventMs = Math.max(h.lastEventMs, e.receivedMs)
      const sess = h
      const key = e.agentId && e.agentId !== LEAD ? e.agentId : LEAD
      const agent = (k: string): HookAgent => {
        let a = sess.agents.get(k)
        if (!a) sess.agents.set(k, (a = {}))
        return a
      }
      if (e.event === 'PermissionRequest') {
        agent(key).permission = { sinceMs: e.receivedMs, detail: clip(e.toolName ?? 'Permission requested', DETAIL_CAP), toolName: e.toolName, cwd: e.cwd, agentType: e.agentType }
      } else if (e.event === 'Notification' && e.notificationType !== undefined) {
        const t = e.notificationType
        const slot: HookSlot = { sinceMs: e.receivedMs, detail: clip(e.message ?? t, DETAIL_CAP), cwd: e.cwd, agentType: e.agentType }
        if (t === 'permission_prompt') {
          const a = agent(key)
          if (!a.permission) a.permission = slot // a PermissionRequest for the same prompt is richer
        } else if (NEEDS_YOU_NOTIFICATIONS.has(t)) agent(key).blockedInput = slot
        else if (IDLE_NOTIFICATIONS.has(t)) agent(key).idle = slot
      } else if (e.event === 'Stop' || e.event === 'SessionEnd') {
        if (key === LEAD) sess.agents.clear()
        else sess.agents.delete(key)
      } else if (e.event === 'SubagentStop') {
        if (key !== LEAD) sess.agents.delete(key)
      } else if (CLEAR_EVENTS.has(e.event)) sess.agents.delete(key)
      schedule()
    },
    onFileChanged(path) {
      if (tracked.has(normPath(path))) schedule()
    },
    snapshot: () => snap,
    onChanged(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    dispose() {
      disposed = true
      if (timer !== undefined) deps.clearTimer(timer)
      timer = undefined
      listeners.clear()
      lights.clear()
      hooks.clear()
    }
  }
}
