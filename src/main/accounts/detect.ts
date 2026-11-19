import { posix, win32 } from 'node:path'
import type { DisplayFields, HostEnv, ReadFs } from '../contracts'
import type { AccountProfile, DetectedLogin } from '@shared/types'
import { readDisplayFields } from './claudeJson'
import { parseJsonc } from './jsonc'
import { expandHome, isAbsoluteFor, isDefaultConfigDir, normalizeForCompare, samePath, toDisplayPath } from './paths'
import { extractClaudeSettingsEnvDir, scanVscode } from './vscodeSettings'

export const CONFIG_DIR_MARKERS = [
  'settings.json',
  'projects',
  'history.jsonl',
  'sessions',
  'todos',
  'statsig',
  'shell-snapshots',
  'file-history',
  'plugins',
  'ide'
] as const

export function looksLikeClaudeConfigDir(entryNames: readonly string[]): boolean {
  if (entryNames.includes('.claude.json')) return true
  return CONFIG_DIR_MARKERS.filter((m) => entryNames.includes(m)).length >= 2
}

export interface DetectedDir {
  configDir: string
  absPath: string
  isDefaultDir: boolean
  exists: boolean
  display: DisplayFields
  sources: string[]
  warnings: string[]
}

const WARN_WORKSPACE = 'Set in workspace settings - VS Code ignores this machine-scoped setting there'
const WARN_RELATIVE = 'Not an absolute path - Claude Code resolves it relative to the current folder'
const WARN_DEFAULT = 'CLAUDE_CONFIG_DIR points at ~/.claude, so Claude reads ~/.claude/.claude.json instead of ~/.claude.json'

interface Candidate {
  value: string
  source: string
  explicit: boolean
  warning?: string
}

export async function detectLogins(
  fs: ReadFs,
  host: HostEnv,
  opts: { extraWorkspaceFolders?: string[] } = {}
): Promise<DetectedDir[]> {
  const { home, platform } = host
  const m = platform === 'win32' ? win32 : posix
  const defaultAbs = m.join(home, '.claude')
  const homeJson = m.join(home, '.claude.json')
  const candidates: Candidate[] = []

  const scan = await scanVscode(fs, host, { extraFolders: opts.extraWorkspaceFolders })

  // 1. default dir
  if ((await fs.exists(defaultAbs)) || (await fs.exists(homeJson))) {
    candidates.push({ value: '~/.claude', source: 'Claude Code CLI (default folder)', explicit: false })
    if (scan.extensionInstalled && !scan.findings.some((f) => f.scope === 'user')) {
      candidates.push({ value: '~/.claude', source: 'VS Code extension', explicit: false })
    }
  }

  // 2. ~/.claude-<x>
  try {
    for (const e of await fs.readdir(home)) {
      if (!e.isDirectory() || !/^\.claude-.+/i.test(e.name)) continue
      let names: string[]
      try {
        names = (await fs.readdir(m.join(home, e.name))).map((x) => x.name)
      } catch {
        continue
      }
      if (looksLikeClaudeConfigDir(names)) {
        candidates.push({ value: m.join(home, e.name), source: `Claude Code CLI (~/${e.name})`, explicit: false })
      }
    }
  } catch {
    // home not listable
  }

  // 3. VS Code findings
  for (const f of scan.findings) {
    let source: string
    if (f.scope === 'user') source = 'VS Code user settings'
    else if (f.scope === 'user-profile') source = 'VS Code profile settings'
    else if (f.scope === 'workspace-file') source = `${f.file.replace(/\\/g, '/').split('/').pop() ?? f.file}`
    else {
      const folder = f.file.replace(/[\\/]\.vscode[\\/]settings\.json$/i, '')
      source = `.vscode/settings.json in ${toDisplayPath(folder, home, platform)}`
    }
    const c: Candidate = { value: f.value, source, explicit: true }
    if (f.ignoredByVsCode) c.warning = WARN_WORKSPACE
    candidates.push(c)
  }

  // 4. Claude settings env
  try {
    const dir = extractClaudeSettingsEnvDir(parseJsonc(await fs.readFile(m.join(defaultAbs, 'settings.json'))))
    if (dir) candidates.push({ value: dir, source: 'Claude settings env (~/.claude/settings.json)', explicit: true })
  } catch {
    // missing or unreadable
  }

  // 5. process env
  const envDir = host.env.CLAUDE_CONFIG_DIR
  if (envDir) candidates.push({ value: envDir, source: 'CLAUDE_CONFIG_DIR environment variable', explicit: true })

  // merge by path
  const merged = new Map<string, DetectedDir>()
  for (const c of candidates) {
    const abs = expandHome(c.value, home)
    const absolute = isAbsoluteFor(abs, platform)
    const key = normalizeForCompare(abs, platform)
    let d = merged.get(key)
    if (!d) {
      const isDefaultDir = absolute && isDefaultConfigDir(abs, home, platform)
      d = {
        configDir: isDefaultDir ? '~/.claude' : absolute ? toDisplayPath(abs, home, platform) : c.value,
        absPath: isDefaultDir ? defaultAbs : abs,
        isDefaultDir,
        exists: false,
        display: { signedIn: false, missing: true },
        sources: [],
        warnings: []
      }
      merged.set(key, d)
    }
    const target = d
    const warn = (w: string): void => {
      if (!target.warnings.includes(w)) target.warnings.push(w)
    }
    if (!target.sources.includes(c.source)) target.sources.push(c.source)
    if (c.warning) warn(c.warning)
    if (!absolute) warn(WARN_RELATIVE)
    if (c.explicit && target.isDefaultDir) warn(WARN_DEFAULT)
  }

  const out = [...merged.values()]
  for (const d of out) {
    if (!isAbsoluteFor(d.absPath, platform)) continue
    d.exists = (await fs.exists(d.absPath)) || (d.isDefaultDir && (await fs.exists(homeJson)))
    d.display = await readDisplayFields(fs, d.absPath, home, platform)
  }
  out.sort((a, b) => {
    if (a.isDefaultDir !== b.isDefaultDir) return a.isDefaultDir ? -1 : 1
    return a.configDir < b.configDir ? -1 : a.configDir > b.configDir ? 1 : 0
  })
  return out
}

export function toDetectedLogin(
  d: DetectedDir,
  profiles: readonly AccountProfile[],
  home: string,
  platform: NodeJS.Platform
): DetectedLogin {
  const out: DetectedLogin = {
    configDir: d.configDir,
    sources: [...d.sources],
    signedIn: d.display.signedIn,
    isDefaultDir: d.isDefaultDir,
    exists: d.exists,
    warnings: [...d.warnings]
  }
  if (d.display.email !== undefined) out.email = d.display.email
  if (d.display.org !== undefined) out.org = d.display.org
  const linked = profiles.find((p) => samePath(p.configDir, d.configDir, home, platform))
  if (linked) out.linkedAccountId = linked.id
  return out
}
