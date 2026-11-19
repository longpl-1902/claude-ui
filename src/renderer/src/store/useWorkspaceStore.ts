import { create } from 'zustand'
import { toWorktreeViews } from '@shared/overlap'
import type {
  Agent,
  FileDiff,
  FileOverlap,
  HooksPreview,
  HooksStatus,
  OkResult,
  WorkspaceSnapshot,
  Worktree
} from '@shared/types'

export interface CompareState {
  path: string
  diffs: FileDiff[]
  loading: boolean
  error?: string
}

export interface WorkspaceStoreState {
  workspace: WorkspaceSnapshot | null
  watchedRoot: string | null
  compare: CompareState | null
  hooks: HooksStatus | null
  hooksPreview: HooksPreview | null
  hooksError?: string
  init(): () => void
  watch(root: string | null): Promise<void>
  openCompare(path: string): Promise<void>
  closeCompare(): void
  refreshHooks(): Promise<void>
  previewHooks(action: 'install' | 'uninstall'): Promise<void>
  applyHooks(): Promise<OkResult>
  clearPreview(): void
}

const api = () => (typeof window === 'undefined' ? undefined : window.api)
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspace: null,
  watchedRoot: null,
  compare: null,
  hooks: null,
  hooksPreview: null,

  init() {
    const a = api()
    if (!a?.git || !a.hooks) return () => {}
    const offGit = a.git.onChanged((s) => {
      const root = get().watchedRoot
      if (root === null || s.root !== root) return
      set({ workspace: s })
    })
    const offHooks = a.hooks.onChanged((s) => {
      const root = get().watchedRoot
      if (root === null || s.projectRoot !== root) return
      set({ hooks: s })
    })
    return () => {
      offGit()
      offHooks()
    }
  },

  async watch(root) {
    if (root === get().watchedRoot) return
    set({ watchedRoot: root, workspace: null, compare: null, hooks: null, hooksPreview: null, hooksError: undefined })
    const a = api()
    if (!a?.git) return
    try {
      const snap = await a.git.watch(root)
      if (get().watchedRoot === root) set({ workspace: snap })
    } catch (e) {
      if (get().watchedRoot === root) set({ hooksError: msg(e) })
    }
    if (get().watchedRoot === root) await get().refreshHooks()
  },

  async openCompare(path) {
    const root = get().watchedRoot
    const a = api()
    if (!root || !a?.git) return
    set({ compare: { path, diffs: [], loading: true } })
    const still = () => get().compare?.path === path && get().watchedRoot === root
    try {
      const diffs = await a.git.compare(root, path)
      if (still()) set({ compare: { path, diffs, loading: false } })
    } catch (e) {
      if (still()) set({ compare: { path, diffs: [], loading: false, error: msg(e) } })
    }
  },
  closeCompare() {
    set({ compare: null })
  },

  async refreshHooks() {
    const a = api()
    if (!a?.hooks) return
    const root = get().watchedRoot
    try {
      const st = await a.hooks.status(root)
      if (get().watchedRoot === root) set({ hooks: st })
    } catch (e) {
      set({ hooksError: msg(e) })
    }
  },

  async previewHooks(action) {
    const root = get().watchedRoot
    const a = api()
    if (!root || !a?.hooks) return
    set({ hooksError: undefined })
    try {
      const r = await a.hooks.preview(root, action)
      if ('previewId' in r) set({ hooksPreview: r })
      else set({ hooksPreview: null, hooksError: r.reason ?? 'Could not prepare the preview' })
    } catch (e) {
      set({ hooksPreview: null, hooksError: msg(e) })
    }
  },

  async applyHooks() {
    const p = get().hooksPreview
    const a = api()
    if (!p || !a?.hooks) return { ok: false, reason: 'no-preview' }
    try {
      const r = await a.hooks.apply(p.previewId)
      if (r.ok) {
        set({ hooksPreview: null, hooksError: undefined })
        await get().refreshHooks()
      } else set({ hooksError: r.reason ?? 'Could not apply the change' })
      return r
    } catch (e) {
      set({ hooksError: msg(e) })
      return { ok: false, reason: msg(e) }
    }
  },

  clearPreview() {
    set({ hooksPreview: null })
  }
}))

type Views = { worktrees: Worktree[]; overlaps: FileOverlap[] }
const EMPTY: Views = { worktrees: [], overlaps: [] }
let memo: { ws: WorkspaceSnapshot; agents: Agent[]; platform: string; out: Views } | null = null

export function selectWorktreeViews(ws: WorkspaceSnapshot | null, agents: Agent[], platform: string): Views {
  if (!ws) return EMPTY
  if (memo && memo.ws === ws && memo.agents === agents && memo.platform === platform) return memo.out
  const out = toWorktreeViews(ws, agents, platform)
  memo = { ws, agents, platform, out }
  return out
}

/** Platform for agent -> worktree path mapping. */
export function rendererPlatform(): string {
  return typeof navigator !== 'undefined' && navigator.platform.startsWith('Win') ? 'win32' : 'linux'
}
