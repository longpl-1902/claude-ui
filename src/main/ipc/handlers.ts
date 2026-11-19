import type { IpcMain } from 'electron'
import { INVOKE_CHANNELS, type InvokeChannel, type IpcInvokeMap } from '@shared/ipc'
import { safeExternalUrl } from '@shared/externalUrl'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import { EMPTY_TEAM_SNAPSHOT } from '@shared/teamDefaults'
import type {
  AttentionPrefs, AttentionSnapshot, ControlPermissionMode, KillExternalRequest, OkResult, PtySpawnRequest, TeamSelection
} from '@shared/types'
import type { AccountsService } from '../accounts/accountsService'
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
    deps.externalKiller || deps.openInEditor || deps.attention || deps.openExternal
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
        return accounts.launchControlled(req)
      }
    }
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
      'team:pause-all': () => {
        const n = control.interruptAll()
        return n > 0 ? { ok: true, reason: String(n) } : { ok: false, reason: 'nothing-running' }
      }
    } satisfies Partial<Handlers>)
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
  return o.scope === undefined || o.scope === 'once' || o.scope === 'session'
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
