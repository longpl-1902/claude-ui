import type { ITheme } from '@xterm/xterm'

/** Builds the xterm colour theme from the active CSS tokens (--ac-term-*). Call again after a theme change. */
export function readXtermTheme(el: Element = document.documentElement): ITheme {
  const cs = getComputedStyle(el)
  const g = (n: string, fallback: string): string => cs.getPropertyValue(`--ac-term-${n}`).trim() || fallback
  return {
    background: g('bg', '#0B0C0E'),
    foreground: g('fg', '#E6E7EA'),
    cursor: g('cursor', '#E6E7EA'),
    cursorAccent: g('bg', '#0B0C0E'),
    selectionBackground: g('selection', 'rgba(122, 167, 255, 0.35)'),
    black: g('black', '#1A1D22'),
    red: g('red', '#FF8A8A'),
    green: g('green', '#5ED3A8'),
    yellow: g('yellow', '#F2A541'),
    blue: g('blue', '#7AA7FF'),
    magenta: g('magenta', '#C49BFF'),
    cyan: g('cyan', '#6FD3E0'),
    white: g('white', '#C9CDD4'),
    brightBlack: g('bright-black', '#8A919C'),
    brightRed: g('bright-red', '#FFA8A8'),
    brightGreen: g('bright-green', '#86E3C0'),
    brightYellow: g('bright-yellow', '#F7C06E'),
    brightBlue: g('bright-blue', '#A9C6FF'),
    brightMagenta: g('bright-magenta', '#D7B8FF'),
    brightCyan: g('bright-cyan', '#98E4EE'),
    brightWhite: g('bright-white', '#E6E7EA')
  }
}
