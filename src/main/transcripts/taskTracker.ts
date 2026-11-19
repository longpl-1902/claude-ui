import type { SharedTask, SharedTaskState } from '../../shared/types'
import type { ToolResultRec, ToolUseRec } from './records'

export interface TaskTracker {
  onToolUse(agentId: string, u: ToolUseRec, tsMs: number): void
  onToolResult(agentId: string, r: ToolResultRec, tsMs: number): void
  /** Sorted by numeric id; TodoWrite list only when no Task* op was ever seen. */
  tasks(): SharedTask[]
}

type RawStatus = 'pending' | 'in_progress' | 'done'

interface Entry {
  id: number
  title: string
  description?: string
  status: RawStatus
  owner: string
  ownerExplicit: boolean
  blockedBy: number[]
  failingCount: number
}

interface PendingCreate {
  agentId: string
  subject: string
  description?: string
}

const rawStatus = (s: string | undefined): RawStatus | 'deleted' | undefined => {
  switch (s) {
    case 'completed':
      return 'done'
    case 'deleted':
      return 'deleted'
    case 'in_progress':
      return 'in_progress'
    case 'pending':
      return 'pending'
    default:
      return undefined
  }
}

const toId = (s: string): number | undefined => {
  const n = Number(s)
  return s.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : undefined
}

export function createTaskTracker(): TaskTracker {
  const entries = new Map<number, Entry>()
  const pendingCreates = new Map<string, PendingCreate>()
  let seenTaskOp = false
  let todos: { content: string; status: string; agentId: string }[] = []

  const ids = (list: string[] | undefined): number[] => {
    const out: number[] = []
    for (const s of list ?? []) {
      const n = toId(s)
      if (n !== undefined && !out.includes(n)) out.push(n)
    }
    return out
  }

  function onToolUse(agentId: string, u: ToolUseRec, _tsMs: number): void {
    const t = u.task
    if (!t) return
    switch (t.op) {
      case 'create':
        seenTaskOp = true
        pendingCreates.set(u.id, { agentId, subject: t.subject, ...(t.description !== undefined ? { description: t.description } : {}) })
        return
      case 'list':
        seenTaskOp = true
        return
      case 'todo':
        todos = t.todos.map((x) => ({ ...x, agentId }))
        return
      case 'update': {
        seenTaskOp = true
        const id = toId(t.taskId)
        const e = id === undefined ? undefined : entries.get(id)
        if (!e) return
        if (t.subject !== undefined) e.title = t.subject
        if (t.addBlockedBy) for (const b of ids(t.addBlockedBy)) if (!e.blockedBy.includes(b)) e.blockedBy.push(b)
        if (t.owner !== undefined) {
          e.owner = t.owner
          e.ownerExplicit = true
        }
        const st = rawStatus(t.status)
        if (st === 'deleted') entries.delete(e.id)
        else if (st !== undefined) {
          if (st === 'in_progress' && e.status !== 'in_progress') {
            e.failingCount = 0
            if (!e.ownerExplicit) e.owner = agentId
          }
          e.status = st
          if (st === 'done') e.failingCount = 0
        }
        return
      }
    }
  }

  function applyList(list: NonNullable<NonNullable<ToolResultRec['task']>['list']>): void {
    for (const item of list) {
      const id = toId(item.id)
      if (id === undefined) continue
      const st = rawStatus(item.status)
      if (st === 'deleted') {
        entries.delete(id)
        continue
      }
      let e = entries.get(id)
      if (!e) {
        e = { id, title: item.subject, status: 'pending', owner: '', ownerExplicit: false, blockedBy: [], failingCount: 0 }
        entries.set(id, e)
      }
      e.title = item.subject || e.title
      const next = st ?? 'pending'
      if (next !== 'in_progress') e.failingCount = 0
      e.status = next
      if (item.owner !== undefined) {
        e.owner = item.owner
        e.ownerExplicit = true
      }
      e.blockedBy = ids(item.blockedBy)
    }
  }

  function onToolResult(agentId: string, r: ToolResultRec, _tsMs: number): void {
    const pc = pendingCreates.get(r.toolUseId)
    if (pc) {
      pendingCreates.delete(r.toolUseId)
      const id = r.task?.createdId !== undefined ? toId(r.task.createdId) : undefined
      if (id !== undefined && !r.isError) {
        entries.set(id, {
          id,
          title: pc.subject,
          ...(pc.description !== undefined ? { description: pc.description } : {}),
          status: 'pending',
          owner: pc.agentId,
          ownerExplicit: false,
          blockedBy: [],
          failingCount: 0
        })
      }
    }
    if (r.task?.list) {
      seenTaskOp = true
      applyList(r.task.list)
    }
    for (const e of entries.values()) {
      if (e.status !== 'in_progress' || e.owner !== agentId) continue
      e.failingCount = r.isError ? e.failingCount + 1 : 0
    }
  }

  function tasks(): SharedTask[] {
    if (!seenTaskOp) {
      return todos.map((t, i) => {
        const st = rawStatus(t.status)
        const state: SharedTaskState = st === 'done' ? 'done' : st === 'in_progress' ? 'in_progress' : 'pending'
        return { id: i + 1, title: t.content, state, ownerAgentId: t.agentId, source: 'todo' as const }
      })
    }
    const out: SharedTask[] = []
    for (const e of [...entries.values()].sort((a, b) => a.id - b.id)) {
      const open = e.blockedBy.filter((b) => {
        const x = entries.get(b)
        return x !== undefined && x.status !== 'done'
      })
      let state: SharedTaskState
      if (e.status === 'done') state = 'done'
      else if (open.length > 0) state = 'blocked'
      else if (e.status === 'in_progress' && e.failingCount > 0) state = 'failing'
      else state = e.status
      const t: SharedTask = { id: e.id, title: e.title, state, ownerAgentId: e.owner, source: 'task' }
      if (e.description !== undefined) t.description = e.description
      if (state === 'blocked') {
        t.blockedBy = open[0]!
        t.blockers = [...open]
      }
      if (state === 'failing') t.failingCount = e.failingCount
      out.push(t)
    }
    return out
  }

  return { onToolUse, onToolResult, tasks }
}
