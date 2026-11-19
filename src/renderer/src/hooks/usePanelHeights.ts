import { useCallback, useEffect, useRef, useState } from 'react'

export const STORAGE_KEY = 'ac.panelHeights'

export type PaneKey = 'grid' | 'console' | 'worktrees' | 'inspectorTop'
export type PaneGroup = 'center' | 'left' | 'right'

/** Height of one splitter handle. */
export const HANDLE_H = 6
export const GRID_MIN = 120
export const CONSOLE_MIN = 120
export const CONSOLE_DEF = 240
export const TIMELINE_MIN = 60
export const WORKTREES_MIN = 80
/** Minimum for the shared-task pane below the worktrees. */
export const TASKS_MIN = 80
export const INSPECTOR_TOP_MIN = 120
export const INSPECTOR_TOP_DEF = 260
/** Minimum for the tab panel below the inspector top section. */
export const INSPECTOR_TABS_MIN = 120

const KEYS: PaneKey[] = ['grid', 'console', 'worktrees', 'inspectorTop']
type Raw = Partial<Record<PaneKey, number>>
type Heights = Record<PaneGroup, number>

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

function load(): Raw {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown> | null
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        const out: Raw = {}
        for (const k of KEYS) {
          const v = p[k]
          if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v)
        }
        return out
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return {}
}

function save(r: Raw): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r))
  } catch {
    /* storage unavailable */
  }
}

/** Default (unclamped) height of a pane for the container heights. */
function defOf(key: PaneKey, h: Heights): number {
  switch (key) {
    case 'grid':
      return Math.round(h.center * 0.45)
    case 'console':
      return CONSOLE_DEF
    case 'worktrees':
      return Math.round(h.left * 0.5)
    case 'inspectorTop':
      return INSPECTOR_TOP_DEF
  }
}

const MINS: Record<PaneKey, number> = {
  grid: GRID_MIN,
  console: CONSOLE_MIN,
  worktrees: WORKTREES_MIN,
  inspectorTop: INSPECTOR_TOP_MIN
}

/** Resolve every pane height so the other panes keep their minimums. */
export function fitHeights(raw: Raw, h: Heights): Record<PaneKey, number> {
  const get = (k: PaneKey): number => Math.round(raw[k] ?? defOf(k, h))
  const centerRoom = h.center - 2 * HANDLE_H - TIMELINE_MIN
  const consoleH = clamp(get('console'), CONSOLE_MIN, centerRoom - GRID_MIN)
  const grid = clamp(get('grid'), GRID_MIN, centerRoom - consoleH)
  const worktrees = clamp(get('worktrees'), WORKTREES_MIN, h.left - HANDLE_H - TASKS_MIN)
  const inspectorTop = clamp(get('inspectorTop'), INSPECTOR_TOP_MIN, h.right - HANDLE_H - INSPECTOR_TABS_MIN)
  return { grid, console: consoleH, worktrees, inspectorTop }
}

/** Upper limit for one pane given the current values of its siblings. */
function maxOf(key: PaneKey, v: Record<PaneKey, number>, h: Heights): number {
  const centerRoom = h.center - 2 * HANDLE_H - TIMELINE_MIN
  switch (key) {
    case 'grid':
      return Math.max(GRID_MIN, centerRoom - v.console)
    case 'console':
      return Math.max(CONSOLE_MIN, centerRoom - v.grid)
    case 'worktrees':
      return Math.max(WORKTREES_MIN, h.left - HANDLE_H - TASKS_MIN)
    case 'inspectorTop':
      return Math.max(INSPECTOR_TOP_MIN, h.right - HANDLE_H - INSPECTOR_TABS_MIN)
  }
}

/**
 * Persisted pane heights (px) for the stacked panes of the three team columns.
 * `bind(group)` returns a ref callback that measures the container; without
 * ResizeObserver (jsdom), or when `observe` is false, window.innerHeight is used.
 */
export function usePanelHeights(observe = true) {
  const [raw, setRaw] = useState<Raw>(load)
  const [viewport, setViewport] = useState<number>(() => window.innerHeight)
  const [measured, setMeasured] = useState<Partial<Heights>>({})
  const observers = useRef<Partial<Record<PaneGroup, ResizeObserver>>>({})

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const setGroup = useCallback((group: PaneGroup, v: number | undefined) => {
    setMeasured((m) => (m[group] === v ? m : { ...m, [group]: v }))
  }, [])

  const elements = useRef<Partial<Record<PaneGroup, HTMLElement>>>({})
  const callbacks = useRef<Partial<Record<PaneGroup, (el: HTMLElement | null) => void>>>({})

  const attach = useCallback(
    (group: PaneGroup, el: HTMLElement | undefined, on: boolean) => {
      observers.current[group]?.disconnect()
      delete observers.current[group]
      if (!el || !on || typeof ResizeObserver === 'undefined') {
        setGroup(group, undefined)
        return
      }
      const ro = new ResizeObserver((entries) => {
        const last = entries[entries.length - 1]
        if (!last) return
        const v = Math.round(last.contentRect.height)
        setGroup(group, v > 0 ? v : undefined)
      })
      ro.observe(el)
      observers.current[group] = ro
    },
    [setGroup]
  )

  // Re-evaluate every bound element when observing is switched on or off.
  useEffect(() => {
    for (const g of ['center', 'left', 'right'] as PaneGroup[]) attach(g, elements.current[g], observe)
  }, [observe, attach])

  /** Stable ref callback per group (a changing identity would re-run the ref every render). */
  const bind = (group: PaneGroup) =>
    (callbacks.current[group] ??= (el: HTMLElement | null) => {
      if (el === (elements.current[group] ?? null)) return
      if (el) elements.current[group] = el
      else delete elements.current[group]
      attach(group, el ?? undefined, observeRef.current)
    })
  const observeRef = useRef(observe)
  observeRef.current = observe

  useEffect(
    () => () => {
      for (const ro of Object.values(observers.current)) ro?.disconnect()
    },
    []
  )

  const h: Heights = {
    center: measured.center ?? viewport,
    left: measured.left ?? viewport,
    right: measured.right ?? viewport
  }
  const values = fitHeights(raw, h)

  const max = (key: PaneKey): number => maxOf(key, values, h)
  const def = (key: PaneKey): number => clamp(defOf(key, h), MINS[key], maxOf(key, values, h))
  const set = (key: PaneKey, v: number): void => {
    const next: Raw = { ...raw, [key]: clamp(Math.round(v), MINS[key], maxOf(key, values, h)) }
    setRaw(next)
    save(next)
  }

  return { values, max, set, def, bind }
}
