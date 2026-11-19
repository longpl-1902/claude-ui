import { parseWindowSpec, windowKey } from '../../shared/windowSpec'
import type { WindowSpec } from '../../shared/types'
import { clampZoom, type SavedPlacement } from './placement'

export interface WindowsFs {
  readText(path: string): Promise<string | null>
  writeTextAtomic(path: string, text: string): Promise<void>
}

export interface WindowsState {
  /** Placement per window key (main + every secondary ever opened, bounded). */
  placements: Record<string, SavedPlacement>
  /** Secondary windows open at the last save, in open order. */
  open: WindowSpec[]
  /** "Reopen windows on start" */
  reopenOnStart: boolean
}

export const EMPTY_STATE: WindowsState = { placements: {}, open: [], reopenOnStart: true }

/** Remembered placements of closed windows; the oldest are dropped past this. */
const MAX_PLACEMENTS = 40

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parsePlacement(v: unknown): SavedPlacement | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const b = o['bounds'] as Record<string, unknown> | undefined
  if (!b || !isNum(b['x']) || !isNum(b['y']) || !isNum(b['width']) || !isNum(b['height']) || b['width'] <= 0 || b['height'] <= 0) return null
  if (!isNum(o['displayId'])) return null
  return {
    displayId: o['displayId'],
    bounds: { x: b['x'], y: b['y'], width: b['width'], height: b['height'] },
    maximized: o['maximized'] === true,
    zoom: clampZoom(o['zoom'])
  }
}

/** Tolerant parse of windows.json: anything unusable is dropped, never thrown. */
export function parseWindowsState(text: string | null): WindowsState {
  if (text === null) return { ...EMPTY_STATE, placements: {}, open: [] }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const placements: Record<string, SavedPlacement> = {}
    const rawP = raw['placements']
    if (typeof rawP === 'object' && rawP !== null) {
      for (const [k, v] of Object.entries(rawP as Record<string, unknown>)) {
        const p = parsePlacement(v)
        if (p) placements[k] = p
      }
    }
    const open: WindowSpec[] = []
    if (Array.isArray(raw['open'])) {
      for (const v of raw['open']) {
        const s = parseWindowSpec(v)
        if (s && s.kind !== 'main' && !open.some((o) => windowKey(o) === windowKey(s))) open.push(s)
      }
    }
    return { placements, open, reopenOnStart: raw['reopenOnStart'] !== false }
  } catch {
    return { ...EMPTY_STATE, placements: {}, open: [] }
  }
}

export interface WindowsStore {
  load(): Promise<WindowsState>
  save(state: WindowsState): Promise<void>
}

/** Drops the oldest placements (insertion order) beyond the cap, never one of the keys in `keep`. */
export function trimPlacements(p: Record<string, SavedPlacement>, keep: ReadonlySet<string>): Record<string, SavedPlacement> {
  const keys = Object.keys(p)
  let extra = keys.length - MAX_PLACEMENTS
  const out = { ...p }
  for (const k of keys) {
    if (extra <= 0) break
    if (keep.has(k)) continue
    delete out[k]
    extra--
  }
  return out
}

export function createWindowsStore(filePath: string, fs: WindowsFs): WindowsStore {
  return {
    load: async () => parseWindowsState(await fs.readText(filePath).catch(() => null)),
    save: (state) => fs.writeTextAtomic(filePath, JSON.stringify(state))
  }
}
