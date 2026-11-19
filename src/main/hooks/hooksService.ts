import type { HookEvent, HooksPreview, HooksStatus, OkResult } from '../../shared/types'
import { buildHookEntry, hooksState, type createHookInstaller } from './hookInstaller'
import type { createHookServer } from './hookServer'

const THROTTLE_MS = 2000

export interface HooksServiceDeps {
  server: ReturnType<typeof createHookServer>
  installer: ReturnType<typeof createHookInstaller>
  resolveNode: () => string | null
  installScript: () => Promise<string>
  onHook: (e: HookEvent) => void
}

export function createHooksService(deps: HooksServiceDeps) {
  const listeners = new Set<(s: HooksStatus) => void>()
  const previewRoots = new Map<string, string>()
  let lastRoot: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  async function computeStatus(projectRoot: string | null): Promise<HooksStatus> {
    const stats = deps.server.stats()
    const base = {
      server: deps.server.info(),
      eventsReceived: stats.received,
      ...(stats.lastEventMs !== undefined ? { lastEventAt: new Date(stats.lastEventMs).toISOString() } : {})
    }
    if (projectRoot === null) return { projectRoot: null, settingsPath: null, state: 'unavailable', reason: 'no-project', ...base }
    const settingsPath = deps.installer.settingsPathFor(projectRoot)
    const unavailable = (reason: string, nodePath?: string): HooksStatus => ({
      projectRoot, settingsPath, state: 'unavailable', reason, ...(nodePath ? { nodePath } : {}), ...base
    })
    const nodePath = deps.resolveNode()
    if (!nodePath) return unavailable('node-not-found')
    const r = await deps.installer.read(projectRoot)
    if (r.error) return unavailable(r.error, nodePath)
    const scriptPath = await deps.installScript()
    return { projectRoot, settingsPath, state: hooksState(r.json, buildHookEntry(nodePath, scriptPath)), nodePath, ...base }
  }

  async function notifyFor(root: string | null): Promise<void> {
    if (listeners.size === 0) return
    let s: HooksStatus
    try {
      s = await computeStatus(root)
    } catch {
      return
    }
    for (const cb of [...listeners]) {
      try {
        cb(s)
      } catch {
        // a listener must not break the service
      }
    }
  }

  return {
    async start(): Promise<void> {
      await deps.server.start()
    },
    async stop(): Promise<void> {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await deps.server.stop()
    },
    async status(projectRoot: string | null): Promise<HooksStatus> {
      lastRoot = projectRoot
      return computeStatus(projectRoot)
    },
    async preview(projectRoot: string, action: 'install' | 'uninstall'): Promise<HooksPreview | OkResult> {
      lastRoot = projectRoot
      let entry = buildHookEntry('', '')
      let scriptPath = ''
      if (action === 'install') {
        const nodePath = deps.resolveNode()
        if (!nodePath) return { ok: false, reason: 'node-not-found' }
        scriptPath = await deps.installScript()
        entry = buildHookEntry(nodePath, scriptPath)
      }
      const p = await deps.installer.preview(projectRoot, action, entry, scriptPath)
      if ('previewId' in p) previewRoots.set(p.previewId, projectRoot)
      return p as HooksPreview | OkResult
    },
    async apply(previewId: string): Promise<OkResult> {
      const res = await deps.installer.apply(previewId)
      const root = previewRoots.get(previewId)
      previewRoots.delete(previewId)
      if (res.ok && root !== undefined) {
        lastRoot = root
        await notifyFor(root)
      }
      return res
    },
    onChanged(cb: (s: HooksStatus) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    // Target for the server's onEvent: forwards to onHook and tells listeners (throttled to one per 2 s) the counters moved.
    handleEvent(e: HookEvent): void {
      deps.onHook(e)
      if (timer || listeners.size === 0) return
      timer = setTimeout(() => {
        timer = null
        void notifyFor(lastRoot)
      }, THROTTLE_MS)
    }
  }
}
