import { execFile } from 'node:child_process'
import type { SessionProject } from '../../shared/types'
import { normalizeForCompare } from '../accounts/paths'

/** Injected process runner (execFile-shaped, no shell). Rejects on a non-zero exit, a timeout or a missing binary. */
export type ExecFn = (file: string, args: string[], opts: { timeout: number; windowsHide: true }) => Promise<{ stdout: string }>

export interface ProjectResolver {
  /** Project from the cwd alone (no git): what a session shows until git answers. */
  provisional(cwd: string | undefined, projectDir: string): SessionProject
  /** Resolved project when git already answered for this cwd, else undefined. Never runs anything. */
  cached(cwd: string): SessionProject | undefined
  /** Runs git once per normalized cwd (cached, in-flight calls shared). Never rejects. */
  resolve(cwd: string): Promise<SessionProject>
}

export const GIT_TIMEOUT_MS = 3000

export const createExecFn = (): ExecFn => (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve({ stdout })))
  })

const fwd = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
const baseOf = (p: string): string => {
  const parts = fwd(p).split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function projectFromPath(root: string, git: boolean, platform: NodeJS.Platform): SessionProject {
  return { key: normalizeForCompare(root, platform), name: baseOf(root), root: fwd(root), git }
}

/** Project from the cwd alone (no git); no cwd: the encoded project dir. */
export const provisionalProject = (cwd: string | undefined, projectDir: string, platform: NodeJS.Platform): SessionProject =>
  cwd ? projectFromPath(cwd, false, platform) : { key: normalizeForCompare(projectDir, platform), name: projectDir, root: projectDir, git: false }

/** The main repo root from `git rev-parse --git-common-dir` output: parent of a trailing `.git`, else null. */
export function rootFromCommonDir(out: string): string | null {
  const line = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '')
  if (!line) return null
  const dir = fwd(line)
  if (!/\/\.git$/i.test(dir)) return null
  return dir.slice(0, -'/.git'.length) || '/'
}

export function createProjectResolver(deps: { exec: ExecFn; platform: NodeJS.Platform; onResolved?: () => void }): ProjectResolver {
  const { exec, platform } = deps
  const done = new Map<string, SessionProject>()
  const inflight = new Map<string, Promise<SessionProject>>()
  const cwdKey = (cwd: string): string => normalizeForCompare(cwd, platform)

  async function run(cwd: string): Promise<SessionProject> {
    const fallback = projectFromPath(cwd, false, platform)
    try {
      const { stdout } = await exec('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true
      })
      const root = rootFromCommonDir(stdout)
      return root ? projectFromPath(root, true, platform) : fallback
    } catch {
      return fallback
    }
  }

  return {
    provisional: (cwd, projectDir) => provisionalProject(cwd, projectDir, platform),
    cached: (cwd) => done.get(cwdKey(cwd)),
    resolve(cwd) {
      const k = cwdKey(cwd)
      const hit = done.get(k)
      if (hit) return Promise.resolve(hit)
      let p = inflight.get(k)
      if (!p) {
        p = run(cwd).then((r) => {
          done.set(k, r)
          inflight.delete(k)
          deps.onResolved?.()
          return r
        })
        inflight.set(k, p)
      }
      return p
    }
  }
}
