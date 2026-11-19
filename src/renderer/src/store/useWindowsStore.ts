import { create } from 'zustand'
import type { WindowInfo, WindowSpec } from '@shared/types'

export interface WindowsState {
  list: WindowInfo[]
  /** Hydrates and subscribes; returns the unsubscribe. A missing api (tests, browser) leaves the list empty. */
  init(): () => void
  setList(list: WindowInfo[]): void
  /** Opens (or focuses) a secondary window. Nothing else happens: no session starts, nothing is sent. */
  open(spec: WindowSpec, at?: { x: number; y: number }): Promise<boolean>
  focus(id: number): void
}

export const useWindowsStore = create<WindowsState>((set) => ({
  list: [],
  init: () => {
    const api = window.api?.windows
    if (!api) return () => undefined
    void api
      .list()
      .then((l) => set({ list: l }))
      .catch(() => undefined)
    return api.onChanged((l) => set({ list: l }))
  },
  setList: (list) => set({ list }),
  open: async (spec, at) => {
    const api = window.api?.windows
    if (!api) return false
    try {
      const r = await api.open({ spec, ...(at ? { at } : {}) })
      return r.ok
    } catch {
      return false
    }
  },
  focus: (id) => {
    void window.api?.windows?.focus(id)
  }
}))
