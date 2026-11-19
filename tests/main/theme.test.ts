import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { THEME_IPC } from '../../src/shared/ipc'
import type { ThemeSource } from '../../src/shared/types'
import {
  accentFromWindows,
  createThemeController,
  isThemeSource,
  isWindows11,
  TITLE_BAR_HEIGHT,
  WINDOW_COLORS,
  type ThemeHost,
  type ThemeWindow
} from '../../src/main/theme'

function makeWin(over: Partial<ThemeWindow> = {}) {
  const win = {
    isDestroyed: () => false,
    setBackgroundColor: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    setBackgroundMaterial: vi.fn(),
    webContents: { isDestroyed: () => false, send: vi.fn() },
    ...over
  }
  return win
}

function makeHost(over: { dark?: boolean; platform?: string; osRelease?: string; accent?: string; source?: ThemeSource; high?: boolean } = {}) {
  const listeners: Record<string, () => void> = {}
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
  const wins = [makeWin()]
  let stored: ThemeSource = over.source ?? 'system'
  const nativeTheme = {
    shouldUseDarkColors: over.dark ?? true,
    shouldUseHighContrastColors: over.high ?? false,
    themeSource: 'system' as ThemeSource,
    on: vi.fn((ev: string, cb: () => void) => {
      listeners[ev] = cb
    })
  }
  const host: ThemeHost = {
    nativeTheme,
    systemPreferences: {
      getAccentColor: () => over.accent ?? '0078D4FF',
      on: vi.fn((ev: string, cb: () => void) => {
        listeners[ev] = cb
      })
    },
    platform: over.platform ?? 'win32',
    osRelease: over.osRelease ?? '10.0.22631',
    windows: () => wins,
    ipc: { handle: (c, f) => void handlers.set(c, f) },
    readSource: () => stored,
    writeSource: (s) => {
      stored = s
    }
  }
  return { host, nativeTheme, listeners, handlers, wins, stored: () => stored }
}

describe('theme helpers', () => {
  it('accentFromWindows turns RRGGBBAA into #RRGGBB and rejects junk', () => {
    expect(accentFromWindows('0078d4ff')).toBe('#0078D4')
    expect(accentFromWindows('#0078D4')).toBe('#0078D4')
    expect(accentFromWindows('0078D4')).toBe('#0078D4')
    expect(accentFromWindows('nope')).toBeNull()
    expect(accentFromWindows(false)).toBeNull()
    expect(accentFromWindows(undefined)).toBeNull()
  })
  it('isWindows11 needs win32 and build 22000+', () => {
    expect(isWindows11('win32', '10.0.22631')).toBe(true)
    expect(isWindows11('win32', '10.0.19045')).toBe(false)
    expect(isWindows11('linux', '10.0.22631')).toBe(false)
    expect(isWindows11('win32', 'garbage')).toBe(false)
  })
  it('isThemeSource', () => {
    expect(['system', 'light', 'dark'].every(isThemeSource)).toBe(true)
    expect(isThemeSource('blue')).toBe(false)
    expect(isThemeSource(undefined)).toBe(false)
  })
})

describe('createThemeController', () => {
  it('state follows nativeTheme and the Windows accent', () => {
    const { host } = makeHost({ dark: false, accent: '4cc2ffff' })
    const c = createThemeController(host)
    expect(c.state()).toEqual({ mode: 'light', accent: '#4CC2FF', highContrast: false })
  })

  it('has no accent off Windows and survives a throwing getAccentColor', () => {
    const { host } = makeHost({ platform: 'linux' })
    expect(createThemeController(host).state().accent).toBeNull()
    const h2 = makeHost()
    h2.host.systemPreferences.getAccentColor = () => {
      throw new Error('boom')
    }
    expect(createThemeController(h2.host).state().accent).toBeNull()
  })

  it('applies the stored source to nativeTheme at creation', () => {
    const { host, nativeTheme } = makeHost({ source: 'light' })
    createThemeController(host)
    expect(nativeTheme.themeSource).toBe('light')
  })

  it('window options give a per-theme background (no white flash) and a hidden title bar with overlay', () => {
    const d = createThemeController(makeHost({ dark: true }).host).windowOptions()
    const l = createThemeController(makeHost({ dark: false }).host).windowOptions()
    expect(d.backgroundColor).toBe(WINDOW_COLORS.dark.background)
    expect(l.backgroundColor).toBe(WINDOW_COLORS.light.background)
    for (const o of [d, l]) {
      expect(o.titleBarStyle).toBe('hidden')
      expect(o.titleBarOverlay.height).toBe(TITLE_BAR_HEIGHT)
    }
    expect(d.titleBarOverlay.symbolColor).toBe(WINDOW_COLORS.dark.symbol)
    expect(l.titleBarOverlay).toEqual({ color: WINDOW_COLORS.light.overlay, symbolColor: WINDOW_COLORS.light.symbol, height: 36 })
  })

  it('the Windows theme / accent change pushes theme:changed and recolours the chrome', () => {
    const t = makeHost({ dark: true })
    const c = createThemeController(t.host)
    c.start()
    expect(t.nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function))
    t.nativeTheme.shouldUseDarkColors = false
    t.listeners['updated']!()
    const w = t.wins[0]!
    expect(w.setBackgroundColor).toHaveBeenLastCalledWith(WINDOW_COLORS.light.background)
    expect(w.setTitleBarOverlay).toHaveBeenLastCalledWith({
      color: WINDOW_COLORS.light.overlay,
      symbolColor: WINDOW_COLORS.light.symbol,
      height: 36
    })
    expect(w.webContents.send).toHaveBeenLastCalledWith(THEME_IPC.changed, { mode: 'light', accent: '#0078D4', highContrast: false })
    t.listeners['accent-color-changed']!()
    expect(w.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('high contrast is forwarded', () => {
    const t = makeHost({ high: true })
    const c = createThemeController(t.host)
    c.start()
    t.listeners['updated']!()
    expect(t.wins[0]!.webContents.send).toHaveBeenCalledWith(THEME_IPC.changed, expect.objectContaining({ highContrast: true }))
  })

  it('skips destroyed windows', () => {
    const t = makeHost()
    const dead = makeWin({ isDestroyed: () => true })
    t.wins.push(dead)
    createThemeController(t.host).start()
    t.listeners['updated']!()
    expect(dead.setBackgroundColor).not.toHaveBeenCalled()
    expect(dead.webContents.send).not.toHaveBeenCalled()
  })

  it('theme:get and theme:set-source are handled; set-source persists, switches nativeTheme and pushes', async () => {
    const t = makeHost({ dark: true })
    createThemeController(t.host).start()
    expect(await t.handlers.get(THEME_IPC.get)!({})).toEqual({ mode: 'dark', accent: '#0078D4', highContrast: false })
    t.nativeTheme.shouldUseDarkColors = false // what Electron does once themeSource is 'light'
    const res = await t.handlers.get(THEME_IPC.setSource)!({}, 'light')
    expect(t.nativeTheme.themeSource).toBe('light')
    expect(t.stored()).toBe('light')
    expect(res).toMatchObject({ mode: 'light' })
    expect(t.wins[0]!.webContents.send).toHaveBeenCalledWith(THEME_IPC.changed, expect.objectContaining({ mode: 'light' }))
  })

  it('theme:set-source rejects anything but system/light/dark', () => {
    const t = makeHost()
    createThemeController(t.host).start()
    for (const bad of ['blue', 1, null, undefined, {}]) expect(() => t.handlers.get(THEME_IPC.setSource)!({}, bad)).toThrow()
    expect(t.nativeTheme.themeSource).toBe('system')
  })

  describe('Mica', () => {
    it('is enabled on Windows 11', () => {
      const t = makeHost({ osRelease: '10.0.26100' })
      createThemeController(t.host).applyToWindow(t.wins[0]!)
      expect(t.wins[0]!.setBackgroundMaterial).toHaveBeenCalledWith('mica')
    })
    it('is skipped on Windows 10 and elsewhere', () => {
      for (const o of [{ osRelease: '10.0.19045' }, { platform: 'linux' }]) {
        const t = makeHost(o)
        createThemeController(t.host).applyToWindow(t.wins[0]!)
        expect(t.wins[0]!.setBackgroundMaterial).not.toHaveBeenCalled()
      }
    })
    it('falls back silently when unsupported or throwing', () => {
      const t = makeHost()
      const throwing = makeWin({
        setBackgroundMaterial: () => {
          throw new Error('unsupported')
        }
      })
      const missing = makeWin({ setBackgroundMaterial: undefined, setTitleBarOverlay: undefined })
      const c = createThemeController(t.host)
      expect(() => c.applyToWindow(throwing)).not.toThrow()
      expect(() => c.applyToWindow(missing)).not.toThrow()
      expect(throwing.setBackgroundColor).toHaveBeenCalled()
    })
  })
})

describe('main window wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf8').replace(/\/\/.*$/gm, '')
  it('uses the theme controller for the window chrome instead of a fixed colour', () => {
    expect(src).toMatch(/\.\.\.theme\?\.windowOptions\(\)/)
    expect(src).not.toMatch(/backgroundColor:\s*'#/)
    expect(src).toMatch(/theme\?\.applyToWindow\(win\)/)
    expect(src).toMatch(/theme\.start\(\)/)
  })
})
