import { describe, expect, it } from 'vitest'
import { defaultPlacement, displayMatching, resolvePlacement, type DisplayInfo, type SavedPlacement } from '../../../src/main/windows/placement'

const big: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1400 }, scaleFactor: 1 }
// Second monitor sits to the right, 1920x1080 at 125 %: its DIP size is 1536x864.
const small: DisplayInfo = { id: 2, workArea: { x: 2560, y: 0, width: 1536, height: 830 }, scaleFactor: 1.25 }
const MIN = { width: 900, height: 600 }

const saved = (over: Partial<SavedPlacement> = {}): SavedPlacement => ({
  displayId: 2,
  bounds: { x: 2700, y: 40, width: 1200, height: 700 },
  maximized: false,
  zoom: 1,
  ...over
})

describe('resolvePlacement', () => {
  it('restores on the same display unchanged', () => {
    const r = resolvePlacement(saved(), [big, small], big, MIN)
    expect(r.displayId).toBe(2)
    expect(r.bounds).toEqual({ x: 2700, y: 40, width: 1200, height: 700 })
  })

  it('keeps maximized and zoom (zoom clamped)', () => {
    const r = resolvePlacement(saved({ maximized: true, zoom: 9 }), [big, small], big, MIN)
    expect(r.maximized).toBe(true)
    expect(r.zoom).toBe(3)
  })

  it('moves a window whose display is gone to the primary work area, keeping its size', () => {
    const r = resolvePlacement(saved(), [big], big, MIN)
    expect(r.displayId).toBe(1)
    expect(r.bounds.width).toBe(1200)
    expect(r.bounds.height).toBe(700)
    expect(r.bounds.x).toBeGreaterThanOrEqual(0)
    expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(2560)
  })

  it('shrinks to 90 % of the work area when the size does not fit', () => {
    const r = resolvePlacement(saved({ displayId: 9, bounds: { x: 3000, y: 0, width: 3000, height: 2000 } }), [big], big, MIN)
    expect(r.bounds.width).toBe(Math.floor(2560 * 0.9))
    expect(r.bounds.height).toBe(Math.floor(1400 * 0.9))
  })

  it('clamps a partially off-screen window into its display', () => {
    const r = resolvePlacement(saved({ bounds: { x: 3600, y: 600, width: 1200, height: 700 } }), [big, small], big, MIN)
    expect(r.displayId).toBe(2)
    expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(2560 + 1536)
    expect(r.bounds.y + r.bounds.height).toBeLessThanOrEqual(830)
    expect(r.bounds.x).toBeGreaterThanOrEqual(2560)
  })

  it('handles mixed scale factors: bounds stay in DIP and fit the DIP work area', () => {
    const r = resolvePlacement(saved({ bounds: { x: 2560, y: 0, width: 2000, height: 1000 } }), [big, small], big, MIN)
    expect(r.bounds.width).toBeLessThanOrEqual(1536)
    expect(r.bounds.height).toBeLessThanOrEqual(830)
  })

  it('falls back to the primary display for non-finite bounds', () => {
    const r = resolvePlacement(saved({ bounds: { x: NaN, y: 0, width: 100, height: 100 } }), [big, small], big, MIN)
    expect(r.displayId).toBe(1)
  })
})

describe('displayMatching / defaultPlacement', () => {
  it('picks the display with the largest overlap, else the nearest', () => {
    expect(displayMatching({ x: 2500, y: 0, width: 400, height: 300 }, [big, small], big).id).toBe(2)
    expect(displayMatching({ x: 9000, y: 0, width: 100, height: 100 }, [big, small], big).id).toBe(2)
  })

  it('opens on the OTHER display than the requester when there are two', () => {
    const r = defaultPlacement({ spec: { kind: 'project', projectKey: 'acme' }, displays: [big, small], primary: big, anchorDisplayId: 1 })
    expect(r.displayId).toBe(2)
    expect(r.bounds.width).toBeLessThanOrEqual(1536)
  })

  it('opens around a drop point on the display under it', () => {
    const r = defaultPlacement({
      spec: { kind: 'chat', projectKey: 'acme', sessionRef: 'a|s1' },
      displays: [big, small],
      primary: big,
      anchorDisplayId: 2,
      at: { x: 500, y: 300 }
    })
    expect(r.displayId).toBe(1)
    expect(r.bounds.x).toBeGreaterThanOrEqual(0)
  })

  it('cascades on a single display', () => {
    const a = defaultPlacement({ spec: { kind: 'project', projectKey: 'acme' }, displays: [big], primary: big, anchorDisplayId: 1, openCount: 0 })
    const b = defaultPlacement({ spec: { kind: 'project', projectKey: 'acme' }, displays: [big], primary: big, anchorDisplayId: 1, openCount: 1 })
    expect(b.bounds.x).toBe(a.bounds.x + 32)
  })
})
