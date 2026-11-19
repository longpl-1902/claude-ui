import { create } from 'zustand'
import type { ThemeSource, ThemeState } from '@shared/types'
import { resolveAccent } from './accent'

export const THEME_KEY = 'ac.theme'
export const THEME_SOURCES: ThemeSource[] = ['system', 'light', 'dark']
export const THEME_LABEL: Record<ThemeSource, string> = { system: 'System', light: 'Light', dark: 'Dark' }

const isSource = (v: unknown): v is ThemeSource => v === 'system' || v === 'light' || v === 'dark'

export function loadSource(): ThemeSource {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    if (isSource(v)) return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

function saveSource(s: ThemeSource): void {
  try {
    window.localStorage.setItem(THEME_KEY, s)
  } catch {
    /* storage unavailable */
  }
}

/** prefers-color-scheme as a stand-in until (or without) the main-process push. */
function mediaMode(): 'light' | 'dark' {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

const ACCENT_VARS = ['--ac-accent', '--ac-accent-hover', '--ac-accent-2', '--ac-on-accent'] as const

/** Writes the theme onto <html>: data-theme, data-contrast and (when usable) the Windows accent. */
export function applyThemeToDocument(mode: 'light' | 'dark', highContrast: boolean, accent: string | null): string | null {
  const root = document.documentElement
  root.dataset['theme'] = mode
  if (highContrast) root.dataset['contrast'] = 'high'
  else delete root.dataset['contrast']
  for (const v of ACCENT_VARS) root.style.removeProperty(v)
  // Forced colors (Windows high contrast) keep the system palette: no custom accent.
  const a = highContrast ? null : resolveAccent(accent, mode)
  if (a) {
    root.style.setProperty('--ac-accent', a.accent)
    root.style.setProperty('--ac-accent-hover', a.accentHover)
    root.style.setProperty('--ac-accent-2', a.accent2)
    root.style.setProperty('--ac-on-accent', a.onAccent)
  }
  return a ? a.accent : null
}

export interface ThemeStore {
  source: ThemeSource
  /** Last state pushed by the main process (null in a plain browser / before the first push). */
  system: ThemeState | null
  /** The theme actually shown. */
  mode: 'light' | 'dark'
  /** The Windows accent that is in use, or null when the default accent stays. */
  accentApplied: string | null
  setSource(s: ThemeSource): void
  cycle(): void
  applySystem(s: ThemeState): void
  /** Subscribes to the main process; returns the cleanup. Safe without window.api. */
  init(): () => void
}

function compute(source: ThemeSource, system: ThemeState | null): { mode: 'light' | 'dark'; high: boolean; accent: string | null } {
  const mode = source === 'system' ? (system?.mode ?? mediaMode()) : source
  return { mode, high: system?.highContrast ?? false, accent: system?.accent ?? null }
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const commit = (source: ThemeSource, system: ThemeState | null): void => {
    const c = compute(source, system)
    // The DOM is updated before subscribers run, so a subscriber reading CSS tokens sees the new theme.
    const accentApplied = applyThemeToDocument(c.mode, c.high, c.accent)
    set({ source, system, mode: c.mode, accentApplied })
  }
  const initial = loadSource()
  return {
    source: initial,
    system: null,
    mode: compute(initial, null).mode,
    accentApplied: null,
    setSource(s) {
      saveSource(s)
      commit(s, get().system)
      void window.api?.theme?.setSource(s).then((st) => get().applySystem(st)).catch(() => {})
    },
    cycle() {
      const i = THEME_SOURCES.indexOf(get().source)
      get().setSource(THEME_SOURCES[(i + 1) % THEME_SOURCES.length]!)
    },
    applySystem(s) {
      commit(get().source, s)
    },
    init() {
      commit(get().source, get().system)
      const api = window.api?.theme
      let off: (() => void) | undefined
      if (api) {
        off = api.onChanged((s) => get().applySystem(s))
        void api
          .setSource(get().source)
          .then((s) => get().applySystem(s))
          .catch(() => {})
      }
      let mq: MediaQueryList | undefined
      const onMedia = (): void => {
        if (get().source === 'system' && !get().system) commit('system', null)
      }
      try {
        mq = window.matchMedia?.('(prefers-color-scheme: light)')
        mq?.addEventListener?.('change', onMedia)
      } catch {
        /* no matchMedia */
      }
      return () => {
        off?.()
        mq?.removeEventListener?.('change', onMedia)
      }
    }
  }
})

/** Applies the persisted choice synchronously, before React renders. */
export function bootTheme(): void {
  applyThemeToDocument(useThemeStore.getState().mode, false, null)
}
