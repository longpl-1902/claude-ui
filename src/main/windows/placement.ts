import type { WindowSpec } from '../../shared/types'

/** All numbers are DIP (device independent pixels), as Electron reports them, so mixed scale factors need no maths. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  workArea: Rect
  scaleFactor: number
}

export interface SavedPlacement {
  displayId: number
  bounds: Rect
  maximized: boolean
  zoom: number
}

export interface ResolvedPlacement {
  bounds: Rect
  displayId: number
  maximized: boolean
  zoom: number
}

export interface MinSize {
  width: number
  height: number
}

/** A window never gets bigger than this share of a work area when it has to be shrunk. */
export const SHRINK_TO = 0.9

export const MIN_SIZE: Record<WindowSpec['kind'], MinSize> = {
  main: { width: 900, height: 600 },
  project: { width: 900, height: 600 },
  chat: { width: 520, height: 480 }
}

const DEFAULT_SIZE: Record<WindowSpec['kind'], MinSize> = {
  main: { width: 1440, height: 900 },
  project: { width: 1280, height: 860 },
  chat: { width: 900, height: 800 }
}

export const clampZoom = (z: unknown): number => (typeof z === 'number' && Number.isFinite(z) ? Math.min(3, Math.max(0.5, z)) : 1)

const finiteRect = (r: Rect): boolean => [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n)) && r.width > 0 && r.height > 0

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Same size if it fits the work area, else 90 % of it. Never below `min` unless the work area itself is smaller. */
function fitSize(size: MinSize, work: Rect, min: MinSize): MinSize {
  const fit = (v: number, avail: number, lo: number): number => {
    const want = v > avail ? Math.floor(avail * SHRINK_TO) : v
    return Math.min(avail, Math.max(want, Math.min(lo, avail)))
  }
  return { width: fit(size.width, work.width, min.width), height: fit(size.height, work.height, min.height) }
}

function clampInto(r: Rect, work: Rect): Rect {
  const x = Math.min(Math.max(r.x, work.x), work.x + work.width - r.width)
  const y = Math.min(Math.max(r.y, work.y), work.y + work.height - r.height)
  return { x: Math.round(x), y: Math.round(y), width: r.width, height: r.height }
}

function centered(size: MinSize, work: Rect): Rect {
  return {
    x: Math.round(work.x + (work.width - size.width) / 2),
    y: Math.round(work.y + (work.height - size.height) / 2),
    width: size.width,
    height: size.height
  }
}

export const displayFor = (displays: readonly DisplayInfo[], id: number): DisplayInfo | undefined => displays.find((d) => d.id === id)

/**
 * Where a saved window goes now.
 * - saved display still exists: keep the bounds, clamp them into its work area (partly off-screen, resolution change);
 * - display gone (monitor unplugged): centre on the primary display, same size if it fits, else 90 %.
 */
export function resolvePlacement(
  saved: SavedPlacement,
  displays: readonly DisplayInfo[],
  primary: DisplayInfo,
  min: MinSize
): ResolvedPlacement {
  const base = { maximized: saved.maximized, zoom: clampZoom(saved.zoom) }
  const size = finiteRect(saved.bounds) ? { width: saved.bounds.width, height: saved.bounds.height } : DEFAULT_SIZE.main
  const own = displayFor(displays, saved.displayId)
  if (!own || !finiteRect(saved.bounds)) {
    const s = fitSize(size, primary.workArea, min)
    return { ...base, bounds: centered(s, primary.workArea), displayId: primary.id }
  }
  const s = fitSize(size, own.workArea, min)
  const r = clampInto({ x: saved.bounds.x, y: saved.bounds.y, ...s }, own.workArea)
  return { ...base, bounds: r, displayId: own.id }
}

/** Display holding most of the rect, else the nearest one by centre distance, else primary. */
export function displayMatching(rect: Rect, displays: readonly DisplayInfo[], primary: DisplayInfo): DisplayInfo {
  let best: DisplayInfo | undefined
  let bestArea = 0
  for (const d of displays) {
    const a = overlapArea(rect, d.workArea)
    if (a > bestArea) {
      best = d
      bestArea = a
    }
  }
  if (best) return best
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  let nearest = primary
  let dist = Infinity
  for (const d of displays) {
    const dx = d.workArea.x + d.workArea.width / 2 - cx
    const dy = d.workArea.y + d.workArea.height / 2 - cy
    const dd = dx * dx + dy * dy
    if (dd < dist) {
      nearest = d
      dist = dd
    }
  }
  return nearest
}

export interface DefaultPlacementOpts {
  spec: WindowSpec
  displays: readonly DisplayInfo[]
  primary: DisplayInfo
  /** Display of the window that asked for this one. */
  anchorDisplayId?: number
  /** Drop point (DIP); the window opens on that display, centred on the point when it fits. */
  at?: { x: number; y: number }
  /** Number of secondary windows already open, for a small cascade when everything shares one display. */
  openCount?: number
}

/**
 * First placement of a window with no saved state. With a drop point: around it. Otherwise on another display than
 * the one of the requester when there is one (spread over both monitors), else cascaded on the same display.
 */
export function defaultPlacement(o: DefaultPlacementOpts): ResolvedPlacement {
  const min = MIN_SIZE[o.spec.kind]
  const wantSize = DEFAULT_SIZE[o.spec.kind]
  if (o.at) {
    const target =
      o.displays.find((d) => o.at!.x >= d.workArea.x && o.at!.x < d.workArea.x + d.workArea.width && o.at!.y >= d.workArea.y && o.at!.y < d.workArea.y + d.workArea.height) ??
      displayMatching({ x: o.at.x, y: o.at.y, width: 1, height: 1 }, o.displays, o.primary)
    const s = fitSize(wantSize, target.workArea, min)
    const r = clampInto({ x: o.at.x - s.width / 2, y: o.at.y - 20, ...s }, target.workArea)
    return { bounds: r, displayId: target.id, maximized: false, zoom: 1 }
  }
  const other = o.displays.find((d) => d.id !== o.anchorDisplayId)
  const target = other && o.anchorDisplayId !== undefined ? other : (displayFor(o.displays, o.anchorDisplayId ?? -1) ?? o.primary)
  const s = fitSize(wantSize, target.workArea, min)
  const c = centered(s, target.workArea)
  const n = other ? 0 : (o.openCount ?? 0) % 6
  const r = clampInto({ ...c, x: c.x + n * 32, y: c.y + n * 32 }, target.workArea)
  return { bounds: r, displayId: target.id, maximized: false, zoom: 1 }
}
