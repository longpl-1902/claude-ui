import { useEffect, useState } from 'react'
import { create } from 'zustand'

export const COLLAPSED_KEY = 'ac.collapsed'

interface Persisted {
  leftCollapsed: boolean
  rightCollapsed: boolean
}

function load(): Persisted {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown> | null
      if (p && typeof p === 'object') {
        return { leftCollapsed: p.leftCollapsed === true, rightCollapsed: p.rightCollapsed === true }
      }
    }
  } catch {
    /* defaults */
  }
  return { leftCollapsed: false, rightCollapsed: false }
}

function save(p: Persisted): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}

export interface LayoutState extends Persisted {
  toggleLeft(): void
  toggleRight(): void
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...load(),
  toggleLeft: () => {
    set({ leftCollapsed: !get().leftCollapsed })
    save({ leftCollapsed: get().leftCollapsed, rightCollapsed: get().rightCollapsed })
  },
  toggleRight: () => {
    set({ rightCollapsed: !get().rightCollapsed })
    save({ leftCollapsed: get().leftCollapsed, rightCollapsed: get().rightCollapsed })
  }
}))

/** Test helper: restore defaults without touching storage. */
export function resetLayoutStore(): void {
  useLayoutStore.setState({ leftCollapsed: false, rightCollapsed: false })
}

const matches = (maxWidth: number): boolean =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${maxWidth}px)`).matches
    : window.innerWidth <= maxWidth

/** True while the viewport is at most `maxWidth` px wide (matchMedia, else innerWidth). */
export function useMaxWidth(maxWidth: number): boolean {
  const [on, setOn] = useState(() => matches(maxWidth))
  useEffect(() => {
    const update = () => setOn(matches(maxWidth))
    update()
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${maxWidth}px)`) : null
    mql?.addEventListener?.('change', update)
    window.addEventListener('resize', update)
    return () => {
      mql?.removeEventListener?.('change', update)
      window.removeEventListener('resize', update)
    }
  }, [maxWidth])
  return on
}
