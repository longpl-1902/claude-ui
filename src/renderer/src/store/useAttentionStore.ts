import { create } from 'zustand'
import type { AttentionItem, AttentionPrefs, AttentionSnapshot } from '@shared/types'
import { useConsoleStore } from './useConsoleStore'

export const PINS_KEY = 'ac.pinnedProjects'

const EMPTY_SNAPSHOT: AttentionSnapshot = { items: [], projects: [], updatedAt: '' }
const DEFAULT_PREFS: AttentionPrefs = { mutedProjects: [], dnd: false, notifyErrors: false }

function loadPins(): string[] {
  try {
    const raw = window.localStorage.getItem(PINS_KEY)
    const p = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function savePins(pins: string[]): void {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(pins))
  } catch {
    /* storage unavailable */
  }
}

/** Inbox order: blocked before idle, oldest first inside each group. */
export function sortItems(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'blocked' ? -1 : 1) ||
      a.sinceMs - b.sinceMs ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export interface AttentionStoreState {
  snapshot: AttentionSnapshot
  pins: string[]
  prefs: AttentionPrefs
  /** Last item jumped to; Ctrl+J continues from here. */
  focusedId: string | null
  /** Subscribes to main's pushes; returns the unsubscribe. Safe to call twice (second call is a no-op). */
  init(): () => void
  applySnapshot(s: AttentionSnapshot): void
  pin(key: string): void
  unpin(key: string): void
  mute(key: string, on: boolean): void
  setDnd(on: boolean): void
  /** Jump to an item from any screen: navigate('team'), project, session, agent. Never answers anything. */
  focusItem(id: string): Promise<void>
  /** Next / previous attention item in inbox order (wraps). */
  focusNext(): Promise<void>
  focusPrev(): Promise<void>
}

let initCount = 0
let teardown: (() => void) | null = null

export const useAttentionStore = create<AttentionStoreState>((set, get) => {
  const writePrefs = async (next: AttentionPrefs): Promise<void> => {
    set({ prefs: next })
    const api = window.api?.attention
    if (!api?.setPrefs) return
    try {
      const r = await api.setPrefs(next)
      if (!r.ok) set({ prefs: await api.getPrefs() })
    } catch {
      /* main unavailable: the optimistic value stays until the next resync */
    }
  }

  const step = async (dir: 1 | -1): Promise<void> => {
    const list = sortItems(get().snapshot.items)
    if (list.length === 0) return
    const i = list.findIndex((x) => x.id === get().focusedId)
    const next = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length
    const id = list[next]!.id
    // Main focuses the window that shows the item (a chat for that session, else its project, else main).
    const route = window.api?.attention?.focusItem
    if (route) {
      set({ focusedId: id })
      const r = await route(id).catch(() => null)
      if (r?.ok) return
    }
    await get().focusItem(id)
  }

  return {
    snapshot: EMPTY_SNAPSHOT,
    pins: loadPins(),
    prefs: DEFAULT_PREFS,
    focusedId: null,

    init: () => {
      initCount++
      if (initCount === 1) {
        const api = window.api?.attention
        const offs: (() => void)[] = []
        if (api) {
          void api.get?.().then((s) => get().applySnapshot(s), () => undefined)
          void api.getPrefs?.().then(
            (p) => {
              set({ prefs: p })
              pushViewed()
            },
            () => undefined
          )
          const c = api.onChanged?.((s) => get().applySnapshot(s))
          if (c) offs.push(c)
          const f = api.onFocus?.((e) => void get().focusItem(e.itemId))
          if (f) offs.push(f)
        }
        // Tell main which project is on screen (no toast for what you are already looking at).
        const unsub = useConsoleStore.subscribe((s, prev) => {
          if (s.projectKey !== prev.projectKey) pushViewed()
        })
        offs.push(unsub)
        teardown = () => offs.forEach((o) => o())
      }
      let done = false
      return () => {
        if (done) return
        done = true
        initCount = Math.max(0, initCount - 1)
        if (initCount === 0) {
          teardown?.()
          teardown = null
        }
      }
    },

    applySnapshot: (snapshot) => set({ snapshot }),

    pin: (key) => {
      if (get().pins.includes(key)) return
      const pins = [...get().pins, key]
      set({ pins })
      savePins(pins)
    },
    unpin: (key) => {
      const pins = get().pins.filter((k) => k !== key)
      set({ pins })
      savePins(pins)
    },
    mute: (key, on) => {
      const cur = get().prefs
      const rest = cur.mutedProjects.filter((k) => k !== key)
      void writePrefs({ ...cur, mutedProjects: on ? [...rest, key] : rest })
    },
    setDnd: (on) => void writePrefs({ ...get().prefs, dnd: on }),

    focusItem: async (id) => {
      const item = get().snapshot.items.find((x) => x.id === id)
      if (!item) return
      set({ focusedId: id })
      const c = useConsoleStore.getState()
      c.navigate('team') // F4: works from the Accounts screen too
      if (c.projectKey !== item.projectKey) c.setProject(item.projectKey)
      const sel = useConsoleStore.getState().selection
      const viewed =
        (sel.mode === 'session' && sel.accountId === item.accountId && sel.sessionId === item.sessionId) ||
        (useConsoleStore.getState().team.sessionId === item.sessionId &&
          useConsoleStore.getState().team.accountId === item.accountId)
      if (!viewed) await useConsoleStore.getState().selectSession({ mode: 'session', accountId: item.accountId, sessionId: item.sessionId })
      useConsoleStore.getState().selectAgent(item.agentId)
    },
    focusNext: () => step(1),
    focusPrev: () => step(-1)
  }

  function pushViewed(): void {
    const key = useConsoleStore.getState().projectKey
    const api = window.api?.attention
    if (key === null || !api?.setPrefs) return
    const cur = get().prefs
    if (cur.viewedProjectKey === key) return
    const next = { ...cur, viewedProjectKey: key }
    set({ prefs: next })
    void api.setPrefs(next)?.catch?.(() => undefined)
  }
})

/** Test helper. */
export function resetAttentionStore(): void {
  teardown?.()
  teardown = null
  initCount = 0
  useAttentionStore.setState({ snapshot: EMPTY_SNAPSHOT, pins: [], prefs: DEFAULT_PREFS, focusedId: null })
}
