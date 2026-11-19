import { posix, win32 } from 'node:path'
import type { HostEnv } from '../contracts'

const mod = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? win32 : posix)

export function expandHome(p: string, home: string): string {
  const m = /^(?:~|\$HOME|%USERPROFILE%)(?:[\\/](.*))?$/i.exec(p)
  if (!m) return p
  const rest = m[1]
  if (!rest) return home
  const base = home.replace(/[\\/]+$/, '')
  const sep = home.includes('\\') ? '\\' : '/'
  return base + sep + (sep === '\\' ? rest.replace(/\//g, '\\') : rest)
}

export function normalizeForCompare(p: string, platform: NodeJS.Platform): string {
  let s = p.replace(/\\/g, '/')
  const unc = platform === 'win32' && s.startsWith('//')
  s = s.replace(/\/{2,}/g, '/')
  if (unc) s = '/' + s
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s
}

export function samePath(a: string, b: string, home: string, platform: NodeJS.Platform): boolean {
  return normalizeForCompare(expandHome(a, home), platform) === normalizeForCompare(expandHome(b, home), platform)
}

export function toDisplayPath(abs: string, home: string, platform: NodeJS.Platform): string {
  const fwd = abs.replace(/\\/g, '/').replace(/\/+$/, '')
  const h = normalizeForCompare(home, platform)
  const n = normalizeForCompare(abs, platform)
  if (n === h) return '~'
  if (n.startsWith(h + '/')) return '~' + fwd.slice(home.replace(/\\/g, '/').replace(/\/+$/, '').length)
  return fwd
}

export function isAbsoluteFor(p: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p)
  return p.startsWith('/')
}

export function isDefaultConfigDir(dir: string, home: string, platform: NodeJS.Platform): boolean {
  return samePath(dir, mod(platform).join(home, '.claude'), home, platform)
}

export function claudeJsonPathFor(dir: string, home: string, platform: NodeJS.Platform): string {
  const m = mod(platform)
  if (isDefaultConfigDir(dir, home, platform)) return m.join(home, '.claude.json')
  return m.join(expandHome(dir, home), '.claude.json')
}

export function legacyConfigJsonPathFor(dir: string, home: string, platform: NodeJS.Platform): string {
  const m = mod(platform)
  const abs = isDefaultConfigDir(dir, home, platform) ? m.join(home, '.claude') : expandHome(dir, home)
  return m.join(abs, '.config.json')
}

export function vscodeUserDirs(host: HostEnv): string[] {
  const { home, platform, env } = host
  const m = mod(platform)
  const variants = ['Code', 'Code - Insiders']
  if (platform === 'win32') {
    const appData = host.appData ?? env.APPDATA ?? m.join(home, 'AppData', 'Roaming')
    return variants.map((v) => m.join(appData, v, 'User'))
  }
  if (platform === 'darwin') return variants.map((v) => m.join(home, 'Library', 'Application Support', v, 'User'))
  const cfg = env.XDG_CONFIG_HOME || m.join(home, '.config')
  return variants.map((v) => m.join(cfg, v, 'User'))
}

export function fileUriToPath(uri: string, platform: NodeJS.Platform): string | null {
  if (!/^file:\/\//i.test(uri)) return null
  let p: string
  try {
    p = decodeURIComponent(uri.slice('file://'.length))
  } catch {
    return null
  }
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  return p
}
