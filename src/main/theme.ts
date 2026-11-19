import { THEME_IPC } from '../shared/ipc'
import type { ThemeSource, ThemeState } from '../shared/types'

/** Window chrome colours per theme. They mirror the app background / header tokens in styles/tokens.css. */
export const WINDOW_COLORS = {
  dark: { background: '#0E0F11', overlay: '#121417', symbol: '#E6E7EA' },
  light: { background: '#F3F4F7', overlay: '#FFFFFF', symbol: '#1A1D23' }
} as const

export const TITLE_BAR_HEIGHT = 36

export const isThemeSource = (v: unknown): v is ThemeSource => v === 'system' || v === 'light' || v === 'dark'

/** Windows returns the accent as RRGGBBAA hex (no '#'); keep RGB only. Anything else is "no accent". */
export function accentFromWindows(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(raw.trim())
  return m ? `#${m[1]!.toUpperCase()}` : null
}

/** Windows 11 is build 22000+ ("10.0.22631"). */
export function isWindows11(platform: string, osRelease: string): boolean {
  if (platform !== 'win32') return false
  const build = Number(osRelease.split('.')[2])
  return Number.isFinite(build) && build >= 22000
}

export interface ThemeWindow {
  isDestroyed(): boolean
  setBackgroundColor(color: string): void
  setTitleBarOverlay?(o: { color: string; symbolColor: string; height: number }): void
  setBackgroundMaterial?(m: 'auto' | 'none' | 'mica' | 'acrylic' | 'tabbed'): void
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void }
}

export interface ThemeHost {
  nativeTheme: {
    shouldUseDarkColors: boolean
    shouldUseHighContrastColors: boolean
    themeSource: ThemeSource
    on(event: 'updated', cb: () => void): unknown
  }
  systemPreferences: {
    getAccentColor?(): string
    on?(event: 'accent-color-changed', cb: () => void): unknown
  }
  platform: string
  osRelease: string
  windows(): ThemeWindow[]
  ipc: { handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void }
  readSource(): ThemeSource
  writeSource(s: ThemeSource): void
}

export interface ThemeController {
  state(): ThemeState
  /** BrowserWindow options: no white flash, hidden title bar with the native controls overlaid. */
  windowOptions(): {
    backgroundColor: string
    titleBarStyle: 'hidden'
    titleBarOverlay: { color: string; symbolColor: string; height: number }
  }
  /** Chrome colours + Mica for one window. Never throws. */
  applyToWindow(win: ThemeWindow): void
  setSource(s: ThemeSource): ThemeState
  /** Registers the IPC handlers and the live listeners. */
  start(): void
}

export function createThemeController(host: ThemeHost): ThemeController {
  host.nativeTheme.themeSource = host.readSource()

  const accent = (): string | null => {
    if (host.platform !== 'win32') return null
    try {
      return accentFromWindows(host.systemPreferences.getAccentColor?.())
    } catch {
      return null
    }
  }
  const state = (): ThemeState => ({
    mode: host.nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    accent: accent(),
    highContrast: host.nativeTheme.shouldUseHighContrastColors
  })
  const palette = (): { background: string; overlay: string; symbol: string } => WINDOW_COLORS[state().mode]

  const applyToWindow = (win: ThemeWindow): void => {
    if (win.isDestroyed()) return
    const c = palette()
    try {
      win.setBackgroundColor(c.background)
      win.setTitleBarOverlay?.({ color: c.overlay, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT })
    } catch {
      // overlay not available on this platform / window
    }
    if (isWindows11(host.platform, host.osRelease)) {
      try {
        win.setBackgroundMaterial?.('mica')
      } catch {
        // Mica unsupported: keep the solid background
      }
    }
  }

  const push = (): void => {
    const s = state()
    for (const w of host.windows()) {
      applyToWindow(w)
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(THEME_IPC.changed, s)
    }
  }

  const setSource = (s: ThemeSource): ThemeState => {
    host.nativeTheme.themeSource = s
    host.writeSource(s)
    push()
    return state()
  }

  return {
    state,
    windowOptions: () => {
      const c = palette()
      return {
        backgroundColor: c.background,
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: c.overlay, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT }
      }
    },
    applyToWindow,
    setSource,
    start() {
      host.nativeTheme.on('updated', push)
      host.systemPreferences.on?.('accent-color-changed', push)
      host.ipc.handle(THEME_IPC.get, () => state())
      host.ipc.handle(THEME_IPC.setSource, (_e, source) => {
        if (!isThemeSource(source)) return { ok: false, reason: 'invalid-args' }
        return setSource(source)
      })
    }
  }
}
