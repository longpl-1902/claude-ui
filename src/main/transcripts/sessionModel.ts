import { LEAD_ID, tokenHeadline } from '../../shared/teamDefaults'
import type {
  ActivityItem,
  Agent,
  AgentEvent,
  ChangedFile,
  ConsoleLine,
  LastTurn,
  MailboxMessage,
  OpenTool,
  RegistryStatus,
  TeamSnapshot
} from '../../shared/types'
import type { TokenUsage, ToolResultRec, TranscriptRecord } from './records'

export interface SubagentMeta {
  agentType?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
  model?: string
  finished?: boolean
  name?: string
  requestShape?: string
}

export function parseSubagentMeta(text: string): SubagentMeta | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const out: SubagentMeta = {}
  for (const k of ['agentType', 'description', 'toolUseId', 'model', 'name', 'requestShape'] as const) {
    const v = o[k]
    if (typeof v === 'string') out[k] = v
  }
  if (typeof o.spawnDepth === 'number' && Number.isFinite(o.spawnDepth)) out.spawnDepth = o.spawnDepth
  if (typeof o.finished === 'boolean') out.finished = o.finished
  return out
}

export interface SessionModelOptions {
  sessionId: string
  accountId: string
  projectCwd?: string
  caps?: { activity?: number; events?: number; console?: number; messages?: number }
}

export interface SessionModel {
  ingest(source: 'lead' | string, records: TranscriptRecord[]): void
  setMeta(agentId: string, meta: SubagentMeta): void
  setRegistry(entry: { status?: RegistryStatus; waitingFor?: string; updatedMs: number } | null): void
  reset(source: 'lead' | string): void
  markHistoryTruncated(): void
  isDirty(): boolean
  snapshot(nowMs: number): TeamSnapshot
}

const PALETTE = ['#7AA7FF', '#F0A35E', '#7BD389', '#C792EA', '#F2777A', '#5ECFD8', '#E6C84F', '#9AA5FF']
const LEAD_ALIASES = new Set(['lead', 'team-lead', 'main'])

const pad = (n: number): string => (n < 10 ? '0' + n : String(n))
const hms = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const hm = (ms: number): string => hms(ms).slice(0, 5)
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s)
const basename = (p: string): string => p.split(/[\\/]+/).filter(Boolean).pop() ?? ''

interface Stamped<T> {
  ms: number
  seq: number
  src: string
  v: T
}

interface ToolInfo {
  name: string
  target: string
  item: ActivityItem
}

interface AgentResultInfo {
  owner: string
  agentId: string
  status: string
  text?: string
  ms: number
}

interface AgentState {
  id: string
  order: number
  meta?: SubagentMeta
  startedMs?: number
  lastMs?: number
  model: string
  worktree: string
  cwd?: string
  uuids: Set<string>
  usage: Map<string, TokenUsage>
  tokenEmitted: Set<string>
  toolIds: Set<string>
  toolInfo: Map<string, ToolInfo>
  activity: ActivityItem[]
  openTools: OpenTool[]
  lastTool?: { tool: string; target: string }
  files: Map<string, { added: number; removed: number }>
  lastTurn: LastTurn
  errorKind?: string
  firstTask?: { text: string; ms: number }
  sends: { ms: number; to: string; text: string }[]
  titles: { custom?: string; ai?: string; agent?: string }
}

const newAgent = (id: string, order: number): AgentState => ({
  id,
  order,
  model: '',
  worktree: '',
  uuids: new Set(),
  usage: new Map(),
  tokenEmitted: new Set(),
  toolIds: new Set(),
  toolInfo: new Map(),
  activity: [],
  openTools: [],
  files: new Map(),
  lastTurn: 'none',
  sends: [],
  titles: {}
})

export function createSessionModel(opts: SessionModelOptions): SessionModel {
  const capActivity = opts.caps?.activity ?? 150
  const capEvents = opts.caps?.events ?? 500
  const capConsole = opts.caps?.console ?? 300
  const capMessages = opts.caps?.messages ?? 100

  const agents = new Map<string, AgentState>()
  const uuidOwner = new Map<string, string>()
  const msgOwner = new Map<string, string>()
  const toolOwner = new Map<string, string>()
  const agentResults = new Map<string, AgentResultInfo>() // by toolUseId
  let events: Stamped<AgentEvent>[] = []
  let consoleLines: Stamped<ConsoleLine>[] = []
  let seq = 0
  let registry: { status?: RegistryStatus; waitingFor?: string; updatedMs: number } | null = null
  let truncated = false
  let dirty = true

  const get = (id: string): AgentState => {
    let a = agents.get(id)
    if (!a) {
      a = newAgent(id, agents.size)
      agents.set(id, a)
    }
    return a
  }
  get(LEAD_ID)
  const srcId = (source: string): string => (source === 'lead' ? LEAD_ID : source)

  const trim = <T>(list: Stamped<T>[], cap: number): Stamped<T>[] => {
    if (list.length <= cap * 3) return list
    return list.slice().sort((a, b) => a.ms - b.ms || a.seq - b.seq).slice(-cap * 2)
  }
  const pushEvent = (src: string, ms: number, v: AgentEvent): void => {
    events.push({ ms, seq: seq++, src, v })
    events = trim(events, capEvents)
  }
  const pushConsole = (src: string, ms: number, who: string, text: string): void => {
    consoleLines.push({ ms, seq: seq++, src, v: { time: hms(ms), who, text } })
    consoleLines = trim(consoleLines, capConsole)
  }

  const resultText = (r: ToolResultRec): string =>
    r.interrupted
      ? 'interrupted'
      : r.isError
        ? r.summary || 'error'
        : r.fileChange
          ? `+${r.fileChange.added} −${r.fileChange.removed}`
          : r.summary || 'ok'

  function processRecord(src: string, a: AgentState, rec: TranscriptRecord): void {
    if (rec.t === 'title') {
      if (rec.kind === 'custom') a.titles.custom = rec.value
      else if (rec.kind === 'ai') a.titles.ai = rec.value
      else a.titles.agent = rec.value
      return
    }
    if (uuidOwner.has(rec.uuid)) return
    uuidOwner.set(rec.uuid, src)
    a.uuids.add(rec.uuid)
    const ms = rec.tsMs
    if (a.startedMs === undefined || ms < a.startedMs) a.startedMs = ms
    if (a.lastMs === undefined || ms > a.lastMs) a.lastMs = ms
    if (rec.cwd) a.cwd = rec.cwd
    if (rec.gitBranch) a.worktree = rec.gitBranch
    const base = (kind: AgentEvent['kind'], extra: Partial<AgentEvent> = {}): AgentEvent => ({
      ts: rec.ts,
      sessionId: opts.sessionId,
      agentId: a.id,
      kind,
      accountId: opts.accountId,
      uuid: rec.uuid,
      ...(rec.gitBranch ? { worktree: rec.gitBranch } : {}),
      ...extra
    })

    switch (rec.t) {
      case 'assistant': {
        if (rec.isApiError) {
          a.lastTurn = 'api_error'
          a.errorKind = rec.errorKind ?? 'unknown'
          pushEvent(src, ms, base('error', { result: a.errorKind }))
          pushConsole(src, ms, a.id, `API error: ${a.errorKind}`)
          return
        }
        if (rec.model && rec.model !== '<synthetic>') a.model = rec.model
        // tokens: once per message id, across all sources
        let tokens: AgentEvent['tokens']
        if (rec.usage) {
          const owner = msgOwner.get(rec.messageId)
          if (owner === undefined || owner === a.id) {
            msgOwner.set(rec.messageId, a.id)
            a.usage.set(rec.messageId, rec.usage)
            if (!a.tokenEmitted.has(rec.messageId)) tokens = { ...rec.usage }
          }
        }
        const withTokens = (e: AgentEvent): AgentEvent => {
          if (tokens) {
            e.tokens = tokens
            a.tokenEmitted.add(rec.messageId)
            tokens = undefined
          }
          return e
        }
        if (rec.text) {
          pushEvent(src, ms, withTokens(base('message')))
          pushConsole(src, ms, a.id, clip(rec.text, 200))
        }
        for (const tu of rec.toolUses) {
          if (a.toolIds.has(tu.id)) continue
          a.toolIds.add(tu.id)
          toolOwner.set(tu.id, a.id)
          const item: ActivityItem = { time: hms(ms), tool: tu.name, target: tu.target, result: '…', failed: false }
          a.activity.push(item)
          if (a.activity.length > capActivity * 2) a.activity.splice(0, a.activity.length - capActivity)
          a.toolInfo.set(tu.id, { name: tu.name, target: tu.target, item })
          a.openTools.push({ id: tu.id, name: tu.name, startedMs: ms })
          a.lastTool = { tool: tu.name, target: tu.target }
          pushEvent(src, ms, withTokens(base('tool_start', { tool: tu.name, target: tu.target, toolUseId: tu.id })))
          pushConsole(src, ms, a.id, `${tu.name} ${tu.target}`.trimEnd())
          if (tu.name === 'Agent') {
            pushEvent(src, ms, base('spawn', { tool: tu.name, target: tu.target, toolUseId: tu.id }))
            pushConsole(src, ms, a.id, `spawned ${tu.target}`)
          }
          if (tu.send) a.sends.push({ ms, to: tu.send.to, text: tu.send.text })
        }
        if (a.sends.length > 1000) a.sends.splice(0, a.sends.length - 500)
        if (rec.stopReason === 'end_turn' || rec.stopReason === 'stop_sequence') a.lastTurn = 'assistant_end'
        else if (rec.toolUses.length > 0 || rec.stopReason === 'tool_use') a.lastTurn = 'assistant_tool_use'
        a.errorKind = undefined
        return
      }
      case 'tool_results': {
        for (const r of rec.results) {
          const info = a.toolInfo.get(r.toolUseId)
          const text = resultText(r)
          if (info) {
            info.item.result = text
            info.item.failed = r.isError
            a.toolInfo.delete(r.toolUseId)
          }
          a.openTools = a.openTools.filter((t) => t.id !== r.toolUseId)
          if (r.fileChange && !r.isError) {
            const f = a.files.get(r.fileChange.path) ?? { added: 0, removed: 0 }
            f.added += r.fileChange.added
            f.removed += r.fileChange.removed
            a.files.delete(r.fileChange.path)
            a.files.set(r.fileChange.path, f) // Map order = recency
          }
          if (r.agentResult) {
            agentResults.set(r.toolUseId, {
              owner: src,
              agentId: r.agentResult.agentId,
              status: r.agentResult.status,
              ...(r.agentResult.text !== undefined ? { text: r.agentResult.text } : {}),
              ms
            })
          }
          pushEvent(
            src,
            ms,
            base('tool_end', {
              ...(info ? { tool: info.name, target: info.target } : {}),
              result: text,
              failed: r.isError,
              toolUseId: r.toolUseId
            })
          )
          if (r.isError && !r.interrupted) pushConsole(src, ms, a.id, `✗ ${info?.name ?? ''}: ${r.summary || 'error'}`)
        }
        a.lastTurn = 'tool_result'
        a.errorKind = undefined
        return
      }
      case 'prompt': {
        if (rec.kind === 'task-notification' || rec.kind === 'compact-summary') return
        a.lastTurn = 'user'
        a.errorKind = undefined
        if (rec.kind === 'first-task') {
          if (!a.firstTask) a.firstTask = { text: rec.text, ms }
        } else if (src === 'lead') {
          pushEvent(src, ms, base('message', { agentId: LEAD_ID, result: 'user' }))
          pushConsole(src, ms, 'you', clip(rec.text, 200))
        }
        return
      }
      case 'interrupted': {
        a.openTools = []
        a.lastTurn = 'interrupted'
        a.errorKind = undefined
        pushEvent(src, ms, base('status', { result: 'interrupted' }))
        return
      }
      case 'system': {
        if (!rec.fatal) return
        a.lastTurn = 'api_error'
        a.errorKind = rec.subtype
        pushEvent(src, ms, base('error', { result: rec.subtype }))
        pushConsole(src, ms, a.id, `API error: ${rec.subtype}`)
        return
      }
    }
  }

  function dropSource(id: string): void {
    const a = agents.get(id)
    if (!a) return
    for (const u of a.uuids) uuidOwner.delete(u)
    for (const m of a.usage.keys()) if (msgOwner.get(m) === id) msgOwner.delete(m)
    for (const t of a.toolIds) if (toolOwner.get(t) === id) toolOwner.delete(t)
    for (const [k, r] of agentResults) if (r.owner === id) agentResults.delete(k)
    events = events.filter((e) => e.src !== id)
    consoleLines = consoleLines.filter((e) => e.src !== id)
    const fresh = newAgent(id, a.order)
    if (a.meta) fresh.meta = a.meta
    agents.set(id, fresh)
  }

  function resultFor(a: AgentState): AgentResultInfo | undefined {
    const byTool = a.meta?.toolUseId ? agentResults.get(a.meta.toolUseId) : undefined
    if (byTool) return byTool
    for (const r of agentResults.values()) if (r.agentId === a.id) return r
    return undefined
  }

  function buildSnapshot(nowMs: number): TeamSnapshot {
    const all = [...agents.values()].sort((a, b) => a.order - b.order)
    // ---- tree
    const parent = new Map<string, string>()
    for (const a of all) {
      if (a.id === LEAD_ID) continue
      const owner = a.meta?.toolUseId ? toolOwner.get(a.meta.toolUseId) : undefined
      parent.set(a.id, owner && owner !== a.id && agents.has(owner) ? owner : LEAD_ID)
    }
    for (const a of all) {
      if (a.id === LEAD_ID) continue
      const seen = new Set<string>([a.id])
      let cur = parent.get(a.id)
      while (cur !== undefined && cur !== LEAD_ID) {
        if (seen.has(cur)) {
          parent.set(a.id, LEAD_ID)
          break
        }
        seen.add(cur)
        cur = parent.get(cur)
      }
    }
    const kids = new Map<string, AgentState[]>()
    for (const a of all) {
      if (a.id === LEAD_ID) continue
      const p = parent.get(a.id)!
      let l = kids.get(p)
      if (!l) kids.set(p, (l = []))
      l.push(a)
    }
    const ordered: AgentState[] = []
    const depth = new Map<string, number>()
    const walk = (a: AgentState, d: number): void => {
      ordered.push(a)
      depth.set(a.id, d)
      const ch = (kids.get(a.id) ?? []).slice().sort((x, y) => (x.startedMs ?? Infinity) - (y.startedMs ?? Infinity) || x.order - y.order)
      for (const c of ch) walk(c, d + 1)
    }
    walk(agents.get(LEAD_ID)!, 0)

    // ---- title / names
    const lead = agents.get(LEAD_ID)!
    const pick = (k: 'custom' | 'ai' | 'agent'): string | undefined => {
      for (const a of [lead, ...all]) if (a.titles[k] !== undefined) return a.titles[k]
      return undefined
    }
    const title = pick('custom') ?? pick('ai') ?? pick('agent')
    const nameOf = (a: AgentState): string => (a.id === LEAD_ID ? 'lead' : (a.meta?.name ?? a.meta?.agentType ?? 'agent'))
    const byName = new Map<string, AgentState>()
    for (const a of ordered) {
      const n = nameOf(a).toLowerCase()
      if (!byName.has(n)) byName.set(n, a)
      if (!byName.has(a.id.toLowerCase())) byName.set(a.id.toLowerCase(), a)
    }
    const resolve = (to: string): AgentState | undefined => {
      const k = to.trim().toLowerCase()
      if (LEAD_ALIASES.has(k)) return lead
      return byName.get(k)
    }

    // ---- finished / background / stop
    const finishedMs = new Map<string, number>()
    const background = new Set<string>()
    for (const a of ordered) {
      if (a.id === LEAD_ID) continue
      const r = resultFor(a)
      if (a.meta?.finished === true) finishedMs.set(a.id, r?.status === 'completed' ? r.ms : (a.lastMs ?? 0))
      else if (r?.status === 'completed') finishedMs.set(a.id, r.ms)
      if (a.meta?.requestShape === 'background' || r?.status === 'async_launched') background.add(a.id)
    }

    // ---- messages
    const msgs = new Map<string, { ms: number; m: MailboxMessage }[]>()
    const addMsg = (id: string, ms: number, direction: 'in' | 'out', peer: string, text: string): void => {
      let l = msgs.get(id)
      if (!l) msgs.set(id, (l = []))
      l.push({ ms, m: { direction, peer, time: hm(ms), text } })
    }
    for (const a of ordered) {
      if (a.id !== LEAD_ID) {
        const pn = nameOf(agents.get(parent.get(a.id)!)!)
        if (a.firstTask) addMsg(a.id, a.firstTask.ms, 'in', pn, a.firstTask.text)
        const r = resultFor(a)
        if (r?.text) addMsg(a.id, r.ms, 'out', pn, r.text)
      }
      for (const s of a.sends) {
        addMsg(a.id, s.ms, 'out', s.to, s.text)
        const rcpt = resolve(s.to)
        if (rcpt && rcpt.id !== a.id) addMsg(rcpt.id, s.ms, 'in', nameOf(a), s.text)
      }
    }

    // ---- events / console
    const evAll = events.slice()
    const coAll = consoleLines.slice()
    for (const [id, ms] of finishedMs) {
      const a = agents.get(id)!
      const stopSeq = seq + evAll.length
      evAll.push({
        ms,
        seq: stopSeq,
        src: id,
        v: {
          ts: new Date(ms).toISOString(),
          sessionId: opts.sessionId,
          agentId: id,
          kind: 'stop',
          accountId: opts.accountId,
          ...(a.worktree ? { worktree: a.worktree } : {})
        }
      })
      coAll.push({ ms, seq: stopSeq, src: id, v: { time: hms(ms), who: id, text: 'done' } })
    }
    const cmp = (x: { ms: number; seq: number }, y: { ms: number; seq: number }): number => x.ms - y.ms || x.seq - y.seq
    const outEvents = evAll
      .sort(cmp)
      .slice(-capEvents)
      .map((e) => {
        const ev: AgentEvent = { ...e.v }
        if (ev.tokens) ev.tokens = { ...ev.tokens }
        const p = ev.agentId === LEAD_ID ? undefined : parent.get(ev.agentId)
        if (p !== undefined) ev.parentAgentId = p
        return ev
      })
    const outConsole = coAll
      .sort(cmp)
      .slice(-capConsole)
      .map((c) => ({ ...c.v }))

    // ---- agents
    const outAgents: Agent[] = ordered.map((a) => {
      const isLead = a.id === LEAD_ID
      const name = nameOf(a)
      const words = name.split(/[\s\-_.]+/).filter(Boolean)
      const initials = (words.slice(0, 2).map((w) => w[0]!).join('') || name[0] || '?').toUpperCase()
      const fin = finishedMs.has(a.id)
      const running = !fin && (a.openTools.length > 0 || a.lastTurn === 'user' || a.lastTurn === 'tool_result')
      const startedMs = a.startedMs ?? 0
      const elapsedSec = a.startedMs === undefined ? 0 : Math.max(0, Math.round(((running ? nowMs : (a.lastMs ?? startedMs)) - startedMs) / 1000))
      const sum = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
      for (const u of a.usage.values()) {
        sum.input += u.input
        sum.output += u.output
        sum.cacheCreation += u.cacheCreation
        sum.cacheRead += u.cacheRead
      }
      const newestOpen = a.openTools[a.openTools.length - 1]
      const current = newestOpen
        ? { tool: newestOpen.name, target: a.toolInfo.get(newestOpen.id)?.target ?? '' }
        : { tool: a.lastTool?.tool ?? '', target: a.lastTool?.target ?? '' }
      const files: ChangedFile[] = [...a.files].reverse().map(([path, f]) => ({ path, added: f.added, removed: f.removed }))
      const kind = isLead ? 'lead' : a.meta?.name ? 'teammate' : 'subagent'
      const runtime: Agent['runtime'] = {
        kind,
        startedMs,
        lastActivityMs: a.lastMs ?? 0,
        openTools: a.openTools.map((t) => ({ ...t })),
        lastTurn: a.lastTurn
      }
      if (a.lastTurn === 'api_error' && a.errorKind !== undefined) runtime.errorKind = a.errorKind
      if (fin) runtime.finished = true
      if (background.has(a.id)) runtime.background = true
      if (isLead && registry) {
        runtime.registry = {
          status: registry.status ?? 'idle',
          ...(registry.waitingFor !== undefined ? { waitingFor: registry.waitingFor } : {}),
          updatedMs: registry.updatedMs
        }
      }
      const m = (msgs.get(a.id) ?? []).sort((x, y) => x.ms - y.ms).slice(-capMessages).map((x) => ({ ...x.m }))
      const out: Agent = {
        id: a.id,
        name,
        initials,
        avatarColor: isLead ? PALETTE[0]! : PALETTE[a.order % PALETTE.length]!,
        role: isLead ? (title ?? 'Lead') : (a.meta?.agentType ?? ''),
        model: a.model || a.meta?.model || '',
        worktree: a.worktree,
        taskTitle: isLead ? '' : (a.meta?.description ?? ''),
        current,
        elapsedSec,
        tokens: tokenHeadline(sum),
        toolCalls: a.toolIds.size,
        timeline: [],
        activity: a.activity.slice(-capActivity).map((x) => ({ ...x })),
        files,
        messages: m,
        depth: depth.get(a.id) ?? 0,
        runtime
      }
      if (!isLead) out.parentId = parent.get(a.id)!
      if (a.cwd !== undefined) out.cwd = a.cwd
      return out
    })

    const cwd = opts.projectCwd ?? lead.cwd
    const snap: TeamSnapshot = {
      source: 'live',
      sessionId: opts.sessionId,
      accountId: opts.accountId,
      repo: basename(cwd ?? ''),
      teamName: title ?? opts.sessionId.slice(0, 8),
      now: new Date(nowMs).toISOString(),
      agents: outAgents,
      events: outEvents,
      console: outConsole,
      worktrees: [],
      tasks: [],
      overlaps: [],
      timelineTicks: [],
      historyTruncated: truncated
    }
    if (cwd !== undefined) snap.cwd = cwd
    if (title !== undefined) snap.title = title
    return snap
  }

  return {
    ingest(source, records) {
      const id = srcId(source)
      const a = get(id)
      const before = uuidOwner.size
      let touched = false
      for (const r of records) {
        if (r.t === 'title') {
          processRecord(id === LEAD_ID ? 'lead' : id, a, r)
          touched = true
        } else processRecord(id === LEAD_ID ? 'lead' : id, a, r)
      }
      if (touched || uuidOwner.size !== before) dirty = true
    },
    setMeta(agentId, meta) {
      if (agentId === LEAD_ID) return
      get(agentId).meta = { ...meta }
      dirty = true
    },
    setRegistry(entry) {
      registry = entry ? { ...entry } : null
      dirty = true
    },
    reset(source) {
      dropSource(srcId(source))
      dirty = true
    },
    markHistoryTruncated() {
      truncated = true
      dirty = true
    },
    isDirty: () => dirty,
    snapshot(nowMs) {
      dirty = false
      return buildSnapshot(nowMs)
    }
  }
}
