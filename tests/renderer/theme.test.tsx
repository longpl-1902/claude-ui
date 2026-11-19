// @vitest-environment jsdom
import './jestDom'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceRow } from '@renderer/components/accounts/AppearanceRow'
import { TerminalView } from '@renderer/components/terminal/TerminalView'
import { handleShortcut, SHORTCUTS } from '@renderer/hooks/useShortcuts'
import { PANEL_BG, resolveAccent } from '@renderer/theme/accent'
import { contrastRatio } from '@renderer/theme/contrast'
import { readXtermTheme } from '@renderer/theme/xtermTheme'
import { applyThemeToDocument, loadSource, THEME_KEY, useThemeStore } from '@renderer/theme/useThemeStore'
import type { ThemeState } from '@shared/types'

const rendererSrc = resolve(__dirname, '../../src/renderer/src')
const read = (rel: string): string => readFileSync(resolve(rendererSrc, rel), 'utf8')

// ---- token parsing -------------------------------------------------------------------------------------------

function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`no block ${selector}`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}
function parseTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--ac-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim()
  return out
}
const tokensCss = read('styles/tokens.css')
const dark = parseTokens(blockAfter(tokensCss, ':root {'))
const light = { ...dark, ...parseTokens(blockAfter(tokensCss, ":root[data-theme='light'] {")) }
const THEMES = { dark, light } as const

const BGS = ['app', 'panel', 'card', 'console', 'inset', 'btn', 'btn-hover', 'selected'].map((n) => `--ac-bg-${n}`)
const SURFACES = ['--ac-bg-app', '--ac-bg-panel', '--ac-bg-card']
const TEXTS = Object.keys(dark).filter((k) => /^--ac-text(-|$)/.test(k))
const STATUSES = ['running', 'waiting', 'needs-you', 'done']
const hex = (t: Record<string, string>, k: string): string => {
  const v = t[k]
  if (!v || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`${k} is not a #RRGGBB token: ${v}`)
  return v
}

describe('T31 token contrast (both themes)', () => {
  it('the dark block keeps the spec colours', () => {
    expect(dark['--ac-bg-app']).toBe('#0E0F11')
    expect(dark['--ac-accent']).toBe('#7AA7FF')
    expect(dark['--ac-status-needs-you']).toBe('#FF8A8A')
  })

  it('the light block overrides every dark colour token (same roles)', () => {
    const lightOnly = parseTokens(blockAfter(tokensCss, ":root[data-theme='light'] {"))
    const colourRole = (k: string): boolean => !/radius|font/.test(k)
    const missing = Object.keys(dark).filter((k) => colourRole(k) && !(k in lightOnly))
    expect(missing).toEqual([])
  })

  describe.each(Object.entries(THEMES))('%s theme', (_name, t) => {
    it('every text token is >= 4.5:1 on every background token', () => {
      const bad: string[] = []
      for (const tx of TEXTS)
        for (const bg of BGS) {
          const r = contrastRatio(hex(t, tx), hex(t, bg))
          if (r < 4.5) bad.push(`${tx} on ${bg}: ${r.toFixed(2)}`)
        }
      expect(bad).toEqual([])
    })

    it('status colours are >= 4.5:1 on their own tint and on the surfaces (they always sit next to a text label)', () => {
      const bad: string[] = []
      for (const s of STATUSES) {
        const fg = hex(t, `--ac-status-${s}`)
        for (const bg of [`--ac-status-${s}-bg`, ...SURFACES]) {
          const r = contrastRatio(fg, hex(t, bg))
          if (r < 4.5) bad.push(`${s} on ${bg}: ${r.toFixed(2)}`)
        }
        const on = contrastRatio(hex(t, '--ac-on-status'), fg)
        if (on < 4.5) bad.push(`on-status on ${s}: ${on.toFixed(2)}`)
      }
      expect(bad).toEqual([])
    })

    it('accent, danger, ok, tool and warning text pairs are >= 4.5:1', () => {
      const pairs: Array<[string, string]> = []
      for (const bg of [...SURFACES, '--ac-bg-btn', '--ac-bg-selected']) {
        for (const fg of ['--ac-accent', '--ac-accent-hover', '--ac-danger-text', '--ac-status-error', '--ac-ok-text'])
          pairs.push([fg, bg])
        for (const tool of Object.keys(t).filter((k) => k.startsWith('--ac-tool-'))) pairs.push([tool, bg])
      }
      pairs.push(['--ac-warn-text', '--ac-warn-bg'], ['--ac-badge-text', '--ac-badge-bg'], ['--ac-text', '--ac-chip-bg'])
      pairs.push(['--ac-on-accent', '--ac-accent'], ['--ac-on-accent', '--ac-accent-2'], ['--ac-on-accent', '--ac-accent-hover'])
      pairs.push(['--ac-on-warn', '--ac-warn-solid'], ['--ac-on-warn', '--ac-warn-solid-hover'])
      const bad = pairs
        .map(([fg, bg]) => [fg, bg, contrastRatio(hex(t, fg), hex(t, bg))] as const)
        .filter(([, , r]) => r < 4.5)
        .map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`)
      expect(bad).toEqual([])
    })

    it('UI graphics (accent, status, account stripes, key timeline segments) are >= 3:1 on the panel', () => {
      const names = [
        '--ac-accent',
        '--ac-accent-2',
        '--ac-status-running',
        '--ac-status-waiting',
        '--ac-status-needs-you',
        '--ac-status-done',
        '--ac-account-company',
        '--ac-account-personal',
        '--ac-account-fallback',
        '--ac-seg-edit',
        '--ac-seg-bash',
        '--ac-seg-error'
      ]
      const bad = names
        .map((n) => [n, contrastRatio(hex(t, n), hex(t, '--ac-bg-panel'))] as const)
        .filter(([, r]) => r < 3)
        .map(([n, r]) => `${n}: ${r.toFixed(2)}`)
      expect(bad).toEqual([])
    })

    it('terminal colours read on the terminal background', () => {
      const bg = hex(t, '--ac-term-bg')
      expect(contrastRatio(hex(t, '--ac-term-fg'), bg)).toBeGreaterThanOrEqual(4.5)
      const bad: string[] = []
      for (const c of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'bright-black'])
        for (const pre of c === 'bright-black' || c === 'white' ? [''] : ['', 'bright-']) {
          const name = `--ac-term-${pre}${c}`
          const r = contrastRatio(hex(t, name), bg)
          if (r < 3) bad.push(`${name}: ${r.toFixed(2)}`)
        }
      expect(bad).toEqual([])
    })
  })

  it('the accent module uses the real panel backgrounds', () => {
    expect(PANEL_BG.dark.toLowerCase()).toBe(dark['--ac-bg-panel']!.toLowerCase())
    expect(PANEL_BG.light.toLowerCase()).toBe(light['--ac-bg-panel']!.toLowerCase())
  })

  it('has a forced-colors block that maps tokens to system colours', () => {
    expect(tokensCss).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*--ac-text:\s*CanvasText/)
  })
})

// ---- no hard-coded colours --------------------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css|html)$/.test(e)) out.push(p)
  }
  return out
}

describe('T31 no hard-coded colours in the renderer', () => {
  const ALLOW = new Set(['styles/tokens.css', 'theme/accent.ts', 'theme/xtermTheme.ts', 'theme/contrast.ts'])
  const files = walk(rendererSrc).filter((f) => !ALLOW.has(relative(rendererSrc, f).replace(/\\/g, '/')))
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(60)
  })

  it('no hex / rgb / hsl literal outside tokens.css and the theme helpers', () => {
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (LITERAL.test(line.replace(/\/\/.*$/, ''))) hits.push(`${relative(rendererSrc, f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
        })
    }
    expect(hits).toEqual([])
  })

  it('the T29 control pieces use classes, not inline colour/spacing styles', () => {
    for (const f of ['ControlBar', 'ContextMeter', 'McpChips', 'RewindDialog']) {
      const src = read(`components/team/${f}.tsx`)
      const inline = (src.match(/style=\{\{[^}]*\}\}/g) ?? []).filter((s) => !/width:\s*`\$\{pct\}%`/.test(s))
      expect(inline, f).toEqual([])
    }
  })
})

// ---- global css: scrollbars, color-scheme, window chrome -----------------------------------------------------

describe('T31 global styles', () => {
  const globalCss = read('styles/global.css')

  it('declares color-scheme per theme', () => {
    expect(globalCss).toMatch(/:root\s*\{\s*color-scheme:\s*dark/)
    expect(globalCss).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme:\s*light/)
  })

  it('scrollbars are thin, rounded, arrow-less and take their colours from tokens', () => {
    expect(globalCss).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*8px[^}]*height:\s*8px/)
    expect(globalCss).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--ac-scroll-thumb\)[^}]*border-radius/)
    expect(globalCss).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--ac-scroll-thumb-hover\)/)
    expect(globalCss).toMatch(/::-webkit-scrollbar-thumb:active\s*\{[^}]*var\(--ac-scroll-thumb-active\)/)
    expect(globalCss).toMatch(/::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/)
    for (const t of [dark, light]) for (const n of ['', '-hover', '-active']) expect(t[`--ac-scroll-thumb${n}`]).toBeDefined()
  })

  it('the standard scrollbar properties are only a fallback (they would disable the webkit styling)', () => {
    expect(globalCss).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{[^}]*scrollbar-width:\s*thin/)
    expect(globalCss.replace(/@supports not selector[\s\S]*?\n\}\n/, '')).not.toMatch(/scrollbar-color/)
  })

  it('scrollbars respect forced colors', () => {
    expect(globalCss).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*::-webkit-scrollbar-thumb[\s\S]*CanvasText/)
  })

  it('the headers are the drag region and every interactive child is no-drag', () => {
    expect(globalCss).toMatch(/\.ac-header,\s*\.ac-acc-header,\s*\.ac-ext-header\s*\{[^}]*-webkit-app-region:\s*drag/)
    expect(globalCss).toMatch(/:is\(button, a, input, select, textarea[^)]*\)\s*\{\s*-webkit-app-region:\s*no-drag/)
    expect(globalCss).toMatch(/env\(titlebar-area-width/)
  })
})

// ---- store: theme push, persistence, accent -----------------------------------------------------------------------

type Win = { api?: unknown }
const setApi = (a: unknown): void => {
  ;(window as unknown as Win).api = a
}

function makeThemeApi(initial: ThemeState) {
  let cb: ((s: ThemeState) => void) | undefined
  const api = {
    theme: {
      get: vi.fn().mockResolvedValue(initial),
      setSource: vi.fn().mockResolvedValue(initial),
      onChanged: vi.fn((c: (s: ThemeState) => void) => {
        cb = c
        return vi.fn()
      })
    }
  }
  return { api, push: (s: ThemeState) => act(() => cb?.(s)) }
}

const root = document.documentElement
const reset = (): void => {
  window.localStorage.clear()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-contrast')
  root.removeAttribute('style')
  useThemeStore.setState({ source: 'system', system: null, mode: 'dark', accentApplied: null })
  setApi(undefined)
}

describe('T31 theme store', () => {
  beforeEach(reset)
  afterEach(reset)

  it('a theme push from the main process updates data-theme', () => {
    const { api, push } = makeThemeApi({ mode: 'dark', accent: null, highContrast: false })
    setApi(api)
    const off = useThemeStore.getState().init()
    expect(root.dataset['theme']).toBe('dark')
    push({ mode: 'light', accent: null, highContrast: false })
    expect(root.dataset['theme']).toBe('light')
    expect(useThemeStore.getState().mode).toBe('light')
    push({ mode: 'dark', accent: null, highContrast: false })
    expect(root.dataset['theme']).toBe('dark')
    off()
  })

  it('high contrast sets data-contrast and never applies a custom accent', () => {
    const { api, push } = makeThemeApi({ mode: 'dark', accent: null, highContrast: false })
    setApi(api)
    useThemeStore.getState().init()
    push({ mode: 'dark', accent: '#0078D4', highContrast: true })
    expect(root.dataset['contrast']).toBe('high')
    expect(root.style.getPropertyValue('--ac-accent')).toBe('')
    push({ mode: 'dark', accent: '#0078D4', highContrast: false })
    expect(root.dataset['contrast']).toBeUndefined()
  })

  it('uses the Windows accent when it reaches 3:1 against the panel', () => {
    const { api, push } = makeThemeApi({ mode: 'dark', accent: null, highContrast: false })
    setApi(api)
    useThemeStore.getState().init()
    push({ mode: 'dark', accent: '#4CC2FF', highContrast: false })
    expect(root.style.getPropertyValue('--ac-accent')).toBe('#4CC2FF')
    expect(root.style.getPropertyValue('--ac-on-accent')).toBe('#0E0F11')
    expect(useThemeStore.getState().accentApplied).toBe('#4CC2FF')
  })

  it('falls back to the default accent when the contrast is too low', () => {
    const { api, push } = makeThemeApi({ mode: 'dark', accent: null, highContrast: false })
    setApi(api)
    useThemeStore.getState().init()
    push({ mode: 'dark', accent: '#2B2B3A', highContrast: false })
    expect(root.style.getPropertyValue('--ac-accent')).toBe('')
    expect(useThemeStore.getState().accentApplied).toBeNull()
    // the same accent that fails on dark can pass on light, and a pale one fails on light
    push({ mode: 'light', accent: '#FFE066', highContrast: false })
    expect(root.style.getPropertyValue('--ac-accent')).toBe('')
    push({ mode: 'light', accent: '#0F4C81', highContrast: false })
    expect(root.style.getPropertyValue('--ac-accent')).toBe('#0F4C81')
    expect(root.style.getPropertyValue('--ac-on-accent')).toBe('#FFFFFF')
  })

  it('resolveAccent: 3:1 threshold, readable text colour, rejects bad input', () => {
    expect(resolveAccent('#0078D4', 'light')).not.toBeNull()
    expect(resolveAccent('#1A1A1A', 'dark')).toBeNull()
    expect(resolveAccent(null, 'dark')).toBeNull()
    expect(resolveAccent('red', 'dark')).toBeNull()
    for (const [c, m] of [
      ['#0078D4', 'light'],
      ['#4CC2FF', 'dark'],
      ['#7A3FF2', 'dark'],
      ['#E81123', 'light']
    ] as const) {
      const a = resolveAccent(c, m)
      if (a) expect(contrastRatio(a.accent, a.onAccent)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a persisted Light/Dark override beats the system theme and survives a reload', () => {
    const { api, push } = makeThemeApi({ mode: 'dark', accent: null, highContrast: false })
    setApi(api)
    useThemeStore.getState().init()
    useThemeStore.getState().setSource('light')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light')
    expect(root.dataset['theme']).toBe('light')
    expect(api.theme.setSource).toHaveBeenCalledWith('light')
    push({ mode: 'dark', accent: null, highContrast: false }) // Windows is dark; the override stays light
    expect(root.dataset['theme']).toBe('light')
    expect(loadSource()).toBe('light')
    useThemeStore.getState().setSource('system')
    expect(root.dataset['theme']).toBe('dark') // back to following Windows
    expect(window.localStorage.getItem(THEME_KEY)).toBe('system')
  })

  it('cycles System, Light, Dark with Ctrl+Shift+L, which is listed in the shortcuts help', () => {
    expect(SHORTCUTS.some((s) => s.keys === 'Ctrl+Shift+L')).toBe(true)
    const press = (): boolean => handleShortcut(new KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true, cancelable: true }))
    expect(press()).toBe(true)
    expect(useThemeStore.getState().source).toBe('light')
    press()
    expect(useThemeStore.getState().source).toBe('dark')
    press()
    expect(useThemeStore.getState().source).toBe('system')
  })

  it('works without window.api and with unavailable storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => useThemeStore.getState().setSource('dark')).not.toThrow()
    expect(root.dataset['theme']).toBe('dark')
    spy.mockRestore()
  })

  it('applyThemeToDocument clears a previous accent', () => {
    applyThemeToDocument('dark', false, '#4CC2FF')
    expect(root.style.getPropertyValue('--ac-accent')).toBe('#4CC2FF')
    applyThemeToDocument('dark', false, null)
    expect(root.style.getPropertyValue('--ac-accent')).toBe('')
  })
})

// ---- xterm follows the theme ----------------------------------------------------------------------------------------

const xterm = vi.hoisted(() => ({ themes: [] as Array<{ background?: string }>, instance: undefined as undefined | { options: { theme?: { background?: string } } } }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: { theme?: { background?: string } }
    constructor(o: { theme?: { background?: string } }) {
      this.options = { ...o }
      xterm.themes.push(o.theme ?? {})
      xterm.instance = this
    }
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    loadAddon = vi.fn()
    onData = (): { dispose(): void } => ({ dispose: vi.fn() })
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

describe('T31 xterm theme', () => {
  beforeEach(() => {
    reset()
    xterm.themes.length = 0
  })
  afterEach(reset)

  it('readXtermTheme reads the --ac-term-* tokens of the active theme', () => {
    root.style.setProperty('--ac-term-bg', '#FFFFFF')
    root.style.setProperty('--ac-term-fg', '#1A1D23')
    root.style.setProperty('--ac-term-red', '#B0201C')
    const t = readXtermTheme()
    expect(t.background).toBe('#FFFFFF')
    expect(t.foreground).toBe('#1A1D23')
    expect(t.red).toBe('#B0201C')
    expect(t.brightWhite).toBeTruthy()
  })

  it('a mounted terminal switches theme live and no colour is hard-coded in the component', async () => {
    setApi({
      pty: {
        write: vi.fn(),
        resize: vi.fn().mockResolvedValue({ ok: true }),
        getBuffer: vi.fn().mockResolvedValue({ data: '', end: 0 }),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn())
      }
    })
    root.style.setProperty('--ac-term-bg', '#0B0C0E')
    render(<TerminalView ptyId="p1" />)
    await waitFor(() => expect(xterm.instance).toBeDefined())
    expect(xterm.instance!.options.theme?.background).toBe('#0B0C0E')
    // switching the theme re-reads the tokens
    root.style.setProperty('--ac-term-bg', '#FFFFFF')
    act(() => useThemeStore.getState().setSource('light'))
    expect(xterm.instance!.options.theme?.background).toBe('#FFFFFF')
    expect(read('components/terminal/TerminalView.tsx')).toMatch(/readXtermTheme\(\)/)
  })
})

// ---- Appearance row (+ narrow width) ----------------------------------------------------------------------------------

describe('T31 Appearance setting', () => {
  beforeEach(reset)
  afterEach(reset)

  it('offers System / Light / Dark, System by default, and changing it applies and persists', async () => {
    const user = userEvent.setup()
    render(<AppearanceRow />)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['system', 'light', 'dark'])
    expect(within(group).getByRole('radio', { name: /System/ })).toBeChecked()
    await user.click(within(group).getByRole('radio', { name: /Light/ }))
    expect(root.dataset['theme']).toBe('light')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light')
    expect(within(group).getByRole('radio', { name: /Light/ })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(/light theme/)
  })

  it('narrow width (360px): every option stays reachable and the row wraps instead of overflowing', () => {
    const w = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    const { container } = render(
      <div style={{ width: 360 }}>
        <AppearanceRow />
      </div>
    )
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(container.querySelector('.ac-appearance__options')).not.toBeNull()
    const css = read('components/accounts/appearance.css')
    expect(css).toMatch(/\.ac-appearance__options\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/\.ac-appearance__options \.ac-acc-radio\s*\{[^}]*flex:\s*1 1 220px[^}]*min-width:\s*0/)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  })
})
