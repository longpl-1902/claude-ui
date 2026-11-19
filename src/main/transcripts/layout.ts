import { join } from 'node:path'
import { normalizeForCompare } from '../accounts/paths'

const MAX_ENCODED = 200

export function encodeProjectDir(cwd: string): string {
  const enc = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return enc.length > MAX_ENCODED ? enc.slice(0, MAX_ENCODED) + '-' : enc
}

export function isEncodedTruncated(name: string): boolean {
  return name.length > MAX_ENCODED
}

export function sameProjectDir(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export const projectsRoot = (configDirAbs: string): string => join(configDirAbs, 'projects')
export const sessionsRegistryDir = (configDirAbs: string): string => join(configDirAbs, 'sessions')

export type TranscriptPathInfo =
  | { kind: 'main'; projectDir: string; sessionId: string }
  | { kind: 'subagent'; projectDir: string; sessionId: string; agentId: string; metaPath: string }
  | { kind: 'meta'; projectDir: string; sessionId: string; agentId: string }

export function classifyTranscriptPath(abs: string, projectsRootAbs: string): TranscriptPathInfo | null {
  const platform = process.platform
  const root = normalizeForCompare(projectsRootAbs, platform)
  const cmp = normalizeForCompare(abs, platform)
  if (!cmp.startsWith(root + '/')) return null
  // normalizeForCompare only lowercases (same length), so slice the original-case spelling
  const fwd = abs.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  const rel = fwd.slice(root.length + 1)
  const parts = rel.split('/')
  const projectDir = parts[0]
  if (!projectDir || parts.length < 2) return null
  const file = parts[parts.length - 1]!
  if (parts.length === 2) {
    const m = /^(.+)\.jsonl$/i.exec(file)
    return m ? { kind: 'main', projectDir, sessionId: m[1]! } : null
  }
  const sessionId = parts[1]!
  if (parts.length < 4 || parts[2] !== 'subagents') return null
  const sub = /^agent-(.+?)\.(jsonl|meta\.json)$/i.exec(file)
  if (!sub) return null
  const agentId = sub[1]!
  if (sub[2]!.toLowerCase() === 'jsonl') {
    const metaPath = abs.slice(0, abs.length - file.length) + `agent-${agentId}.meta.json`
    return { kind: 'subagent', projectDir, sessionId, agentId, metaPath }
  }
  return { kind: 'meta', projectDir, sessionId, agentId }
}

export interface RegistryEntry {
  pid: number
  sessionId: string
  cwd: string
  status?: 'busy' | 'idle' | 'waiting'
  waitingFor?: string
  startedAt?: number
  updatedAt?: number
  statusUpdatedAt?: number
  name?: string
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export function parseRegistryEntry(text: string): RegistryEntry | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const pid = num(o.pid)
  const sessionId = str(o.sessionId)
  if (pid === undefined || !sessionId) return null
  const e: RegistryEntry = { pid, sessionId, cwd: str(o.cwd) ?? '' }
  if (o.status === 'busy' || o.status === 'idle' || o.status === 'waiting') e.status = o.status
  const waitingFor = str(o.waitingFor)
  if (waitingFor !== undefined) e.waitingFor = waitingFor
  const startedAt = num(o.startedAt)
  if (startedAt !== undefined) e.startedAt = startedAt
  const updatedAt = num(o.updatedAt)
  if (updatedAt !== undefined) e.updatedAt = updatedAt
  const statusUpdatedAt = num(o.statusUpdatedAt)
  if (statusUpdatedAt !== undefined) e.statusUpdatedAt = statusUpdatedAt
  const name = str(o.name)
  if (name !== undefined) e.name = name
  return e
}
