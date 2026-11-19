import { posix, win32 } from 'node:path'
import type { HostEnv, WriteFs } from '../contracts'
import type { PtyManagerApi } from '../pty/types'
import { ACCOUNT_COLORS } from '@shared/accountsDefaults'
import { isFallbackPattern, matchFolder, type MatchOptions } from '@shared/folderRules'
import { checkLaunch as checkLaunchRules } from '@shared/safety'
import type {
  AccountKind,
  AccountProfile,
  AccountsFile,
  AccountsSnapshot,
  AccountView,
  FolderResolution,
  FolderRule,
  LaunchCheck,
  LimitPolicy,
  LinkDetectedRequest,
  OkResult,
  OkWithId,
  ProfileInput,
  PtyInfo,
  PtySpawnRequest,
  PtySpawnResult,
  RunningSession,
  SafetySettings
} from '@shared/types'
import { readDisplayFields } from './claudeJson'
import { detectLogins, toDetectedLogin, type DetectedDir } from './detect'
import { expandHome, isAbsoluteFor, isDefaultConfigDir, samePath, toDisplayPath } from './paths'
import { loadAccountsFile, makeProfileId, saveAccountsFile } from './profileStore'
import { createSignInController, type SignInController, type WatchFile } from './signIn'

export interface AccountsService {
  snapshot(): Promise<AccountsSnapshot>
  scan(): Promise<AccountsSnapshot>
  linkDetected(r: LinkDetectedRequest): Promise<OkWithId>
  saveProfile(p: ProfileInput): Promise<OkWithId>
  removeProfile(id: string): Promise<OkResult>
  setDefault(id: string): Promise<OkResult>
  setRules(r: FolderRule[]): Promise<OkResult>
  setSafety(s: SafetySettings): Promise<OkResult>
  setLimitPolicy(p: LimitPolicy): Promise<OkResult>
  resolveFolder(folder: string): Promise<FolderResolution>
  checkLaunch(folder: string, accountId: string): Promise<LaunchCheck>
  launchClaude(req: PtySpawnRequest): Promise<PtySpawnResult>
  signIn: SignInController
  onChanged(cb: (s: AccountsSnapshot) => void): () => void
}

const INVALID: OkResult = { ok: false, reason: 'invalid-args' }
const COLOR_RE = /^#[0-9a-f]{6}$/i
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isKind = (v: unknown): v is AccountKind => v === 'company' || v === 'personal'

export function createAccountsService(deps: {
  fs: WriteFs
  host: HostEnv
  userDataDir: string
  pty: PtyManagerApi
  watchFile: WatchFile
  claudeFound: () => boolean
}): AccountsService {
  const { fs, host, pty } = deps
  const { home, platform } = host
  const match: MatchOptions = { home, caseInsensitive: platform !== 'linux' }
  const pathMod = platform === 'win32' ? win32 : posix
  const signIn = createSignInController({ pty, fs, host, watchFile: deps.watchFile })
  const listeners = new Set<(s: AccountsSnapshot) => void>()

  let file: AccountsFile | null = null
  let detected: DetectedDir[] | null = null
  let chain: Promise<unknown> = Promise.resolve()

  const ensure = async (): Promise<AccountsFile> => {
    file ??= (await loadAccountsFile(fs, deps.userDataDir)).data
    return file
  }
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)
    return run
  }

  const claudeSessions = (): PtyInfo[] => pty.list().filter((p) => p.purpose === 'claude' && p.exitCode === undefined)

  const ruleFolders = (rules: readonly FolderRule[]): string[] => {
    const out: string[] = []
    for (const r of rules) {
      const idx = r.pattern.search(/[*?]/)
      const prefix = (idx < 0 ? r.pattern : r.pattern.slice(0, idx)).trim().replace(/[\\/]+$/, '')
      if (!prefix) continue
      const abs = expandHome(prefix, home)
      if (isAbsoluteFor(abs, platform) && !out.includes(abs)) out.push(abs)
    }
    return out
  }

  const runDetect = async (f: AccountsFile): Promise<DetectedDir[]> => {
    detected = await detectLogins(fs, host, { extraWorkspaceFolders: ruleFolders(f.rules) })
    return detected
  }

  /** Normalise a user-supplied config dir into its display form; null when empty or not absolute (after ~ expansion). */
  const displayDir = (dir: string): string | null => {
    const t = dir.trim()
    if (!t) return null
    const abs = expandHome(t, home)
    if (!isAbsoluteFor(abs, platform)) return null
    return isDefaultConfigDir(abs, home, platform) ? '~/.claude' : toDisplayPath(abs, home, platform)
  }

  async function buildSnapshot(): Promise<AccountsSnapshot> {
    const f = await ensure()
    const dets = detected ?? (await runDetect(f))
    for (const d of dets) {
      if (isAbsoluteFor(d.absPath, platform)) d.display = await readDisplayFields(fs, d.absPath, home, platform)
    }
    const running = claudeSessions()
    const locked = (id: string): boolean => f.safety.lockAccountOnTeamStart && running.some((s) => s.accountId === id)

    const accounts: AccountView[] = []
    for (const p of f.profiles) {
      const det = dets.find((d) => samePath(d.configDir, p.configDir, home, platform))
      const abs = expandHome(p.configDir, home)
      const display = det
        ? det.display
        : isAbsoluteFor(abs, platform)
          ? await readDisplayFields(fs, abs, home, platform)
          : { signedIn: false, missing: true }
      const view: AccountView = {
        ...p,
        folderRules: f.rules.filter((r) => r.accountId === p.id),
        signedIn: display.signedIn,
        isDefaultDir: isAbsoluteFor(abs, platform) && isDefaultConfigDir(abs, home, platform)
      }
      if (display.email !== undefined) view.email = display.email
      if (display.org !== undefined) view.org = display.org
      if (locked(p.id)) view.locked = true
      accounts.push(view)
    }

    const sessions: RunningSession[] = running.map((s) => {
      const out: RunningSession = {
        teamName: pathMod.basename(s.cwd.replace(/[\\/]+$/, '')) || s.cwd,
        path: toDisplayPath(s.cwd, home, platform),
        accountId: s.accountId ?? '',
        agentCount: 1,
        ptyId: s.id
      }
      return out
    })
    const newest = running.reduce<PtyInfo | undefined>((a, b) => (!a || b.startedAt >= a.startedAt ? b : a), undefined)
    const activeAccountId = newest?.accountId ?? f.defaultAccountId ?? ''

    return {
      accounts,
      defaultAccountId: f.defaultAccountId ?? '',
      activeAccountId,
      detected: dets.map((d) => toDetectedLogin(d, f.profiles, home, platform)),
      rules: f.rules.map((r) => ({ ...r })),
      safety: { ...f.safety },
      limitPolicy: f.limitPolicy,
      sessions,
      ptyAvailable: await pty.available(),
      claudeFound: deps.claudeFound()
    }
  }

  async function emitChanged(): Promise<void> {
    if (listeners.size === 0) return
    let snap: AccountsSnapshot
    try {
      snap = await buildSnapshot()
    } catch {
      return
    }
    for (const cb of [...listeners]) {
      try {
        cb(snap)
      } catch {
        // listener errors must not break the service
      }
    }
  }

  /** Apply a change to the accounts file, persist it, then notify. */
  function mutate<T extends OkResult>(fn: (f: AccountsFile) => T | Promise<T>): Promise<T> {
    return serial(async () => {
      const f = await ensure()
      const draft: AccountsFile = structuredClone(f)
      const r = await fn(draft)
      if (!r.ok) return r
      try {
        await saveAccountsFile(fs, deps.userDataDir, draft)
      } catch {
        return { ...r, ok: false, reason: 'save-failed' }
      }
      file = draft
      await emitChanged()
      return r
    })
  }

  const withRules = (f: AccountsFile): void => {
    for (const p of f.profiles) p.folderRules = f.rules.filter((r) => r.accountId === p.id)
  }

  pty.onExit(() => void emitChanged())
  signIn.onStatus((s) => {
    if (s.step === 'done') void emitChanged()
  })

  const validProfile = (p: ProfileInput): { name: string; color: string; dir: string; kind?: AccountKind } | null => {
    if (!isRecord(p)) return null
    if (typeof p.name !== 'string' || typeof p.color !== 'string' || typeof p.configDir !== 'string') return null
    const name = p.name.trim().slice(0, 40).trim()
    const dir = displayDir(p.configDir)
    if (!name || !dir || !COLOR_RE.test(p.color)) return null
    if (p.kind !== undefined && !isKind(p.kind)) return null
    return { name, color: p.color, dir, ...(p.kind !== undefined ? { kind: p.kind } : {}) }
  }

  const checkWith = (f: AccountsFile, folder: string, accountId: string): LaunchCheck =>
    checkLaunchRules({
      folder: String(folder),
      accountId,
      profiles: f.profiles,
      rules: f.rules,
      safety: f.safety,
      sessions: claudeSessions().map((s) => ({ path: s.cwd, accountId: s.accountId ?? '' })),
      match
    })
  const check = async (folder: string, accountId: string): Promise<LaunchCheck> => checkWith(await serial(ensure), folder, accountId)

  /** A non-empty config dir that cannot be used because it is not absolute. */
  const isBadFolder = (dir: unknown): boolean => typeof dir === 'string' && dir.trim() !== '' && displayDir(dir) === null

  return {
    signIn,
    snapshot: () => serial(buildSnapshot),
    scan: () =>
      serial(async () => {
        await runDetect(await ensure())
        return buildSnapshot()
      }),

    async linkDetected(req) {
      if (!isRecord(req) || typeof req.configDir !== 'string') return { ...INVALID }
      const dir = displayDir(req.configDir)
      if (!dir) return isBadFolder(req.configDir) ? { ok: false, reason: 'invalid-folder' } : { ...INVALID }
      if (req.accountId !== undefined && typeof req.accountId !== 'string') return { ...INVALID }
      const r = await mutate<OkWithId>(async (f) => {
        if (req.accountId !== undefined) {
          const p = f.profiles.find((x) => x.id === req.accountId)
          if (!p) return { ok: false, reason: 'unknown-account' }
          p.configDir = dir
          return { ok: true, accountId: p.id }
        }
        const existing = f.profiles.find((x) => samePath(x.configDir, dir, home, platform))
        if (existing) return { ok: true, accountId: existing.id }
        const abs = expandHome(dir, home)
        const fields = isAbsoluteFor(abs, platform) ? await readDisplayFields(fs, abs, home, platform) : { signedIn: false }
        const org = 'org' in fields ? fields.org : undefined
        const reqName = typeof req.name === 'string' ? req.name.trim().slice(0, 40).trim() : ''
        const name = reqName || org?.slice(0, 40).trim() || `Account ${f.profiles.length + 1}`
        const color =
          typeof req.color === 'string' && COLOR_RE.test(req.color)
            ? req.color
            : ACCOUNT_COLORS[f.profiles.length % ACCOUNT_COLORS.length]!
        const id = makeProfileId(
          name,
          f.profiles.map((x) => x.id)
        )
        const profile: AccountProfile = { id, name, color, configDir: dir, folderRules: [] }
        if (isKind(req.kind)) profile.kind = req.kind
        f.profiles.push(profile)
        f.defaultAccountId ??= id
        return { ok: true, accountId: id }
      })
      return r
    },

    async saveProfile(p) {
      const v = validProfile(p)
      if (!v) return isRecord(p) && isBadFolder(p.configDir) ? { ok: false, reason: 'invalid-folder' } : { ...INVALID }
      return mutate<OkWithId>((f) => {
        if (p.id !== undefined) {
          const cur = f.profiles.find((x) => x.id === p.id)
          if (!cur) return { ok: false, reason: 'unknown-account' }
          cur.name = v.name
          cur.color = v.color
          cur.configDir = v.dir
          if (v.kind) cur.kind = v.kind
          else delete cur.kind
          return { ok: true, accountId: cur.id }
        }
        const id = makeProfileId(
          v.name,
          f.profiles.map((x) => x.id)
        )
        const profile: AccountProfile = { id, name: v.name, color: v.color, configDir: v.dir, folderRules: [] }
        if (v.kind) profile.kind = v.kind
        f.profiles.push(profile)
        f.defaultAccountId ??= id
        return { ok: true, accountId: id }
      })
    },

    async removeProfile(id) {
      if (typeof id !== 'string') return { ...INVALID }
      return mutate((f) => {
        if (!f.profiles.some((p) => p.id === id)) return { ok: false, reason: 'unknown-account' }
        f.profiles = f.profiles.filter((p) => p.id !== id)
        f.rules = f.rules.filter((r) => r.accountId !== id)
        if (f.defaultAccountId === id) f.defaultAccountId = null
        withRules(f)
        return { ok: true }
      })
    },

    async setDefault(id) {
      if (typeof id !== 'string') return { ...INVALID }
      return mutate((f) => {
        if (!f.profiles.some((p) => p.id === id)) return { ok: false, reason: 'unknown-account' }
        f.defaultAccountId = id
        return { ok: true }
      })
    },

    async setRules(rules) {
      if (!Array.isArray(rules)) return { ...INVALID }
      return mutate((f) => {
        const ids = new Set(f.profiles.map((p) => p.id))
        f.rules = rules
          .filter(
            (r): r is FolderRule =>
              isRecord(r) &&
              typeof r.pattern === 'string' &&
              r.pattern.trim() !== '' &&
              typeof r.accountId === 'string' &&
              typeof r.note === 'string' &&
              !isFallbackPattern(r.pattern) &&
              (r.accountId === 'ask' || ids.has(r.accountId))
          )
          .map((r) => ({ pattern: r.pattern, accountId: r.accountId, note: r.note }))
        withRules(f)
        return { ok: true }
      })
    },

    async setSafety(s) {
      if (
        !isRecord(s) ||
        typeof s.warnPersonalInCompanyFolder !== 'boolean' ||
        typeof s.showAccountColorEdge !== 'boolean' ||
        typeof s.lockAccountOnTeamStart !== 'boolean'
      ) {
        return { ...INVALID }
      }
      return mutate((f) => {
        f.safety = {
          warnPersonalInCompanyFolder: s.warnPersonalInCompanyFolder,
          showAccountColorEdge: s.showAccountColorEdge,
          lockAccountOnTeamStart: s.lockAccountOnTeamStart
        }
        return { ok: true }
      })
    },

    async setLimitPolicy(p) {
      if (p !== 'pause' && p !== 'wait' && p !== 'switch') return { ...INVALID }
      return mutate((f) => {
        f.limitPolicy = p
        return { ok: true }
      })
    },

    async resolveFolder(folder) {
      const f = await serial(ensure)
      return matchFolder(f.rules, String(folder), match)
    },

    checkLaunch: check,

    async launchClaude(req) {
      if (!isRecord(req) || typeof req.cwd !== 'string' || typeof req.accountId !== 'string') {
        return { ok: false, reason: 'invalid-args' }
      }
      const cwd = expandHome(req.cwd.trim(), home)
      if (!isAbsoluteFor(cwd, platform) || !(await fs.exists(cwd))) return { ok: false, reason: 'invalid-folder' }
      // Check and spawn in one serial block so a second quick launch sees the first session.
      const out = await serial(async (): Promise<PtySpawnResult> => {
        const f = await ensure()
        const chk = checkWith(f, cwd, req.accountId)
        if (!chk.allowed) return { ok: false, reason: chk.blockedReason ?? 'unknown-account' }
        if (chk.warnings.length > 0 && req.confirmed !== true) {
          return { ok: false, reason: 'needs-confirmation', warnings: chk.warnings }
        }
        const profile = f.profiles.find((p) => p.id === req.accountId)
        if (!profile) return { ok: false, reason: 'unknown-account' }
        const abs = expandHome(profile.configDir, home)
        if (!isAbsoluteFor(abs, platform)) return { ok: false, reason: 'spawn-failed' }
        const r = await pty.spawnClaude({
          purpose: 'claude',
          cwd,
          configDirAbs: isDefaultConfigDir(abs, home, platform) ? null : abs,
          configDirDisplay: profile.configDir,
          accountId: profile.id,
          cols: req.cols,
          rows: req.rows
        })
        return r.ok ? { ok: true, ptyId: r.id } : { ok: false, reason: r.reason }
      })
      if (out.ok) await emitChanged()
      return out
    },

    onChanged(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    }
  }
}
