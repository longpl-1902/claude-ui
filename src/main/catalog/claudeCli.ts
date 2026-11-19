import type { CliPreview, CliRunResult, McpAddRequest, McpConfigured, PluginInfo } from '../../shared/types'
import { buildChildEnv } from '../pty/childEnv'
import type { ClaudeCommand } from '../pty/claudeBinary'
import { maskArgv, maskText } from './mask'

export type { CliPreview, CliRunResult, McpAddRequest, McpConfigured, PluginInfo }

export type CliExec = (
  file: string,
  args: string[],
  o: { cwd: string; env: Record<string, string>; timeout: number; windowsHide: true }
) => Promise<{ stdout: string; stderr: string; code: number }>

export const LIST_TIMEOUT_MS = 45_000
export const APPLY_TIMEOUT_MS = 120_000
export const PREVIEW_TTL_MS = 10 * 60_000
export const OUTPUT_MAX = 4096

const ID_RE = /^[A-Za-z0-9@._/-]{1,128}$/
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_RE = /^[A-Za-z0-9-]{1,128}$/
const SCOPES = ['local', 'user', 'project']
type Fail = { ok: false; reason: string }

export function parseMcpList(stdout: string): McpConfigured[] {
  const out: McpConfigured[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    const dash = line.lastIndexOf(' - ')
    const colon = line.indexOf(': ')
    if (dash < 0 || colon <= 0 || colon > dash) continue
    const name = line.slice(0, colon).trim()
    const target = line.slice(colon + 2, dash).trim()
    const st = line.slice(dash + 3).trim()
    let status: string
    let pending = false
    if (st.startsWith('✓')) status = 'connected'
    else if (st.startsWith('✗')) status = 'failed'
    else if (st.startsWith('⏸')) {
      status = 'pending'
      pending = true
    } else if (st.startsWith('!')) status = 'needs-auth'
    else continue
    if (!name || !target) continue
    const s: McpConfigured = { name, scope: 'unknown', target: maskText(target), status }
    s.transport = /^https?:\/\//i.test(target) ? (/\(sse\)/i.test(target) ? 'sse' : 'http') : 'stdio'
    if (pending) s.pendingApproval = true
    out.push(s)
  }
  return out
}

export function parsePluginList(stdout: string): (PluginInfo & { installPath?: string })[] {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { plugins?: unknown }).plugins)
      ? (data as { plugins: unknown[] }).plugins
      : []
  const out: (PluginInfo & { installPath?: string })[] = []
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const id = str(r.id) ?? str(r.name)
    if (!id) continue
    const at = id.indexOf('@')
    const p: PluginInfo & { installPath?: string } = { id, name: str(r.name) ?? (at > 0 ? id.slice(0, at) : id), enabled: r.enabled === true }
    const marketplace = str(r.marketplace) ?? (at > 0 ? id.slice(at + 1) : undefined)
    if (marketplace) p.marketplace = marketplace
    const version = str(r.version)
    if (version) p.version = version
    const scope = str(r.scope)
    if (scope) p.scope = scope
    const description = str(r.description)
    if (description) p.description = description
    const installPath = str(r.installPath)
    if (installPath) p.installPath = installPath
    out.push(p)
  }
  return out
}

export function createClaudeCli(deps: {
  exec: CliExec
  resolveClaude: () => ClaudeCommand | null
  baseEnv: Readonly<Record<string, string | undefined>>
  platform: NodeJS.Platform
  newId: () => string
  now: () => number
}): {
  mcpList(o: { cwd: string; configDirAbs: string | null }): Promise<{ servers: McpConfigured[]; error?: string }>
  pluginList(o: { configDirAbs: string | null; cwd?: string }): Promise<{ plugins: (PluginInfo & { installPath?: string })[]; error?: string }>
  previewMcpAdd(o: McpAddRequest & { configDirAbs: string | null; configDirDisplay: string }): CliPreview | Fail
  previewMcpRemove(o: { cwd: string; name: string; scope: string | null; configDirAbs: string | null; configDirDisplay: string }): CliPreview | Fail
  previewPlugin(o: { action: 'enable' | 'disable' | 'install' | 'uninstall'; id: string; configDirAbs: string | null; configDirDisplay: string }): CliPreview | Fail
  apply(previewId: string): Promise<CliRunResult>
} {
  const pending = new Map<string, { argv: string[]; cwd: string; configDirAbs: string | null; expires: number }>()
  const clip = (s: string): string => maskText(s).trim().slice(0, OUTPUT_MAX)

  function env(configDirAbs: string | null): Record<string, string> {
    return buildChildEnv(deps.baseEnv, { configDirAbs, platform: deps.platform })
  }

  async function run(argv: string[], cwd: string, configDirAbs: string | null, timeout: number): Promise<{ stdout: string; stderr: string; code: number } | string> {
    const cmd = deps.resolveClaude()
    if (!cmd) return 'Claude CLI was not found'
    try {
      return await deps.exec(cmd.file, [...cmd.argsPrefix, ...argv], { cwd, env: env(configDirAbs), timeout, windowsHide: true })
    } catch (e) {
      return clip(e instanceof Error ? e.message : String(e)) || 'Claude CLI failed to run'
    }
  }

  function store(argv: string[], cwd: string, configDirAbs: string | null, configDirDisplay: string, effect: string, warnings: string[]): CliPreview | Fail {
    try {
      env(configDirAbs)
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'Invalid config folder' }
    }
    const previewId = deps.newId()
    pending.set(previewId, { argv, cwd, configDirAbs, expires: deps.now() + PREVIEW_TTL_MS })
    return { previewId, argvDisplay: ['claude', ...maskArgv(argv)], cwd, configDir: configDirDisplay, effect, warnings }
  }

  const scopeEffect = (scope: string | null, cwd: string, display: string, verb: string): string => {
    if (scope === 'project') return `${verb} the shared .mcp.json in ${cwd} (checked into the repository).`
    if (scope === 'user') return `${verb} the account-wide MCP list in this account's Claude config (${display}).`
    if (scope === 'local') return `${verb} this project's private MCP list kept in this account's Claude config (${display}); the repository is not changed.`
    return `${verb} whichever scope holds the server: .mcp.json in ${cwd}, or this account's Claude config (${display}).`
  }

  return {
    async mcpList(o) {
      const r = await run(['mcp', 'list'], o.cwd, o.configDirAbs, LIST_TIMEOUT_MS)
      if (typeof r === 'string') return { servers: [], error: r }
      const servers = parseMcpList(r.stdout)
      if (r.code !== 0 && servers.length === 0) return { servers, error: clip(r.stderr || r.stdout) || `claude exited with code ${r.code}` }
      return { servers }
    },

    async pluginList(o) {
      const r = await run(['plugin', 'list', '--json'], o.cwd ?? '.', o.configDirAbs, LIST_TIMEOUT_MS)
      if (typeof r === 'string') return { plugins: [], error: r }
      if (r.code !== 0) return { plugins: [], error: clip(r.stderr || r.stdout) || `claude exited with code ${r.code}` }
      return { plugins: parsePluginList(r.stdout) }
    },

    previewMcpAdd(o) {
      if (!NAME_RE.test(o.name)) return { ok: false, reason: 'Invalid server name' }
      if (!SCOPES.includes(o.scope)) return { ok: false, reason: 'Invalid scope' }
      if (!['stdio', 'http', 'sse'].includes(o.transport)) return { ok: false, reason: 'Invalid transport' }
      if (!o.commandOrUrl || o.commandOrUrl.startsWith('-') || /[\r\n\0]/.test(o.commandOrUrl)) return { ok: false, reason: 'Invalid command or URL' }
      if (o.transport !== 'stdio' && !/^https?:\/\//i.test(o.commandOrUrl)) return { ok: false, reason: 'A URL starting with http:// or https:// is required' }
      if (o.transport !== 'stdio' && o.args.length > 0) return { ok: false, reason: 'Arguments are only valid for stdio servers' }
      if (o.transport === 'stdio' && Object.keys(o.headers).length > 0) return { ok: false, reason: 'Headers are only valid for http/sse servers' }
      if (o.args.some((a) => a.includes('\0'))) return { ok: false, reason: 'Invalid argument' }
      const argv = ['mcp', 'add', '-s', o.scope, '-t', o.transport]
      for (const [k, v] of Object.entries(o.env)) {
        if (!ENV_KEY_RE.test(k) || /[\r\n\0]/.test(v)) return { ok: false, reason: `Invalid environment variable ${k}` }
        argv.push('-e', `${k}=${v}`)
      }
      for (const [k, v] of Object.entries(o.headers)) {
        if (!HEADER_RE.test(k) || /[\r\n\0]/.test(v)) return { ok: false, reason: `Invalid header ${k}` }
        argv.push('-H', `${k}: ${v}`)
      }
      argv.push(o.name, o.commandOrUrl)
      if (o.transport === 'stdio' && o.args.length > 0) argv.push('--', ...o.args)
      const warnings = o.transport === 'stdio' ? ['Adding a stdio server runs its command when Claude starts.'] : []
      return store(argv, o.projectRoot, o.configDirAbs, o.configDirDisplay, scopeEffect(o.scope, o.projectRoot, o.configDirDisplay, 'Adds a server to'), warnings)
    },

    previewMcpRemove(o) {
      if (!NAME_RE.test(o.name)) return { ok: false, reason: 'Invalid server name' }
      if (o.scope !== null && !SCOPES.includes(o.scope)) return { ok: false, reason: 'Invalid scope' }
      const argv = ['mcp', 'remove', ...(o.scope ? ['-s', o.scope] : []), o.name]
      return store(argv, o.cwd, o.configDirAbs, o.configDirDisplay, scopeEffect(o.scope, o.cwd, o.configDirDisplay, 'Removes a server from'), [])
    },

    previewPlugin(o) {
      if (!['enable', 'disable', 'install', 'uninstall'].includes(o.action)) return { ok: false, reason: 'Invalid action' }
      if (!ID_RE.test(o.id) || o.id.startsWith('-')) return { ok: false, reason: 'Invalid plugin id' }
      const effect = `Runs "claude plugin ${o.action}" and lets the CLI update the plugin state in this account's Claude config (${o.configDirDisplay}).`
      const warnings = o.action === 'install' ? ['Installing a plugin can add commands, hooks and MCP servers that run on your machine.'] : []
      return store(['plugin', o.action, o.id], '.', o.configDirAbs, o.configDirDisplay, effect, warnings)
    },

    async apply(previewId) {
      const p = pending.get(previewId)
      pending.delete(previewId)
      if (!p) return { ok: false, reason: 'Unknown or already used preview' }
      if (deps.now() > p.expires) return { ok: false, reason: 'Preview expired' }
      const r = await run(p.argv, p.cwd, p.configDirAbs, APPLY_TIMEOUT_MS)
      if (typeof r === 'string') return { ok: false, reason: r }
      const output = clip([r.stdout, r.stderr].filter(Boolean).join('\n'))
      return r.code === 0 ? { ok: true, output } : { ok: false, reason: `claude exited with code ${r.code}`, output }
    }
  }
}
