import { posix, win32 } from 'node:path'
import type { HostEnv, ReadFs } from '../contracts'
import { parseJsonc } from './jsonc'
import { fileUriToPath, normalizeForCompare, vscodeUserDirs } from './paths'

export const ENV_SETTING_KEYS = ['claudeCode.environmentVariables', 'claude-code.environmentVariables']

export interface VscodeFinding {
  value: string
  file: string
  scope: 'user' | 'user-profile' | 'workspace' | 'workspace-file'
  ignoredByVsCode: boolean
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function extractConfigDirValues(settings: unknown, platform: NodeJS.Platform): string[] {
  if (!isRecord(settings)) return []
  const lists: unknown[] = ENV_SETTING_KEYS.map((k) => settings[k])
  const nested = settings.claudeCode
  if (isRecord(nested)) lists.push(nested.environmentVariables)
  const out: string[] = []
  const wanted = 'CLAUDE_CONFIG_DIR'
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!isRecord(item) || typeof item.name !== 'string') continue
      const nameOk = platform === 'win32' ? item.name.toUpperCase() === wanted : item.name === wanted
      if (nameOk && typeof item.value === 'string' && item.value.length > 0) out.push(item.value)
    }
  }
  return out
}

export function extractClaudeSettingsEnvDir(settings: unknown): string | undefined {
  if (!isRecord(settings) || !isRecord(settings.env)) return undefined
  const v = settings.env.CLAUDE_CONFIG_DIR
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

async function readJsonc(fs: ReadFs, path: string): Promise<unknown> {
  try {
    return parseJsonc(await fs.readFile(path))
  } catch {
    return undefined
  }
}

export async function scanVscode(
  fs: ReadFs,
  host: HostEnv,
  opts: { extraFolders?: string[]; maxWorkspaces?: number } = {}
): Promise<{ findings: VscodeFinding[]; extensionInstalled: boolean; extensionVersion?: string }> {
  const { platform, home } = host
  const m = platform === 'win32' ? win32 : posix
  const findings: VscodeFinding[] = []
  const max = opts.maxWorkspaces ?? 200

  const add = (settings: unknown, file: string, scope: VscodeFinding['scope']): void => {
    const ignored = scope === 'workspace' || scope === 'workspace-file'
    for (const value of extractConfigDirValues(settings, platform)) {
      findings.push({ value, file, scope, ignoredByVsCode: ignored })
    }
  }

  const workspaces: string[] = []
  const seen = new Set<string>()
  const addWorkspace = (p: string | null): void => {
    if (!p) return
    const k = normalizeForCompare(p, platform)
    if (seen.has(k)) return
    seen.add(k)
    workspaces.push(p)
  }

  for (const userDir of vscodeUserDirs(host)) {
    const userFile = m.join(userDir, 'settings.json')
    add(await readJsonc(fs, userFile), userFile, 'user')

    try {
      for (const e of await fs.readdir(m.join(userDir, 'profiles'))) {
        if (!e.isDirectory()) continue
        const f = m.join(userDir, 'profiles', e.name, 'settings.json')
        add(await readJsonc(fs, f), f, 'user-profile')
      }
    } catch {
      // no profiles directory
    }

    const storage = await readJsonc(fs, m.join(userDir, 'globalStorage', 'storage.json'))
    if (!isRecord(storage)) continue
    const assoc = isRecord(storage.profileAssociations) ? storage.profileAssociations.workspaces : undefined
    if (isRecord(assoc)) for (const uri of Object.keys(assoc)) addWorkspace(fileUriToPath(uri, platform))
    const backup = storage.backupWorkspaces
    if (isRecord(backup)) {
      if (Array.isArray(backup.folders)) {
        for (const f of backup.folders) {
          if (isRecord(f) && typeof f.folderUri === 'string') addWorkspace(fileUriToPath(f.folderUri, platform))
        }
      }
      if (Array.isArray(backup.workspaces)) {
        for (const w of backup.workspaces) {
          if (isRecord(w) && typeof w.configURIPath === 'string') addWorkspace(fileUriToPath(w.configURIPath, platform))
        }
      }
    }
  }
  for (const f of opts.extraFolders ?? []) addWorkspace(f)

  for (const ws of workspaces.slice(0, max)) {
    if (/\.code-workspace$/i.test(ws)) {
      const data = await readJsonc(fs, ws)
      if (isRecord(data)) add(data.settings, ws, 'workspace-file')
    } else {
      const file = ws.replace(/[\\/]+$/, '') + '/.vscode/settings.json'
      add(await readJsonc(fs, file), file, 'workspace')
    }
  }

  let extensionVersion: string | undefined
  let extensionInstalled = false
  try {
    for (const e of await fs.readdir(m.join(home, '.vscode', 'extensions'))) {
      const match = /^anthropic\.claude-code-(\d+(?:\.\d+)*)(?:-.+)?$/i.exec(e.name)
      if (!match) continue
      extensionInstalled = true
      const v = match[1]!
      if (extensionVersion === undefined || v.localeCompare(extensionVersion, undefined, { numeric: true }) > 0) {
        extensionVersion = v
      }
    }
  } catch {
    // no extensions directory
  }

  const result: { findings: VscodeFinding[]; extensionInstalled: boolean; extensionVersion?: string } = {
    findings,
    extensionInstalled
  }
  if (extensionVersion !== undefined) result.extensionVersion = extensionVersion
  return result
}
