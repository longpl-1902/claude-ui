import { useCallback, useEffect, useState } from 'react'

export const STORAGE_KEY = 'ac.panelWidths'
export const LEFT = { min: 180, max: 480, def: 240 }
export const RIGHT = { min: 280, max: 640, def: 360 }
export const CENTER_MIN = 420
/** Combined width of the two splitter handles (6px each). */
export const SPLITTERS_W = 12

export interface PanelWidths {
  left: number
  right: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

function sanitize(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def
}

function load(): PanelWidths {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { left?: unknown; right?: unknown } | null
      if (p && typeof p === 'object') {
        return { left: sanitize(p.left, LEFT.def), right: sanitize(p.right, RIGHT.def) }
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return { left: LEFT.def, right: RIGHT.def }
}

function save(w: PanelWidths): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
  } catch {
    /* storage unavailable */
  }
}

/** Clamp both widths to their ranges and so that the center keeps CENTER_MIN. */
export function fitWidths(w: PanelWidths, viewport: number): PanelWidths {
  let left = clamp(w.left, LEFT.min, LEFT.max)
  let right = clamp(w.right, RIGHT.min, RIGHT.max)
  const avail = viewport - CENTER_MIN - SPLITTERS_W
  if (left + right > avail) {
    right = clamp(avail - left, RIGHT.min, RIGHT.max)
    if (left + right > avail) left = clamp(avail - right, LEFT.min, LEFT.max)
  }
  return { left, right }
}

export function usePanelWidths() {
  const [raw, setRaw] = useState<PanelWidths>(load)
  const [viewport, setViewport] = useState<number>(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { left, right } = fitWidths(raw, viewport)
  const avail = viewport - CENTER_MIN - SPLITTERS_W
  const leftMax = clamp(avail - right, LEFT.min, LEFT.max)
  const rightMax = clamp(avail - left, RIGHT.min, RIGHT.max)

  const setLeft = useCallback(
    (v: number) => {
      const next = { left: clamp(Math.round(v), LEFT.min, leftMax), right }
      setRaw(next)
      save(next)
    },
    [leftMax, right]
  )
  const setRight = useCallback(
    (v: number) => {
      const next = { left, right: clamp(Math.round(v), RIGHT.min, rightMax) }
      setRaw(next)
      save(next)
    },
    [rightMax, left]
  )

  return { left, right, leftMax, rightMax, setLeft, setRight }
}
