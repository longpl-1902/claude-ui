import { useEffect } from 'react'
import { create } from 'zustand'
import { useConsoleStore } from './useConsoleStore'

export type CenterView = 'team' | 'chat'
export const CENTER_VIEW_KEY = 'ac.centerView'
const NO_PROJECT = '_'

function load(): Record<string, CenterView> {
  try {
    const raw = window.localStorage.getItem(CENTER_VIEW_KEY)
    if (raw) {
      const p = JSON.parse(raw) as unknown
      if (p && typeof p === 'object') {
        const out: Record<string, CenterView> = {}
        for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (v === 'chat' || v === 'team') out[k] = v
        return out
      }
    }
  } catch {
    /* defaults */
  }
  return {}
}

function save(v: Record<string, CenterView>): void {
  try {
    window.localStorage.setItem(CENTER_VIEW_KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

const currentKey = (): string => useConsoleStore.getState().projectKey ?? NO_PROJECT

export interface CenterViewState {
  /** Team/Chat choice per project key. */
  byProject: Record<string, CenterView>
  /** Lead console fills the center column (Team view only; not persisted). */
  consoleMaximized: boolean
  setView(v: CenterView, projectKey?: string): void
  /** Team <-> Chat for the current project (Ctrl+Shift+C). */
  toggle(): void
  setMaximized(on: boolean): void
  /** Ctrl+Shift+M */
  toggleMaximized(): void
}

export const useCenterViewStore = create<CenterViewState>((set, get) => ({
  byProject: load(),
  consoleMaximized: false,
  setView(v, projectKey) {
    const byProject = { ...get().byProject, [projectKey ?? currentKey()]: v }
    set({ byProject, consoleMaximized: false })
    save(byProject)
  },
  toggle() {
    const key = currentKey()
    get().setView((get().byProject[key] ?? 'team') === 'team' ? 'chat' : 'team', key)
  },
  setMaximized: (on) => set({ consoleMaximized: on }),
  toggleMaximized: () => set({ consoleMaximized: !get().consoleMaximized })
}))

/** The Team/Chat choice of the current project. */
export function useCenterView(): CenterView {
  const key = useConsoleStore((s) => s.projectKey) ?? NO_PROJECT
  return useCenterViewStore((s) => s.byProject[key]) ?? 'team'
}

/** Test helper. */
export function resetCenterViewStore(): void {
  useCenterViewStore.setState({ byProject: {}, consoleMaximized: false })
}

/**
 * Ctrl+Shift+C (Team/Chat) and Ctrl+Shift+M (maximize console). Bound here because the shortcut hook belongs to
 * T18; if that hook later binds them it must call the store actions and this effect should be dropped.
 */
export function useCenterViewShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.isComposing) return
      if (e.target instanceof HTMLElement && e.target.closest('.xterm')) return
      const k = e.key.toLowerCase()
      if (k === 'c') {
        e.preventDefault()
        useCenterViewStore.getState().toggle()
      } else if (k === 'm') {
        e.preventDefault()
        const st = useCenterViewStore.getState()
        if ((st.byProject[currentKey()] ?? 'team') === 'chat') return
        st.toggleMaximized()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
