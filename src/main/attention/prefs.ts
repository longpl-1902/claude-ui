import type { AttentionPrefs } from '../../shared/types'

export interface AttentionPrefsFs {
  /** null when the file does not exist */
  readText(path: string): Promise<string | null>
  writeTextAtomic(path: string, text: string): Promise<void>
  mkdirp(path: string): Promise<void>
}

export interface AttentionPrefsStore {
  load(): Promise<AttentionPrefs>
  save(p: AttentionPrefs): Promise<{ ok: boolean; reason?: string }>
  get(): AttentionPrefs
}

const MAX_MUTED = 200
const MAX_KEY = 1024

export const defaultAttentionPrefs = (): AttentionPrefs => ({ mutedProjects: [], dnd: false, notifyErrors: false, notifyIdle: false })

/** Strict validation; unknown keys are dropped. Returns null when the shape is wrong. */
export function validateAttentionPrefs(v: unknown): AttentionPrefs | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const muted = o.mutedProjects ?? []
  if (!Array.isArray(muted) || muted.length > MAX_MUTED) return null
  if (!muted.every((k) => typeof k === 'string' && k.length <= MAX_KEY)) return null
  const dnd = o.dnd ?? false
  const notifyErrors = o.notifyErrors ?? false
  const notifyIdle = o.notifyIdle ?? false
  if (typeof dnd !== 'boolean' || typeof notifyErrors !== 'boolean' || typeof notifyIdle !== 'boolean') return null
  const out: AttentionPrefs = { mutedProjects: [...(muted as string[])], dnd, notifyErrors, notifyIdle }
  if (o.viewedProjectKey !== undefined) {
    if (typeof o.viewedProjectKey !== 'string' || o.viewedProjectKey.length > MAX_KEY) return null
    out.viewedProjectKey = o.viewedProjectKey
  }
  return out
}

const dirOf = (p: string): string => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : '.'
}

export function createAttentionPrefs(deps: { filePath: string; fs: AttentionPrefsFs }): AttentionPrefsStore {
  let current = defaultAttentionPrefs()
  return {
    async load() {
      try {
        const text = await deps.fs.readText(deps.filePath)
        current = (text === null ? null : validateAttentionPrefs(JSON.parse(text))) ?? defaultAttentionPrefs()
      } catch {
        current = defaultAttentionPrefs()
      }
      return { ...current, mutedProjects: [...current.mutedProjects] }
    },
    async save(p) {
      const valid = validateAttentionPrefs(p)
      if (!valid) return { ok: false, reason: 'invalid' }
      try {
        await deps.fs.mkdirp(dirOf(deps.filePath))
        await deps.fs.writeTextAtomic(deps.filePath, JSON.stringify(valid, null, 2))
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'write-failed' }
      }
      current = valid
      return { ok: true }
    },
    get: () => ({ ...current, mutedProjects: [...current.mutedProjects] })
  }
}
