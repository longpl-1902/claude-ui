import { create } from 'zustand'
import type { ProjectStatus } from '@shared/types'
import { useAttentionStore } from './useAttentionStore'
import { deriveProjects, useConsoleStore } from './useConsoleStore'
import type { ConsoleState } from './useConsoleStore'

export const RAIL_KEY = 'ac.railExpanded'
export const IDLE_AFTER_MS = 24 * 3600 * 1000

function loadExpanded(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * Rail rows: the hub's projects, plus transcript projects the hub has not reported (zero counts), so the rail still
 * works when attention data is missing.
 */
export function mergeProjects(hub: readonly ProjectStatus[], sessions: ConsoleState['sessions']): ProjectStatus[] {
  const out = [...hub]
  const seen = new Set(out.map((p) => p.key))
  for (const g of deriveProjects(sessions)) {
    if (seen.has(g.key)) continue
    out.push({
      key: g.key,
      name: g.name,
      root: g.root,
      git: true,
      accountIds: [],
      mixedAccounts: false,
      liveSessions: g.liveCount,
      running: 0,
      waiting: 0,
      needsYou: 0,
      tokensToday: 0,
      lastActivityMs: g.lastActivityMs,
      hooksActive: false
    })
  }
  return out
}

/** Pinned projects in pin order, only those that exist. */
export function pinnedProjects(pins: readonly string[], projects: readonly ProjectStatus[]): ProjectStatus[] {
  const out: ProjectStatus[] = []
  for (const k of pins) {
    const p = projects.find((x) => x.key === k)
    if (p) out.push(p)
  }
  return out
}

export interface RailState {
  expanded: boolean
  idleOpen: boolean
  setExpanded(on: boolean): void
  toggleExpanded(): void
  toggleIdle(): void
  /** Ctrl+1..9: switch to the n-th pinned project (1-based, fixed pin order). Returns false when there is none. */
  goToPinned(n: number): boolean
}

export const useRailStore = create<RailState>((set, get) => ({
  expanded: loadExpanded(),
  idleOpen: false,
  setExpanded: (expanded) => {
    set({ expanded })
    try {
      window.localStorage.setItem(RAIL_KEY, String(expanded))
    } catch {
      /* storage unavailable */
    }
  },
  toggleExpanded: () => get().setExpanded(!get().expanded),
  toggleIdle: () => set({ idleOpen: !get().idleOpen }),
  goToPinned: (n) => {
    const all = mergeProjects(useAttentionStore.getState().snapshot.projects, useConsoleStore.getState().sessions)
    const target = pinnedProjects(useAttentionStore.getState().pins, all)[n - 1]
    if (!target) return false
    const c = useConsoleStore.getState()
    c.navigate('team')
    if (c.projectKey !== target.key) c.setProject(target.key)
    return true
  }
}))

export function resetRailStore(): void {
  useRailStore.setState({ expanded: true, idleOpen: false })
}
