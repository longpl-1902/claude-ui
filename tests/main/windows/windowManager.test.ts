import { describe, expect, it, vi } from 'vitest'
import { WINDOW_IPC } from '../../../src/shared/ipc'
import type { WindowSpec } from '../../../src/shared/types'
import { createWindowsStore, parseWindowsState, type WindowsState } from '../../../src/main/windows/persistence'
import type { DisplayInfo, Rect, ResolvedPlacement } from '../../../src/main/windows/placement'
import { createWindowManager, type ManagedWindow } from '../../../src/main/windows/windowManager'

const D1: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1400 }, scaleFactor: 1 }
const D2: DisplayInfo = { id: 2, workArea: { x: 2560, y: 0, width: 1536, height: 830 }, scaleFactor: 1.25 }

class FakeWin implements ManagedWindow {
  static next = 1
  id = FakeWin.next++
  senderId = this.id + 1000
  destroyed = false
  minimized = false
  maximized = false
  focused = false
  bounds: Rect
  listeners = new Map<string, Array<() => void>>()
  sent: Array<[string, unknown]> = []
  closeCalls = 0
  constructor(
    public spec: WindowSpec,
    public placement: ResolvedPlacement
  ) {
    this.bounds = { ...placement.bounds }
  }
  isDestroyed = () => this.destroyed
  isMinimized = () => this.minimized
  isMaximized = () => this.maximized
  isFocused = () => this.focused
  show = vi.fn()
  focus = vi.fn(() => {
    this.focused = true
  })
  restore = vi.fn(() => {
    this.minimized = false
  })
  close = () => {
    this.closeCalls++
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  }
  getBounds = () => ({ ...this.bounds })
  getNormalBounds = () => ({ ...this.bounds })
  setBounds = (r: Rect) => {
    this.bounds = { ...r }
  }
  getZoom = () => 1
  send = (c: string, p: unknown) => {
    this.sent.push([c, p])
  }
  on = (e: string, cb: () => void) => {
    this.listeners.set(e, [...(this.listeners.get(e) ?? []), cb])
  }
  emit(e: string) {
    for (const cb of this.listeners.get(e) ?? []) cb()
  }
}

function setup(initial: Partial<WindowsState> = {}, displays: DisplayInfo[] = [D1, D2]) {
  const wins: FakeWin[] = []
  const saved: WindowsState[] = []
  const closed: Array<{ senderId: number; spec: WindowSpec }> = []
  const handlers = new Map<string, (e: { sender: { id: number } }, ...a: unknown[]) => unknown>()
  const screenCbs = new Map<string, () => void>()
  const timers: Array<() => void> = []
  let current = displays
  const m = createWindowManager({
    create: (spec, placement) => {
      const w = new FakeWin(spec, placement)
      wins.push(w)
      return w
    },
    screen: {
      getAllDisplays: () => current,
      getPrimaryDisplay: () => current[0]!,
      on: (ev, cb) => {
        screenCbs.set(ev, cb)
      }
    },
    store: {
      load: async () => ({ placements: {}, open: [], reopenOnStart: true, ...initial }),
      save: async (s) => {
        saved.push(structuredClone(s))
      }
    },
    setTimer: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimer: () => undefined,
    ipc: { handle: (c, fn) => void handlers.set(c, fn) },
    onClosed: (w, spec) => void closed.push({ senderId: w.senderId, spec })
  })
  return { m, wins, saved, closed, handlers, screenCbs, timers, setDisplays: (d: DisplayInfo[]) => (current = d) }
}

const acme: WindowSpec = { kind: 'project', projectKey: 'c:/users/u/acme' }
const chat: WindowSpec = { kind: 'chat', projectKey: 'c:/users/u/acme', sessionRef: 'a1|s1' }

describe('windowManager', () => {
  it('opens the main window on start', async () => {
    const t = setup()
    await t.m.start()
    expect(t.wins).toHaveLength(1)
    expect(t.wins[0]!.spec).toEqual({ kind: 'main' })
  })

  it('opens a window, dedupes by key (focus instead of a second window) and rejects invalid input', async () => {
    const t = setup()
    await t.m.start()
    const a = t.m.open({ spec: acme })
    expect(a.ok).toBe(true)
    expect(t.wins).toHaveLength(2)
    const b = t.m.open({ spec: acme })
    expect(b).toEqual({ ok: true, id: a.id })
    expect(t.wins).toHaveLength(2)
    expect(t.wins[1]!.focus).toHaveBeenCalled()
    expect(t.m.open({ spec: { kind: 'chat', projectKey: 'x' } }).ok).toBe(false)
    expect(t.m.open({ spec: { kind: 'main' } }).ok).toBe(false)
    expect(t.m.open('nope').ok).toBe(false)
    expect(t.m.open({ spec: acme, at: { x: Infinity, y: 0 } }).ok).toBe(false)
  })

  it('restores a minimized duplicate before focusing', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    t.wins[1]!.minimized = true
    t.m.open({ spec: acme })
    expect(t.wins[1]!.restore).toHaveBeenCalled()
  })

  it('allows at most 8 secondary windows', async () => {
    const t = setup()
    await t.m.start()
    for (let i = 0; i < 8; i++) expect(t.m.open({ spec: { kind: 'project', projectKey: `p${i}` } }).ok).toBe(true)
    expect(t.m.open({ spec: { kind: 'project', projectKey: 'p9' } })).toEqual({ ok: false, reason: 'max-windows' })
    expect(t.m.list()).toHaveLength(9)
  })

  it('opens a new window on the other monitor than the requester', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme }, t.wins[0]!.id)
    expect(t.wins[1]!.placement.displayId).toBe(2)
  })

  it('persists open windows on open and close; closing a secondary leaves the main window alone', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: chat })
    expect(t.saved.at(-1)!.open).toEqual([chat])
    t.wins[1]!.close()
    expect(t.saved.at(-1)!.open).toEqual([])
    expect(t.wins[0]!.destroyed).toBe(false)
    expect(t.m.list()).toHaveLength(1)
  })

  it('saves placement (debounced) on move / resize', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    const n = t.saved.length
    t.wins[1]!.bounds = { x: 2600, y: 20, width: 1000, height: 700 }
    t.wins[1]!.emit('move')
    t.wins[1]!.emit('resize')
    expect(t.timers).toHaveLength(1) // coalesced
    t.timers[0]!()
    expect(t.saved.length).toBe(n + 1)
    expect(t.saved.at(-1)!.placements['project:c:/users/u/acme']).toMatchObject({ displayId: 2, bounds: { x: 2600, width: 1000 } })
  })

  it('reopens the secondary windows that were open at quit, at their saved display', async () => {
    const placements = {
      main: { displayId: 1, bounds: { x: 100, y: 100, width: 1400, height: 900 }, maximized: false, zoom: 1 },
      'chat:c:/users/u/acme:a1|s1': { displayId: 2, bounds: { x: 2700, y: 50, width: 900, height: 700 }, maximized: false, zoom: 1 }
    }
    const t = setup({ placements, open: [chat] })
    await t.m.start()
    expect(t.wins.map((w) => w.spec.kind)).toEqual(['main', 'chat'])
    expect(t.wins[0]!.placement.bounds).toMatchObject({ x: 100, width: 1400 })
    expect(t.wins[1]!.placement.displayId).toBe(2)
    expect(t.wins[1]!.placement.bounds).toMatchObject({ x: 2700, width: 900 })
  })

  it('does not reopen windows when "Reopen windows on start" is off', async () => {
    const t = setup({ open: [chat], reopenOnStart: false })
    await t.m.start()
    expect(t.wins).toHaveLength(1)
  })

  it('moves a saved window to the primary display when its monitor is gone at start', async () => {
    const placements = { 'project:c:/users/u/acme': { displayId: 2, bounds: { x: 2700, y: 50, width: 1200, height: 700 }, maximized: false, zoom: 1 } }
    const t = setup({ placements, open: [acme] }, [D1])
    await t.m.start()
    expect(t.wins[1]!.placement.displayId).toBe(1)
    expect(t.wins[1]!.placement.bounds.x).toBeLessThan(2560)
  })

  it('rescues windows live when a display is removed', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme }, t.wins[0]!.id)
    expect(t.wins[1]!.bounds.x).toBeGreaterThanOrEqual(2560)
    t.setDisplays([D1])
    t.screenCbs.get('display-removed')!()
    expect(t.wins[1]!.bounds.x).toBeLessThan(2560)
    expect(t.wins[1]!.bounds.x + t.wins[1]!.bounds.width).toBeLessThanOrEqual(2560)
  })

  it('closing the main window quits: saves what is open, then closes the secondaries', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    t.wins[0]!.close()
    expect(t.wins[1]!.closeCalls).toBe(1)
    expect(t.saved.at(-1)!.open).toEqual([acme])
  })

  it('beginQuit keeps the open list (windows closing at quit are not the user closing them)', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    t.m.beginQuit()
    expect(t.wins[1]!.destroyed).toBe(true)
    expect(t.saved.at(-1)!.open).toEqual([acme])
  })

  it('focusProject prefers the project window, else the main window', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    expect(t.m.focusProject('c:/users/u/acme')).toBe(t.wins[1])
    expect(t.m.focusProject('other')).toBe(t.wins[0])
  })

  it('pushes window:changed to every window on open', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    for (const w of t.wins) expect(w.sent.some(([c]) => c === WINDOW_IPC.changed)).toBe(true)
  })

  it('IPC: open validates, close closes only the calling secondary window, never main', async () => {
    const t = setup()
    await t.m.start()
    t.m.registerIpc()
    const open = t.handlers.get(WINDOW_IPC.open)!
    expect((open({ sender: { id: t.wins[0]!.senderId } }, { spec: { kind: 'bogus' } }) as { ok: boolean }).ok).toBe(false)
    expect((open({ sender: { id: t.wins[0]!.senderId } }, { spec: acme }) as { ok: boolean }).ok).toBe(true)
    const close = t.handlers.get(WINDOW_IPC.close)!
    expect(close({ sender: { id: t.wins[0]!.senderId } })).toEqual({ ok: false, reason: 'main-window' })
    expect(close({ sender: { id: 99999 } })).toEqual({ ok: false, reason: 'not-found' })
    expect(close({ sender: { id: t.wins[1]!.senderId } })).toEqual({ ok: true })
    expect(t.wins[1]!.destroyed).toBe(true)
    const focus = t.handlers.get(WINDOW_IPC.focus)!
    expect(focus({ sender: { id: 1 } }, 'x')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(focus({ sender: { id: 1 } }, t.wins[0]!.id)).toEqual({ ok: true })
    expect((t.handlers.get(WINDOW_IPC.list)!({ sender: { id: 1 } }) as unknown[]).length).toBe(1)
  })
})

describe('windowManager per-window selection support (T36)', () => {
  it('onClosed is called once with the closed secondary window and its spec', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: chat })
    const w = t.wins[1]!
    w.close()
    expect(t.closed).toEqual([{ senderId: w.senderId, spec: chat }])
  })

  it('focusProject prefers the chat window of that exact session, then the project window, then main', async () => {
    const t = setup()
    await t.m.start()
    t.m.open({ spec: acme })
    t.m.open({ spec: chat })
    const [main, proj, chatWin] = t.wins as [FakeWin, FakeWin, FakeWin]
    expect(t.m.focusProject(acme.projectKey, 'a1|s1')).toBe(chatWin)
    expect(t.m.focusProject(acme.projectKey, 'a1|other')).toBe(proj)
    expect(t.m.focusProject(acme.projectKey)).toBe(proj)
    expect(t.m.focusProject('c:/users/u/demo', 'a1|s1')).toBe(chatWin)
    expect(t.m.focusProject('c:/users/u/demo', 'x|y')).toBe(main)
  })

  it('window:get-prefs / window:set-prefs read, validate and persist reopenOnStart', async () => {
    const t = setup()
    await t.m.start()
    t.m.registerIpc()
    const call = (c: string, ...a: unknown[]) => t.handlers.get(c)!({ sender: { id: 1 } }, ...a)
    expect(call(WINDOW_IPC.getPrefs)).toEqual({ reopenOnStart: true })
    expect(call(WINDOW_IPC.setPrefs, { reopenOnStart: false })).toEqual({ ok: true })
    expect(t.saved.at(-1)!.reopenOnStart).toBe(false)
    expect(call(WINDOW_IPC.getPrefs)).toEqual({ reopenOnStart: false })
    for (const bad of [undefined, null, 'x', [], {}, { reopenOnStart: 'yes' }]) {
      expect(call(WINDOW_IPC.setPrefs, bad)).toEqual({ ok: false, reason: 'invalid-args' })
    }
    expect(call(WINDOW_IPC.getPrefs)).toEqual({ reopenOnStart: false })
  })
})

describe('persistence', () => {
  it('parses tolerantly: drops junk, main in open, and duplicates', () => {
    const s = parseWindowsState(
      JSON.stringify({
        placements: {
          a: { displayId: 1, bounds: { x: 0, y: 0, width: 10, height: 10 } },
          b: 'x',
          c: { displayId: 1, bounds: { x: 0, y: 0, width: -1, height: 1 } }
        },
        open: [{ kind: 'main' }, acme, acme, { kind: 'chat' }],
        reopenOnStart: false
      })
    )
    expect(Object.keys(s.placements)).toEqual(['a'])
    expect(s.open).toEqual([acme])
    expect(s.reopenOnStart).toBe(false)
    expect(parseWindowsState('{not json').open).toEqual([])
    expect(parseWindowsState(null).reopenOnStart).toBe(true)
  })

  it('round-trips through the fs adapter', async () => {
    const files = new Map<string, string>()
    const store = createWindowsStore('C:/Users/u/windows.json', {
      readText: async (p) => files.get(p) ?? null,
      writeTextAtomic: async (p, t) => void files.set(p, t)
    })
    await store.save({ placements: {}, open: [chat], reopenOnStart: true })
    expect((await store.load()).open).toEqual([chat])
  })
})
