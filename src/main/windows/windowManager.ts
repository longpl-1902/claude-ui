import { WINDOW_IPC } from '../../shared/ipc'
import type { OkResult, WindowInfo, WindowOpenResult, WindowPrefs, WindowSpec } from '../../shared/types'
import { MAX_SECONDARY_WINDOWS, parseOpenRequest, windowKey } from '../../shared/windowSpec'
import { trimPlacements, type WindowsState, type WindowsStore } from './persistence'
import {
  clampZoom,
  defaultPlacement,
  displayMatching,
  MIN_SIZE,
  resolvePlacement,
  type DisplayInfo,
  type Rect,
  type ResolvedPlacement
} from './placement'

/** The slice of BrowserWindow the manager uses (a fake in tests). */
export interface ManagedWindow {
  id: number
  /** webContents.id: identifies the caller of an IPC invoke. */
  senderId: number
  isDestroyed(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  isFocused(): boolean
  show(): void
  focus(): void
  restore(): void
  close(): void
  getBounds(): Rect
  getNormalBounds(): Rect
  setBounds(r: Rect): void
  getZoom(): number
  send(channel: string, payload: unknown): void
  on(event: 'move' | 'resize' | 'maximize' | 'unmaximize' | 'focus' | 'close' | 'closed', cb: () => void): void
}

export interface ScreenLike {
  getAllDisplays(): DisplayInfo[]
  getPrimaryDisplay(): DisplayInfo
  on(event: 'display-added' | 'display-removed' | 'display-metrics-changed', cb: () => void): void
}

export interface WindowManagerDeps {
  /** Creates the BrowserWindow (theme options, preload, URL by spec) at the given placement. Must not start any session. */
  create(spec: WindowSpec, placement: ResolvedPlacement): ManagedWindow
  screen: ScreenLike
  store: WindowsStore
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(t: unknown): void
  ipc: { handle(channel: string, fn: (e: { sender: { id: number } }, ...args: unknown[]) => unknown): void }
  /** A window was closed (first thing in its 'closed' handler). Used to release per-window state. */
  onClosed?(w: ManagedWindow, spec: WindowSpec): void
}

export interface WindowManager {
  /** Loads windows.json, opens the main window and (if enabled) the secondary windows that were open at quit. */
  start(): Promise<void>
  open(req: unknown, fromWindowId?: number): WindowOpenResult
  list(): WindowInfo[]
  focus(id: number): OkResult
  /**
   * Focus the window that shows an item: a chat window for that exact session (`sessionRef` = `${accountId}|${sessionId}`),
   * else the project window, else the main window.
   */
  focusProject(projectKey: string, sessionRef?: string): ManagedWindow | undefined
  main(): ManagedWindow | undefined
  all(): ManagedWindow[]
  /** The app is quitting: remember what is open and stop treating closes as the user's choice. */
  beginQuit(): void
  registerIpc(): void
}

const SAVE_DELAY_MS = 400

interface Entry {
  spec: WindowSpec
  key: string
  win: ManagedWindow
  displayId: number
}

export function createWindowManager(deps: WindowManagerDeps): WindowManager {
  const entries: Entry[] = []
  let state: WindowsState = { placements: {}, open: [], reopenOnStart: true }
  let quitting = false
  let saveTimer: unknown = null

  const displays = (): DisplayInfo[] => deps.screen.getAllDisplays()
  const primary = (): DisplayInfo => deps.screen.getPrimaryDisplay()
  const live = (): Entry[] => entries.filter((e) => !e.win.isDestroyed())
  const secondaries = (): Entry[] => live().filter((e) => e.spec.kind !== 'main')

  const info = (): WindowInfo[] => live().map((e) => ({ id: e.win.id, key: e.key, spec: e.spec, focused: e.win.isFocused() }))

  const pushList = (): void => {
    const list = info()
    for (const e of live()) {
      try {
        e.win.send(WINDOW_IPC.changed, list)
      } catch {
        // window is going away
      }
    }
  }

  const remember = (e: Entry): void => {
    if (e.win.isMinimized()) return
    const maximized = e.win.isMaximized()
    e.displayId = displayMatching(e.win.getBounds(), displays(), primary()).id
    state.placements[e.key] = {
      displayId: e.displayId,
      bounds: maximized ? e.win.getNormalBounds() : e.win.getBounds(),
      maximized,
      zoom: clampZoom(e.win.getZoom())
    }
  }

  /** Writes the current placement of every live window into `state` (not to disk). */
  const capture = (): void => {
    for (const e of live()) remember(e)
    state.open = secondaries().map((e) => e.spec)
    state.placements = trimPlacements(state.placements, new Set(live().map((e) => e.key)))
  }

  const saveNow = (): void => {
    if (saveTimer !== null) {
      deps.clearTimer(saveTimer)
      saveTimer = null
    }
    capture()
    void deps.store.save(state).catch(() => undefined)
  }
  const scheduleSave = (): void => {
    if (quitting || saveTimer !== null) return
    saveTimer = deps.setTimer(() => {
      saveTimer = null
      saveNow()
    }, SAVE_DELAY_MS)
  }

  const reveal = (w: ManagedWindow): void => {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  function beginQuit(): void {
    if (quitting) return
    saveNow()
    quitting = true
    // Closing the main window ends the app; secondary windows follow. Sessions belong to the app, not to a window.
    for (const e of secondaries()) e.win.close()
  }

  const spawn = (spec: WindowSpec, placement: ResolvedPlacement): Entry => {
    const win = deps.create(spec, placement)
    const entry: Entry = { spec, key: windowKey(spec), win, displayId: placement.displayId }
    entries.push(entry)
    win.on('move', scheduleSave)
    win.on('resize', scheduleSave)
    win.on('maximize', scheduleSave)
    win.on('unmaximize', scheduleSave)
    win.on('focus', pushList)
    win.on('close', () => {
      if (spec.kind === 'main') {
        beginQuit()
        return
      }
      if (quitting) return
      try {
        remember(entry) // where it was; it is no longer "open" once closed
      } catch {
        // already destroyed
      }
    })
    win.on('closed', () => {
      try {
        deps.onClosed?.(win, spec)
      } catch {
        // a release hook must not break closing
      }
      const i = entries.indexOf(entry)
      if (i >= 0) entries.splice(i, 1)
      if (quitting) return
      state.open = secondaries().map((e) => e.spec)
      void deps.store.save(state).catch(() => undefined)
      pushList()
    })
    return entry
  }

  const placementFor = (spec: WindowSpec, at?: { x: number; y: number }, anchor?: Entry): ResolvedPlacement => {
    const saved = state.placements[windowKey(spec)]
    if (saved && !at) return resolvePlacement(saved, displays(), primary(), MIN_SIZE[spec.kind])
    return defaultPlacement({
      spec,
      displays: displays(),
      primary: primary(),
      ...(anchor ? { anchorDisplayId: anchor.displayId } : {}),
      ...(at ? { at } : {}),
      openCount: secondaries().length
    })
  }

  /** Window rescue: after a monitor is unplugged or a resolution / scale change, keep every window reachable. */
  const rescue = (): void => {
    const ds = displays()
    if (ds.length === 0) return
    for (const e of live()) {
      if (e.win.isMaximized() || e.win.isMinimized()) continue
      const cur = e.win.getBounds()
      const r = resolvePlacement({ displayId: e.displayId, bounds: cur, maximized: false, zoom: 1 }, ds, primary(), MIN_SIZE[e.spec.kind])
      e.displayId = r.displayId
      const b = r.bounds
      if (b.x !== cur.x || b.y !== cur.y || b.width !== cur.width || b.height !== cur.height) e.win.setBounds(b)
    }
    scheduleSave()
  }

  const open = (req: unknown, fromWindowId?: number): WindowOpenResult => {
    const r = parseOpenRequest(req)
    if (!r || r.spec.kind === 'main') return { ok: false, reason: 'invalid-args' }
    const key = windowKey(r.spec)
    const existing = live().find((e) => e.key === key)
    if (existing) {
      reveal(existing.win)
      return { ok: true, id: existing.win.id }
    }
    if (secondaries().length >= MAX_SECONDARY_WINDOWS) return { ok: false, reason: 'max-windows' }
    const anchor = fromWindowId === undefined ? undefined : live().find((e) => e.win.id === fromWindowId)
    const entry = spawn(r.spec, placementFor(r.spec, r.at, anchor))
    saveNow()
    pushList()
    return { ok: true, id: entry.win.id }
  }

  const focus = (id: unknown): OkResult => {
    if (typeof id !== 'number' || !Number.isInteger(id)) return { ok: false, reason: 'invalid-args' }
    const e = live().find((x) => x.win.id === id)
    if (!e) return { ok: false, reason: 'not-found' }
    reveal(e.win)
    return { ok: true }
  }

  return {
    async start() {
      state = await deps.store.load()
      spawn({ kind: 'main' }, placementFor({ kind: 'main' }))
      if (state.reopenOnStart) {
        for (const spec of state.open.slice(0, MAX_SECONDARY_WINDOWS)) spawn(spec, placementFor(spec))
      }
      deps.screen.on('display-removed', rescue)
      deps.screen.on('display-added', rescue)
      deps.screen.on('display-metrics-changed', rescue)
      pushList()
    },
    open,
    list: info,
    focus,
    focusProject(projectKey, sessionRef) {
      const target =
        (sessionRef !== undefined ? live().find((e) => e.spec.kind === 'chat' && e.spec.sessionRef === sessionRef) : undefined) ??
        live().find((e) => e.spec.kind === 'project' && e.spec.projectKey === projectKey) ??
        live().find((e) => e.spec.kind === 'main')
      if (target) reveal(target.win)
      return target?.win
    },
    main: () => live().find((e) => e.spec.kind === 'main')?.win,
    all: () => live().map((e) => e.win),
    beginQuit,
    registerIpc() {
      deps.ipc.handle(WINDOW_IPC.open, (e, req) => open(req, live().find((x) => x.win.senderId === e.sender.id)?.win.id))
      deps.ipc.handle(WINDOW_IPC.list, () => info())
      deps.ipc.handle(WINDOW_IPC.focus, (_e, id) => focus(id))
      deps.ipc.handle(WINDOW_IPC.getPrefs, (): WindowPrefs => ({ reopenOnStart: state.reopenOnStart }))
      deps.ipc.handle(WINDOW_IPC.setPrefs, (_e, p): OkResult => {
        if (typeof p !== 'object' || p === null || Array.isArray(p)) return { ok: false, reason: 'invalid-args' }
        const v = (p as { reopenOnStart?: unknown }).reopenOnStart
        if (typeof v !== 'boolean') return { ok: false, reason: 'invalid-args' }
        state.reopenOnStart = v
        saveNow()
        return { ok: true }
      })
      deps.ipc.handle(WINDOW_IPC.close, (e): OkResult => {
        const entry = live().find((x) => x.win.senderId === e.sender.id)
        if (!entry) return { ok: false, reason: 'not-found' }
        // The main window closes through the normal close button, never through this call.
        if (entry.spec.kind === 'main') return { ok: false, reason: 'main-window' }
        entry.win.close()
        return { ok: true }
      })
    }
  }
}
