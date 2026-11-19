import path from 'node:path'
import type { OkResult } from '../../shared/types'

export interface OpenInEditorDeps {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  exists: (p: string) => boolean
  isDir: (p: string) => Promise<boolean>
  spawnDetached: (file: string, args: string[], env?: Record<string, string>) => boolean
  openPath: (p: string) => Promise<string>
}

// Opens a folder in VS Code without ever going through a shell; falls back to the file manager.
export function createOpenInEditor(deps: OpenInEditorDeps): { open(p: string): Promise<OkResult> } {
  const win = deps.platform === 'win32'
  const P = win ? path.win32 : path.posix

  function pathDirs(): string[] {
    const key = Object.keys(deps.env).find((k) => k.toLowerCase() === 'path')
    const raw = key ? deps.env[key] : undefined
    return (raw ?? '').split(win ? ';' : ':').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean)
  }

  function findOnPath(name: string): string | null {
    for (const d of pathDirs()) {
      const full = P.join(d, name)
      if (deps.exists(full)) return full
    }
    return null
  }

  function childEnv(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(deps.env)) if (typeof v === 'string') out[k] = v
    return out
  }

  function launch(folder: string): boolean {
    if (win) {
      const shim = findOnPath('code.cmd')
      if (!shim) return false
      const dir = P.dirname(shim)
      const exe = P.resolve(dir, '..', 'Code.exe')
      const cli = P.resolve(dir, '..', 'resources', 'app', 'out', 'cli.js')
      if (!deps.exists(exe) || !deps.exists(cli)) return false
      return deps.spawnDetached(exe, [cli, folder], { ...childEnv(), ELECTRON_RUN_AS_NODE: '1' })
    }
    const code = findOnPath('code')
    if (!code) return false
    return deps.spawnDetached(code, [folder])
  }

  return {
    async open(p: string): Promise<OkResult> {
      if (typeof p !== 'string' || p.trim() === '' || !P.isAbsolute(p)) return { ok: false, reason: 'invalid-path' }
      let dir = false
      try {
        dir = await deps.isDir(p)
      } catch {
        dir = false
      }
      if (!dir) return { ok: false, reason: 'invalid-path' }
      if (launch(p)) return { ok: true }
      const err = await deps.openPath(p)
      return err ? { ok: false, reason: err } : { ok: true, reason: 'opened-folder' }
    }
  }
}
