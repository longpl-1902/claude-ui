import type { IpcMain } from 'electron'
import { INVOKE_CHANNELS, type InvokeChannel, type IpcInvokeMap } from '@shared/ipc'
import { safeExternalUrl } from '@shared/externalUrl'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import { EMPTY_TEAM_SNAPSHOT } from '@shared/teamDefaults'
import type {
  AttentionPrefs, AttentionSnapshot, CatalogItem, ControlPermissionMode, Effort, FileSuggestion, KillExternalRequest, OkResult, PluginInfo,
  PtySpawnRequest, TeamSelection
} from '@shared/types'
import type { AccountsService } from '../accounts/accountsService'
import type { createCatalog } from '../catalog/catalog'
import type { createClaudeCli } from '../catalog/claudeCli'
import type { ControlManager } from '../control/controlManager'
import type { WorktreeService } from '../git/worktreeService'
import type { createHooksService } from '../hooks/hooksService'
import type { PtyManagerApi } from '../pty/types'
import type { TranscriptService } from '../transcripts/transcriptService'

export type Handlers = {
  [C in InvokeChannel]: (...args: IpcInvokeMap[C]['args']) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result']
}

const NOT_IMPLEMENTED: OkResult = { ok: false, reason: 'not-implemented' }
const INVALID_ARGS: OkResult = { ok: false, reason: 'invalid-args' }

const allStrings = (...args: unknown[]): boolean => args.every((a) => typeof a === 'string')

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null

const MAX_WRITE = 64 * 1024
const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.floor(v)))

export interface HandlerDeps {
  version?: string
  accounts?: AccountsService
  pty?: PtyManagerApi
  pickFolder?: () => Promise<string | null>
  defaultCwd?: () => string
  /** shell.openExternal; only called with a validated http/https URL */
  openExternal?: (url: string) => Promise<void>
  transcripts?: TranscriptService
  /** called after a successful 'pty:spawn' */
  onPtySpawned?: (ptyId: string) => void
  control?: ControlManager
  worktrees?: WorktreeService
  hooks?: ReturnType<typeof createHooksService>
  externalKiller?: { kill(req: KillExternalRequest): Promise<OkResult> }
  openInEditor?: { open(p: string): Promise<OkResult> }
  isSessionLive?: (accountId: string, sessionId: string) => Promise<boolean>
  attention?: {
    snapshot(): AttentionSnapshot
    getPrefs(): AttentionPrefs
    setPrefs(p: AttentionPrefs): Promise<OkResult>
  }
  /** T25 services (catalog scanner + claude mcp/plugin runner). */
  catalog?: ReturnType<typeof createCatalog>
  claudeCli?: ReturnType<typeof createClaudeCli>
  /** Account -> real config folder (default dir resolved), env value (null = default dir) and a display string. */
  resolveAccountDir?: (accountId: string) => Promise<{ abs: string; configDirAbs: string | null; display: string } | null>
  /** Runs git with the given argv (no shell) and returns stdout; rejects on failure. */
  execGit?: (args: string[]) => Promise<{ stdout: string }>
  now?: () => number
}

export const FILE_LIST_TTL_MS = 30_000
export const FILE_LIST_MAX = 20_000
export const PLUGIN_CACHE_TTL_MS = 5 * 60_000
export const FILE_SUGGESTIONS_MAX = 50

/** Subsequence match, case-insensitive. Basename and prefix hits and short paths rank first. Top `limit`. */
export function fuzzyFilter(paths: readonly string[], query: string, limit = FILE_SUGGESTIONS_MAX): FileSuggestion[] {
  const q = query.toLowerCase()
  if (q === '') return paths.slice(0, limit).map((path) => ({ path }))
  const scored: { path: string; score: number }[] = []
  for (const path of paths) {
    const lower = path.toLowerCase()
    let at = -1
    let gaps = 0
    let ok = true
    for (const ch of q) {
      const next = lower.indexOf(ch, at + 1)
      if (next < 0) {
        ok = false
        break
      }
      if (at >= 0 && next !== at + 1) gaps++
      at = next
    }
    if (!ok) continue
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    let score = 100 - gaps * 3 - Math.min(40, lower.length / 4)
    if (base.startsWith(q)) score += 60
    else if (base.includes(q)) score += 40
    else if (lower.includes(q)) score += 20
    scored.push({ path, score })
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
  return scored.slice(0, limit).map((s) => ({ path: s.path, score: Math.round(s.score) }))
}

/** Validate and clean a spawn request. The renderer never chooses a command or arguments. */
function parseSpawn(req: unknown): PtySpawnRequest | null {
  if (!isObject(req)) return null
  const r = req as Record<string, unknown>
  if (typeof r.cwd !== 'string' || typeof r.accountId !== 'string' || !isPosNum(r.cols) || !isPosNum(r.rows)) return null
  if (r.confirmed !== undefined && typeof r.confirmed !== 'boolean') return null
  const out: PtySpawnRequest = { cwd: r.cwd, accountId: r.accountId, cols: clamp(r.cols, 20, 500), rows: clamp(r.rows, 5, 200) }
  if (r.confirmed !== undefined) out.confirmed = r.confirmed
  return out
}

/** Mock-backed handlers by default (Phase 1); real accounts/pty/app handlers when the deps are given. */
export function createHandlers(deps: HandlerDeps = {}): Handlers {
  let defaultAccountId = mockAccountsSnapshot.defaultAccountId
  const mock = createMockHandlers(deps, () => defaultAccountId, (id) => void (defaultAccountId = id))
  const { accounts, pty } = deps
  const hasReal =
    accounts || pty || deps.pickFolder || deps.defaultCwd || deps.transcripts || deps.control || deps.worktrees || deps.hooks ||
    deps.externalKiller || deps.openInEditor || deps.attention || deps.openExternal || deps.catalog || deps.claudeCli
  if (!hasReal) return mock
  const real: Partial<Handlers> = {}
  if (accounts) {
    Object.assign(real, {
      'accounts:get-snapshot': () => accounts.snapshot(),
      'accounts:scan': () => accounts.scan(),
      'accounts:set-default': (id) => (allStrings(id) ? accounts.setDefault(id) : { ...INVALID_ARGS }),
      'accounts:link-detected': (req) => (isObject(req) ? accounts.linkDetected(req) : { ...INVALID_ARGS }),
      'accounts:save-profile': (p) => (isObject(p) ? accounts.saveProfile(p) : { ...INVALID_ARGS }),
      'accounts:remove-profile': (id) => (allStrings(id) ? accounts.removeProfile(id) : { ...INVALID_ARGS }),
      'accounts:set-rules': (rules) => (Array.isArray(rules) ? accounts.setRules(rules) : { ...INVALID_ARGS }),
      'accounts:set-safety': (s) => (isObject(s) ? accounts.setSafety(s) : { ...INVALID_ARGS }),
      'accounts:set-limit-policy': (p) => (allStrings(p) ? accounts.setLimitPolicy(p as never) : { ...INVALID_ARGS }),
      'accounts:resolve-folder': (folder) => accounts.resolveFolder(allStrings(folder) ? folder : ''),
      'accounts:check-launch': (folder, id) =>
        allStrings(folder, id)
          ? accounts.checkLaunch(folder, id)
          : { allowed: false, warnings: [], blockedReason: 'invalid-folder', matched: { accountId: 'ask', ruleIndex: -1 } },
      'accounts:start-sign-in': (dir) => (allStrings(dir) ? accounts.signIn.start(dir) : { ...INVALID_ARGS }),
      'accounts:check-sign-in': (dir) => accounts.signIn.check(allStrings(dir) ? dir : ''),
      'accounts:reopen-sign-in': (dir) => (allStrings(dir) ? accounts.signIn.reopen(dir) : { ...INVALID_ARGS }),
      'accounts:cancel-sign-in': (dir) => (allStrings(dir) ? accounts.signIn.cancel(dir) : { ...INVALID_ARGS }),
      'pty:spawn': async (req) => {
        const r = parseSpawn(req)
        if (!r) return { ok: false, reason: 'invalid-args' }
        const result = await accounts.launchClaude(r)
        if (result.ok) deps.onPtySpawned?.(result.ptyId ?? '')
        return result
      }
    } satisfies Partial<Handlers>)
    if (deps.control) {
      real['control:start'] = async (req) => {
        if (!isControlStartRequest(req)) return { ok: false, reason: 'invalid-args' }
        const r = req.resume
        if (r?.kind === 'resume' && !r.fork && deps.isSessionLive && (await deps.isSessionLive(req.accountId, r.sessionId))) {
          return { ok: false, reason: 'session-live-elsewhere' }
        }
        const started = await accounts.launchControlled(req)
        if (started.ok && started.controlId) {
          // launchControlled does not carry these two; a draft stores them for the CLI args of the first Send.
          if (req.effort !== undefined) await deps.control!.setEffort(started.controlId, req.effort)
          if (req.outputStyle !== undefined) await deps.control!.setOutputStyle(started.controlId, req.outputStyle)
        }
        return started
      }
    }
  }
  const fileCache = new Map<string, { at: number; files: string[] }>()
  const listProjectFiles = async (cwd: string): Promise<string[]> => {
    const nowMs = deps.now ?? ((): number => Date.now())
    const hit = fileCache.get(cwd)
    if (hit && nowMs() - hit.at < FILE_LIST_TTL_MS) return hit.files
    let files: string[] = []
    if (deps.execGit) {
      try {
        const r = await deps.execGit(['-C', cwd, 'ls-files', '-co', '--exclude-standard'])
        files = r.stdout.split(/\r?\n/).filter((l) => l !== '').slice(0, FILE_LIST_MAX)
      } catch {
        files = []
      }
    }
    fileCache.set(cwd, { at: nowMs(), files })
    if (fileCache.size > 20) fileCache.delete(fileCache.keys().next().value as string)
    return files
  }
  const { control } = deps
  if (control) {
    Object.assign(real, {
      'control:send': (id, text) => (allStrings(id, text) && text.length <= MAX_SEND ? control.send(id, text) : { ...INVALID_ARGS }),
      'control:interrupt': (id) => (allStrings(id) ? control.interrupt(id) : { ...INVALID_ARGS }),
      'control:stop': (id) => (allStrings(id) ? control.stop(id) : { ...INVALID_ARGS }),
      'control:answer': (id, requestId, answer) =>
        allStrings(id, requestId) && isPermissionAnswer(answer) ? control.answer(id, requestId, answer) : { ...INVALID_ARGS },
      'control:set-model': (id, model) =>
        allStrings(id) && (model === null || (typeof model === 'string' && MODEL_RE.test(model))) ? control.setModel(id, model) : { ...INVALID_ARGS },
      'control:set-mode': (id, mode) => (allStrings(id) && PERMISSION_MODES.includes(mode) ? control.setMode(id, mode) : { ...INVALID_ARGS }),
      'control:list': () => control.list(),
      'control:get-stream': (id) => (allStrings(id) ? control.streamState(id) : null),
      'control:details': (id) => (allStrings(id) ? control.details(id) : null),
      'control:send-rich': (id, text, images) =>
        allStrings(id, text) && text.length <= MAX_SEND && isImageList(images) ? control.sendRich(id, text, images) : { ...INVALID_ARGS },
      'control:refresh-context': (id) => (allStrings(id) ? control.refreshContext(id) : { ...INVALID_ARGS }),
      'control:mcp-toggle': (id, name, enabled) =>
        allStrings(id) && isMcpName(name) && typeof enabled === 'boolean' ? control.mcpToggle(id, name, enabled) : { ...INVALID_ARGS },
      'control:mcp-reconnect': (id, name) => (allStrings(id) && isMcpName(name) ? control.mcpReconnect(id, name) : { ...INVALID_ARGS }),
      'control:file-suggestions': async (id, cwd, query) => {
        if (!(id === null || str(id)) || !str(cwd, 4096) || cwd === '' || !str(query, 256)) return []
        if (id !== null) {
          const live = await control.fileSuggestions(id, query)
          if (live) return live
        }
        return fuzzyFilter(await listProjectFiles(cwd), query)
      },
      'control:rewind-preview': (id, uuid) =>
        allStrings(id) && isUuid(uuid)
          ? control.rewindPreview(id, uuid)
          : { canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'invalid-args' },
      'control:rewind': (id, uuid) => (allStrings(id) && isUuid(uuid) ? control.rewind(id, uuid) : { ...INVALID_ARGS }),
      'control:fork-at': (id, uuid) => (allStrings(id) && isUuid(uuid) ? control.forkAt(id, uuid) : { ok: false, reason: 'invalid-args' }),
      'control:set-effort': (id, effort) =>
        allStrings(id) && (effort === null || isEffort(effort)) ? control.setEffort(id, effort) : { ...INVALID_ARGS },
      'control:set-output-style': (id, style) =>
        allStrings(id) && (style === null || (str(style, 128) && style !== '')) ? control.setOutputStyle(id, style) : { ...INVALID_ARGS },
      'control:rename': (id, title) => (allStrings(id) && str(title, 200) && title.trim() !== '' ? control.rename(id, title) : { ...INVALID_ARGS }),
      'control:get-plan': (id) => (allStrings(id) ? control.getPlan(id) : { exists: false }),
      'team:pause-all': () => {
        const n = control.interruptAll()
        return n > 0 ? { ok: true, reason: String(n) } : { ok: false, reason: 'nothing-running' }
      }
    } satisfies Partial<Handlers>)
  }
  if (deps.catalog || deps.claudeCli) {
    const nowMs = deps.now ?? ((): number => Date.now())
    const noAccount: OkResult = { ok: false, reason: 'unknown-account' }
    const dirOf = async (accountId: string): Promise<{ abs: string; configDirAbs: string | null; display: string } | null> =>
      deps.resolveAccountDir ? deps.resolveAccountDir(accountId) : null
    const plugins = new Map<string, { at: number; plugins: (PluginInfo & { installPath?: string })[]; error?: string }>()
    const loadPlugins = async (accountId: string, force: boolean): Promise<{ plugins: (PluginInfo & { installPath?: string })[]; error?: string }> => {
      const hit = plugins.get(accountId)
      if (!force && hit && nowMs() - hit.at < PLUGIN_CACHE_TTL_MS) return hit
      const dir = await dirOf(accountId)
      if (!dir || !deps.claudeCli) return { plugins: [], error: 'unknown-account' }
      const r = await deps.claudeCli.pluginList({ configDirAbs: dir.configDirAbs })
      if (!r.error) plugins.set(accountId, { at: nowMs(), ...r })
      return r
    }
    let listedPaths = new Set<string>()
    if (deps.catalog) {
      const catalog = deps.catalog
      real['catalog:list'] = async (projectRoot, accountId) => {
        if (!(projectRoot === null || (str(projectRoot, 4096) && projectRoot !== '')) || !str(accountId) || accountId === '') return []
        const dir = await dirOf(accountId)
        if (!dir) return []
        const pl = (await loadPlugins(accountId, false)).plugins.flatMap((p) => (p.installPath ? [{ name: p.name, installPath: p.installPath }] : []))
        const items: CatalogItem[] = await catalog.list({ configDirAbs: dir.abs, projectRoot, plugins: pl })
        listedPaths = new Set(items.map((i) => i.path))
        return items
      }
      real['catalog:open'] = async (path) => {
        if (!str(path, 4096) || path === '') return { ...INVALID_ARGS }
        if (!listedPaths.has(path)) return { ok: false, reason: 'not-listed' }
        return deps.openInEditor ? deps.openInEditor.open(path) : { ok: false, reason: 'unavailable' }
      }
    }
    if (deps.claudeCli) {
      const cli = deps.claudeCli
      real['mcp:list'] = async (projectRoot, accountId) => {
        const ranAt = new Date(nowMs()).toISOString()
        if (!str(projectRoot) || projectRoot === '' || !str(accountId) || accountId === '') return { servers: [], ranAt, error: 'invalid-args' }
        const dir = await dirOf(accountId)
        if (!dir) return { servers: [], ranAt, error: 'unknown-account' }
        return { ...(await cli.mcpList({ cwd: projectRoot, configDirAbs: dir.configDirAbs })), ranAt }
      }
      real['mcp:preview-add'] = async (req) => {
        if (!isMcpAddRequest(req)) return { ...INVALID_ARGS }
        const dir = await dirOf(req.accountId)
        return dir ? cli.previewMcpAdd({ ...req, configDirAbs: dir.configDirAbs, configDirDisplay: dir.display }) : { ...noAccount }
      }
      real['mcp:preview-remove'] = async (projectRoot, accountId, name, scope) => {
        if (!str(projectRoot) || projectRoot === '' || !str(accountId) || accountId === '' || !isMcpName(name)) return { ...INVALID_ARGS }
        if (!(scope === null || scope === 'local' || scope === 'user' || scope === 'project')) return { ...INVALID_ARGS }
        const dir = await dirOf(accountId)
        return dir ? cli.previewMcpRemove({ cwd: projectRoot, name, scope, configDirAbs: dir.configDirAbs, configDirDisplay: dir.display }) : { ...noAccount }
      }
      real['plugins:list'] = async (accountId) => {
        if (!str(accountId) || accountId === '') return { plugins: [], error: 'invalid-args' }
        const r = await loadPlugins(accountId, true)
        const out: { plugins: PluginInfo[]; error?: string } = { plugins: r.plugins.map(({ installPath: _p, ...info }) => info) }
        if (r.error !== undefined) out.error = r.error
        return out
      }
      real['plugins:preview'] = async (accountId, action, id) => {
        if (!str(accountId) || accountId === '' || !(action === 'enable' || action === 'disable' || action === 'install' || action === 'uninstall')) return { ...INVALID_ARGS }
        if (!str(id, 256) || id === '') return { ...INVALID_ARGS }
        const dir = await dirOf(accountId)
        return dir ? cli.previewPlugin({ action, id, configDirAbs: dir.configDirAbs, configDirDisplay: dir.display }) : { ...noAccount }
      }
      real['cli:apply'] = async (previewId) => {
        if (!str(previewId) || previewId === '') return { ok: false, reason: 'invalid-args' }
        const r = await cli.apply(previewId)
        plugins.clear()
        return r
      }
    }
  }
  if (deps.externalKiller) {
    const killer = deps.externalKiller
    real['session:kill-external'] = (req) => (isKillExternalRequest(req) ? killer.kill(req) : { ...INVALID_ARGS })
  }
  if (deps.openInEditor) {
    const editor = deps.openInEditor
    real['worktree:open-in-editor'] = (p) => (str(p) && p !== '' ? editor.open(p) : { ...INVALID_ARGS })
  }
  if (deps.worktrees) {
    const wt = deps.worktrees
    Object.assign(real, {
      'git:watch': (root) => wt.watch(root === null || str(root) ? (root as string | null) : null),
      'git:compare': (root, path) => (str(root) && str(path, 4096) && root !== '' && path !== '' ? wt.compare(root, path) : []),
    } satisfies Partial<Handlers>)
  }
  if (deps.hooks) {
    const hooks = deps.hooks
    Object.assign(real, {
      'hooks:status': (root) => hooks.status(root === null || str(root) ? (root as string | null) : null),
      'hooks:preview': (root, action) =>
        str(root) && root !== '' && (action === 'install' || action === 'uninstall') ? hooks.preview(root, action) : { ...INVALID_ARGS },
      'hooks:apply': (previewId) => (str(previewId) && previewId !== '' ? hooks.apply(previewId) : { ...INVALID_ARGS })
    } satisfies Partial<Handlers>)
  }
  if (deps.attention) {
    const att = deps.attention
    Object.assign(real, {
      'attention:get': () => att.snapshot(),
      'attention:get-prefs': () => att.getPrefs(),
      'attention:set-prefs': (p) => (isAttentionPrefs(p) ? att.setPrefs(p) : { ...INVALID_ARGS })
    } satisfies Partial<Handlers>)
  }
  if (pty) {
    Object.assign(real, {
      'pty:write': (id, data) => {
        if (!allStrings(id, data) || data.length > MAX_WRITE) return { ...INVALID_ARGS }
        return pty.write(id, data) ? { ok: true } : { ok: false, reason: 'not-found' }
      },
      'pty:resize': (id, cols, rows) => {
        if (!allStrings(id) || !isPosNum(cols) || !isPosNum(rows)) return { ...INVALID_ARGS }
        return pty.resize(id, clamp(cols, 20, 500), clamp(rows, 5, 200)) ? { ok: true } : { ok: false, reason: 'not-found' }
      },
      'pty:kill': (id) => {
        if (!allStrings(id)) return { ...INVALID_ARGS }
        return pty.kill(id) ? { ok: true } : { ok: false, reason: 'not-found' }
      },
      'pty:list': () => pty.list(),
      'pty:get-buffer': (id) => (allStrings(id) ? pty.snapshot(id) : { data: '', end: 0 })
    } satisfies Partial<Handlers>)
  }
  const { pickFolder, defaultCwd, transcripts } = deps
  if (transcripts) {
    Object.assign(real, {
      'team:get-snapshot': () => transcripts.snapshot(),
      'transcripts:list-sessions': () => transcripts.listSessions(),
      'transcripts:select': (sel) => (isTeamSelection(sel) ? transcripts.select(sel) : structuredClone(EMPTY_TEAM_SNAPSHOT)),
      'transcripts:get-selection': () => transcripts.getSelection(),
      'usage:get-today': () => transcripts.usageToday()
    } satisfies Partial<Handlers>)
  }
  if (pickFolder) real['app:pick-folder'] = () => pickFolder()
  if (defaultCwd) real['app:get-default-cwd'] = () => defaultCwd()
  if (deps.openExternal) {
    const open = deps.openExternal
    real['app:open-external'] = async (url) => {
      const safe = safeExternalUrl(url)
      if (!safe) return { ...INVALID_ARGS }
      try {
        await open(safe)
        return { ok: true }
      } catch {
        return { ok: false, reason: 'failed' }
      }
    }
  }
  return { ...mock, ...real }
}

export function isTeamSelection(v: unknown): v is TeamSelection {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.mode === 'auto') return o.projectKey === undefined || (typeof o.projectKey === 'string' && o.projectKey.length <= 1024)
  return o.mode === 'session' && typeof o.accountId === 'string' && typeof o.sessionId === 'string'
}

const MAX_STR = 1024
const MAX_SEND = 32_000
const str = (v: unknown, max = MAX_STR): v is string => typeof v === 'string' && v.length <= max
const PERMISSION_MODES: readonly unknown[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] satisfies ControlPermissionMode[]
const MODEL_RE = /^[A-Za-z0-9._[\]-]{1,64}$/

export function isControlStartRequest(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (!str(o.cwd) || !str(o.accountId) || o.cwd === '' || o.accountId === '') return false
  if (o.confirmed !== undefined && typeof o.confirmed !== 'boolean') return false
  if (o.model !== undefined && !(typeof o.model === 'string' && MODEL_RE.test(o.model))) return false
  if (o.permissionMode !== undefined && !PERMISSION_MODES.includes(o.permissionMode)) return false
  if (o.effort !== undefined && !isEffort(o.effort)) return false
  if (o.outputStyle !== undefined && !str(o.outputStyle, 128)) return false
  if (o.resumeAt !== undefined) {
    if (!isUuid(o.resumeAt)) return false
    const rs = o.resume as Record<string, unknown> | undefined
    if (!rs || rs.kind !== 'resume' || rs.fork !== true) return false
  }
  if (o.resume !== undefined) {
    const r = o.resume
    if (typeof r !== 'object' || r === null) return false
    const rr = r as Record<string, unknown>
    if (rr.kind === 'continue') return true
    if (rr.kind !== 'resume' || !str(rr.sessionId) || rr.sessionId === '') return false
    if (rr.fork !== undefined && typeof rr.fork !== 'boolean') return false
  }
  return true
}

export function isPermissionAnswer(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (o.behavior !== 'allow' && o.behavior !== 'deny') return false
  if (o.message !== undefined && !str(o.message, 4000)) return false
  if (o.scope !== undefined && o.scope !== 'once' && o.scope !== 'session') return false
  if (o.answers !== undefined) {
    if (!isStringMap(o.answers, 4000)) return false
  }
  return true
}

const EFFORTS: readonly unknown[] = ['low', 'medium', 'high', 'xhigh', 'max'] satisfies Effort[]
export const isEffort = (v: unknown): v is Effort => EFFORTS.includes(v)

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

const MAX_MAP_ENTRIES = 50
const MAX_MAP_VALUE = 4096
function isStringMap(v: unknown, maxValue = MAX_MAP_VALUE): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const entries = Object.entries(v)
  if (entries.length > MAX_MAP_ENTRIES) return false
  return entries.every(([k, val]) => k.length > 0 && k.length <= 256 && typeof val === 'string' && val.length <= maxValue)
}

const IMAGE_TYPES: readonly unknown[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES_PER_TURN = 5
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

export function isImageAttachment(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (!IMAGE_TYPES.includes(o.mediaType)) return false
  if (typeof o.dataBase64 !== 'string' || o.dataBase64.length === 0 || o.dataBase64.length % 4 !== 0) return false
  // decoded size from the encoded length, checked before the charset scan
  const pad = o.dataBase64.endsWith('==') ? 2 : o.dataBase64.endsWith('=') ? 1 : 0
  if ((o.dataBase64.length / 4) * 3 - pad > MAX_IMAGE_BYTES) return false
  if (!BASE64_RE.test(o.dataBase64)) return false
  return o.name === undefined || str(o.name, 256)
}

export function isImageList(v: unknown): boolean {
  return Array.isArray(v) && v.length <= MAX_IMAGES_PER_TURN && v.every(isImageAttachment)
}

const MCP_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
export const isMcpName = (v: unknown): v is string => typeof v === 'string' && MCP_NAME_RE.test(v)

export function isMcpAddRequest(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (!str(o.projectRoot) || o.projectRoot === '' || !str(o.accountId) || o.accountId === '') return false
  if (!isMcpName(o.name)) return false
  if (o.scope !== 'local' && o.scope !== 'user' && o.scope !== 'project') return false
  if (o.transport !== 'stdio' && o.transport !== 'http' && o.transport !== 'sse') return false
  if (!str(o.commandOrUrl, MAX_MAP_VALUE) || o.commandOrUrl === '') return false
  if (!Array.isArray(o.args) || o.args.length > MAX_MAP_ENTRIES || !o.args.every((a) => str(a, MAX_MAP_VALUE))) return false
  return isStringMap(o.env) && isStringMap(o.headers)
}

export function isKillExternalRequest(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return str(o.accountId) && str(o.sessionId) && typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 0
}

export function isAttentionPrefs(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.mutedProjects) || o.mutedProjects.length > 200 || !o.mutedProjects.every((p) => str(p))) return false
  if (typeof o.dnd !== 'boolean' || typeof o.notifyErrors !== 'boolean') return false
  if (o.notifyIdle !== undefined && typeof o.notifyIdle !== 'boolean') return false
  return o.viewedProjectKey === undefined || str(o.viewedProjectKey)
}

function createMockHandlers(deps: HandlerDeps, getDefault: () => string, setDefault: (id: string) => void): Handlers {
  return {
    'team:get-snapshot': () => structuredClone(mockTeamSnapshot),
    'accounts:get-snapshot': () => ({ ...structuredClone(mockAccountsSnapshot), defaultAccountId: getDefault() }),
    'accounts:set-default': (accountId) => {
      if (!allStrings(accountId)) return { ...INVALID_ARGS }
      setDefault(accountId)
      return { ok: true }
    },
    'accounts:start-sign-in': (configDir) => (allStrings(configDir) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:check-sign-in': (configDir) => {
      return { configDir, step: 'waiting' }
    },
    'accounts:cancel-sign-in': (configDir) => (allStrings(configDir) ? { ok: true } : { ...INVALID_ARGS }),
    'agent:send-message': (agentId, text) => (allStrings(agentId, text) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'agent:pause': (agentId) => (allStrings(agentId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'agent:stop': (agentId) => (allStrings(agentId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'team:pause-all': () => ({ ...NOT_IMPLEMENTED }),
    'worktree:open-in-editor': (path) => (allStrings(path) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'app:get-version': () => deps.version ?? '0.0.0',
    // Phase 2 stubs; replaced by the real implementations in later tasks.
    'accounts:scan': () => structuredClone(mockAccountsSnapshot),
    'accounts:link-detected': (req) => (isObject(req) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:save-profile': (p) => (isObject(p) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:remove-profile': (accountId) => (allStrings(accountId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:set-rules': (rules) => (Array.isArray(rules) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:set-safety': (s) => (isObject(s) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:set-limit-policy': (p) => (allStrings(p) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'accounts:resolve-folder': () => ({ accountId: 'ask', ruleIndex: -1 }),
    'accounts:check-launch': () => ({
      allowed: false,
      warnings: [],
      blockedReason: 'pty-unavailable',
      matched: { accountId: 'ask', ruleIndex: -1 }
    }),
    'accounts:reopen-sign-in': (configDir) => (allStrings(configDir) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'pty:spawn': (req) => (isObject(req) ? { ok: false, reason: 'pty-unavailable' } : { ok: false, reason: 'invalid-args' }),
    'pty:write': (ptyId, data) => (allStrings(ptyId, data) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'pty:resize': (ptyId, cols, rows) =>
      allStrings(ptyId) && typeof cols === 'number' && typeof rows === 'number' ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS },
    'pty:kill': (ptyId) => (allStrings(ptyId) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'pty:list': () => [],
    'pty:get-buffer': () => ({ data: '', end: 0 }),
    'app:pick-folder': () => null,
    'app:get-default-cwd': () => '',
    'app:open-external': () => ({ ok: false, reason: 'unavailable' }),
    // Phase 3 stubs; the real transcript/usage wiring replaces these later.
    'transcripts:list-sessions': () => [],
    // Valid or invalid selection alike: the mock has no transcripts, so the answer is the empty snapshot.
    'transcripts:select': () => structuredClone(EMPTY_TEAM_SNAPSHOT),
    'transcripts:get-selection': () => ({ mode: 'auto' }),
    'usage:get-today': () => ({ day: '', byAccount: {} }),
    // Contract v4 stubs (T13 replaces them). They never start anything (R-19).
    'control:start': (req) => (isControlStartRequest(req) ? { ok: false } : { ok: false, reason: 'invalid-args' }),
    'control:send': (id, text) => (allStrings(id, text) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:interrupt': (id) => (allStrings(id) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:stop': (id) => (allStrings(id) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:answer': (id, requestId, answer) =>
      allStrings(id, requestId) && isPermissionAnswer(answer) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS },
    'control:set-model': (id, model) => (allStrings(id) && (model === null || allStrings(model)) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:set-mode': (id, mode) => (allStrings(id) && PERMISSION_MODES.includes(mode) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:list': () => [],
    'control:get-stream': () => null,
    'session:kill-external': (req) => (isKillExternalRequest(req) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    // Contract v5 stubs (R-19): never start anything, never spend tokens.
    'control:details': () => null,
    'control:send-rich': (id, text, images) =>
      allStrings(id, text) && text.length <= MAX_SEND && isImageList(images) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS },
    'control:refresh-context': (id) => (allStrings(id) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:mcp-toggle': (id, name, enabled) =>
      allStrings(id) && str(name, 64) && typeof enabled === 'boolean' ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS },
    'control:mcp-reconnect': (id, name) => (allStrings(id) && str(name, 64) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:file-suggestions': () => [],
    'control:rewind-preview': (id, uuid) =>
      allStrings(id) && isUuid(uuid)
        ? { canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'not-implemented' }
        : { canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'invalid-args' },
    'control:rewind': (id, uuid) => (allStrings(id) && isUuid(uuid) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:fork-at': (id, uuid) => (allStrings(id) && isUuid(uuid) ? { ok: false } : { ok: false, reason: 'invalid-args' }),
    'control:set-effort': (id, effort) => (allStrings(id) && (effort === null || isEffort(effort)) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:set-output-style': (id, style) =>
      allStrings(id) && (style === null || str(style, 128)) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS },
    'control:rename': (id, title) => (allStrings(id) && str(title, 200) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'control:get-plan': () => ({ exists: false }),
    'catalog:list': () => [],
    'catalog:open': (path) => (str(path, 4096) && path !== '' ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'mcp:list': () => ({ servers: [], ranAt: new Date(0).toISOString(), error: 'not-implemented' }),
    'mcp:preview-add': (req) => (isMcpAddRequest(req) ? { ...NOT_IMPLEMENTED } : { ...INVALID_ARGS }),
    'mcp:preview-remove': (root, accountId, name, scope) =>
      str(root) && root !== '' && str(accountId) && accountId !== '' && isMcpName(name) && (scope === null || scope === 'local' || scope === 'user' || scope === 'project')
        ? { ...NOT_IMPLEMENTED }
        : { ...INVALID_ARGS },
    'plugins:list': () => ({ plugins: [], error: 'not-implemented' }),
    'plugins:preview': (accountId, action, id) =>
      str(accountId) && accountId !== '' && (action === 'enable' || action === 'disable' || action === 'install' || action === 'uninstall') && str(id, 256) && id !== ''
        ? { ...NOT_IMPLEMENTED }
        : { ...INVALID_ARGS },
    'cli:apply': (previewId) => (str(previewId) && previewId !== '' ? { ok: false, reason: 'not-implemented' } : { ok: false, reason: 'invalid-args' }),
    'git:watch': (root) => ({
      root: typeof root === 'string' ? root : null,
      base: null,
      worktrees: [],
      overlaps: [],
      updatedAt: new Date(0).toISOString()
    }),
    'git:compare': () => [],
    'hooks:status': (projectRoot) => ({
      projectRoot: typeof projectRoot === 'string' ? projectRoot : null,
      settingsPath: null,
      state: 'unavailable',
      reason: 'not-implemented',
      server: { listening: false },
      eventsReceived: 0
    }),
    'hooks:preview': () => ({ ...NOT_IMPLEMENTED }),
    'hooks:apply': () => ({ ...NOT_IMPLEMENTED }),
    'attention:get': () => ({ items: [], projects: [], updatedAt: new Date(0).toISOString() }),
    'attention:get-prefs': () => ({ mutedProjects: [], dnd: false, notifyErrors: false }),
    'attention:set-prefs': () => ({ ...NOT_IMPLEMENTED })
  }
}

export function registerIpcHandlers(ipc: Pick<IpcMain, 'handle'>, handlers: Handlers = createHandlers()): void {
  for (const channel of INVOKE_CHANNELS) {
    const fn = handlers[channel] as (...args: unknown[]) => unknown
    ipc.handle(channel, (_event, ...args: unknown[]) => fn(...args))
  }
}
