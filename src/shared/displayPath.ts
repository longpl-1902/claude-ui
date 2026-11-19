// Short, readable paths for display (UX S4). The `full` value is always the original string.

export interface PathOpts { root?: string; home?: string; platform: string }
const norm = (p: string): string => p.split(String.fromCharCode(92)).join('/')
const stripTrail = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** Returns the remainder when `p` is `base` or inside it, else null. */
function within(p: string, base: string | undefined, ci: boolean): string | null {
  if (!base) return null
  const b = stripTrail(norm(base))
  if (b === '' || b === '/') return null
  const a = ci ? p.toLowerCase() : p
  const bb = ci ? b.toLowerCase() : b
  if (a === bb) return ''
  if (a.startsWith(bb + '/')) return p.slice(b.length + 1)
  return null
}

export function shortenPath(p: string, o: PathOpts): { short: string; full: string } {
  const full = p
  try {
    const n = norm(p)
    const ci = o.platform === 'win32'
    const inRoot = within(n, o.root, ci)
    if (inRoot !== null) return { short: inRoot === '' ? '.' : inRoot, full }
    const tmp = /(?:^|\/)AppData\/Local\/Temp\/(.+)$/i.exec(n) ?? /^\/tmp\/(.+)$/.exec(n)
    if (tmp) {
      const segs = (tmp[1] ?? '').split('/').filter(Boolean)
      if (segs.length > 0) return { short: '‹tmp›/' + segs.slice(-2).join('/'), full }
    }
    const inHome = within(n, o.home, ci)
    if (inHome !== null) return { short: inHome === '' ? '~' : '~/' + inHome, full }
  } catch {
    /* fall through */
  }
  return { short: p, full }
}

const WIN_PATH = /(?<!\w)[A-Za-z]:[\\/][^\s"'`<>|*?()]*/g
const POSIX_PATH = /(?<![\w:/.])\/[^\s"'`<>|*?()]+/g

export function shortenPathsInText(text: string, o: PathOpts): string {
  const fix = (m: string): string => {
    const trail = /[.,;:!]+$/.exec(m)?.[0] ?? ''
    const core = trail ? m.slice(0, -trail.length) : m
    return shortenPath(core, o).short + trail
  }
  return text.replace(WIN_PATH, fix).replace(POSIX_PATH, fix)
}
