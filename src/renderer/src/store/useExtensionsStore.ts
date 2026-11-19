import { create } from 'zustand'
import type {
  CatalogItem,
  CliPreview,
  CliRunResult,
  McpAddRequest,
  McpConfigured,
  OkResult,
  PluginInfo
} from '@shared/types'

export interface McpState {
  servers: McpConfigured[]
  ranAt: string
  error?: string
}

type Api = NonNullable<Window['api']>
type Reload = { kind: 'mcp'; root: string; accountId: string } | { kind: 'plugins'; accountId: string }

export interface ExtensionsStoreState {
  catalog: CatalogItem[]
  mcp: McpState | null
  plugins: PluginInfo[]
  preview: CliPreview | null
  lastRun: CliRunResult | null
  loading: Record<string, boolean>
  error?: string
  loadCatalog(root: string | null, accountId: string): Promise<void>
  /** Explicit only: spawns `claude mcp list`. Never called automatically. */
  refreshMcp(root: string, accountId: string): Promise<void>
  loadPlugins(accountId: string): Promise<void>
  previewMcpAdd(req: McpAddRequest): Promise<CliPreview | OkResult>
  previewMcpRemove(
    root: string,
    accountId: string,
    name: string,
    scope: 'local' | 'user' | 'project' | null
  ): Promise<CliPreview | OkResult>
  previewPlugin(
    accountId: string,
    action: 'enable' | 'disable' | 'install' | 'uninstall',
    id: string
  ): Promise<CliPreview | OkResult>
  /** Runs the currently previewed command; only on explicit user confirm. */
  apply(): Promise<CliRunResult>
  clearPreview(): void
}

const NO_API: OkResult = { ok: false, reason: 'unavailable' }
const api = (): Api | undefined => (typeof window === 'undefined' ? undefined : window.api)
const isPreview = (r: CliPreview | OkResult): r is CliPreview => 'previewId' in r

// Context of the pending preview, so apply() knows what to reload.
let pendingReload: Reload | null = null

export const useExtensionsStore = create<ExtensionsStoreState>((set, get) => {
  const setLoading = (k: string, v: boolean): void => set((s) => ({ loading: { ...s.loading, [k]: v } }))

  async function guarded<T>(key: string, fn: (a: Api) => Promise<T>, fallback: T): Promise<T> {
    const a = api()
    if (!a) return fallback
    setLoading(key, true)
    try {
      return await fn(a)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return fallback
    } finally {
      setLoading(key, false)
    }
  }

  async function preview(
    key: string,
    reload: Reload,
    fn: (a: Api) => Promise<CliPreview | OkResult>
  ): Promise<CliPreview | OkResult> {
    const r = await guarded(key, fn, NO_API as CliPreview | OkResult)
    if (isPreview(r)) {
      pendingReload = reload
      set({ preview: r, lastRun: null })
    }
    return r
  }

  return {
    catalog: [],
    mcp: null,
    plugins: [],
    preview: null,
    lastRun: null,
    loading: {},

    async loadCatalog(root, accountId) {
      const items = await guarded('catalog', (a) => a.catalog.list(root, accountId), null)
      if (items) set({ catalog: items })
    },

    async refreshMcp(root, accountId) {
      const r = await guarded('mcp', (a) => a.mcp.list(root, accountId), null)
      if (r) set({ mcp: r })
    },

    async loadPlugins(accountId) {
      const r = await guarded('plugins', (a) => a.plugins.list(accountId), null)
      if (r) set({ plugins: r.plugins, ...(r.error ? { error: r.error } : {}) })
    },

    previewMcpAdd: (req) =>
      preview('preview', { kind: 'mcp', root: req.projectRoot, accountId: req.accountId }, (a) =>
        a.mcp.previewAdd(req)
      ),
    previewMcpRemove: (root, accountId, name, scope) =>
      preview('preview', { kind: 'mcp', root, accountId }, (a) => a.mcp.previewRemove(root, accountId, name, scope)),
    previewPlugin: (accountId, action, id) =>
      preview('preview', { kind: 'plugins', accountId }, (a) => a.plugins.preview(accountId, action, id)),

    async apply() {
      const p = get().preview
      if (!p) return { ok: false, reason: 'no-preview' }
      const res = await guarded(
        'apply',
        (a) => a.cli.apply(p.previewId),
        { ok: false, reason: 'unavailable' } as CliRunResult
      )
      set({ lastRun: res, preview: null })
      const reload = pendingReload
      pendingReload = null
      if (res.ok && reload) {
        if (reload.kind === 'plugins') await get().loadPlugins(reload.accountId)
        // mcp list is a CLI spawn: re-run only if the user already ran it in this view
        else if (get().mcp !== null) await get().refreshMcp(reload.root, reload.accountId)
      }
      return res
    },

    clearPreview() {
      pendingReload = null
      set({ preview: null })
    }
  }
})
