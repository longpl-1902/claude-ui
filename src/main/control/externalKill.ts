import type { KillExternalRequest, OkResult } from '../../shared/types'

const ALLOWED_IMAGES = new Set(['claude', 'claude.exe', 'node', 'node.exe'])
const MAX_ID = 200

export interface ExternalKillDeps {
  readRegistry: () => Promise<{ accountId: string; entry: { pid: number; sessionId: string } }[]>
  isPidAlive: (pid: number) => boolean
  imageName: (pid: number) => Promise<string | null>
  killTree: (pid: number) => Promise<void>
  ownPids: () => number[]
}

const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID

// Guarded kill of an external Claude process. Every check runs at call time; any doubt refuses.
export function createExternalKiller(deps: ExternalKillDeps): { kill(req: KillExternalRequest): Promise<OkResult> } {
  return {
    async kill(req: KillExternalRequest): Promise<OkResult> {
      const r = req as Partial<KillExternalRequest> | null | undefined
      if (!r || typeof r !== 'object' || !validId(r.accountId) || !validId(r.sessionId) || typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0) {
        return { ok: false, reason: 'invalid-args' }
      }
      const { accountId, sessionId, pid } = r
      if (deps.ownPids().includes(pid)) return { ok: false, reason: 'app-owned' }
      let entries: Awaited<ReturnType<ExternalKillDeps['readRegistry']>>
      try {
        entries = await deps.readRegistry()
      } catch {
        return { ok: false, reason: 'not-registered' }
      }
      if (!entries.some((e) => e.accountId === accountId && e.entry.pid === pid && e.entry.sessionId === sessionId)) {
        return { ok: false, reason: 'not-registered' }
      }
      if (!deps.isPidAlive(pid)) return { ok: false, reason: 'not-running' }
      let image: string | null
      try {
        image = await deps.imageName(pid)
      } catch {
        image = null
      }
      if (image === null || !ALLOWED_IMAGES.has(image.toLowerCase())) return { ok: false, reason: 'unexpected-process' }
      try {
        await deps.killTree(pid)
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'kill-failed' }
      }
      return { ok: true }
    }
  }
}
