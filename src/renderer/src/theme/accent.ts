import { contrastRatio, mix } from './contrast'

/** Panel backgrounds of the two themes (kept equal to --ac-bg-panel in tokens.css by tests/renderer/theme.test.tsx). */
export const PANEL_BG = { dark: '#121417', light: '#FFFFFF' } as const
/** Text colour used on top of a custom accent: whichever of the two reads better. */
const DARK_TEXT = '#0E0F11'
const LIGHT_TEXT = '#FFFFFF'

/** The Windows accent must reach this contrast against the panel background to be used for --ac-accent. */
export const ACCENT_MIN_CONTRAST = 3

export interface AccentTokens {
  accent: string
  accentHover: string
  accent2: string
  onAccent: string
}

/**
 * Returns the --ac-accent family derived from the Windows accent, or null when it is missing, not #RRGGBB, or
 * below 3:1 against the current panel background (the theme's default accent then stays).
 */
export function resolveAccent(accent: string | null | undefined, mode: 'light' | 'dark'): AccentTokens | null {
  if (!accent || !/^#[0-9a-fA-F]{6}$/.test(accent)) return null
  if (contrastRatio(accent, PANEL_BG[mode]) < ACCENT_MIN_CONTRAST) return null
  const onAccent = contrastRatio(accent, DARK_TEXT) >= contrastRatio(accent, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT
  return {
    accent,
    accentHover: mode === 'dark' ? mix(accent, '#FFFFFF', 0.35) : mix(accent, '#000000', 0.25),
    accent2: accent,
    onAccent
  }
}
