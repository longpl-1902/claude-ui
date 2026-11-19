import { describe, expect, it, vi } from 'vitest'
import { createAccountsService } from '../../../src/main/accounts/accountsService'
import type { WatchFile } from '../../../src/main/accounts/signIn'
import type { HostEnv } from '../../../src/main/contracts'
import type { PtyManagerApi } from '../../../src/main/pty/types'
import type { AccountsSnapshot, PtyInfo } from '@shared/types'
import { createMemoryFs } from './memoryFs'

const HOME = 'C:/Users/u'
const USERDATA = 'C:/Users/u/AppData/Roaming/agent-console'
const host: HostEnv = { home: HOME, platform: 'win32', env: {}, appData: `${HOME}/AppData/Roaming` }
const fwd = (s: string): string => s.replace(/\\/g, '/')

const claudeJson = JSON.stringify({
  oauthAccount: { emailAddress: 'me@example.com', organizationName: 'Example Org', planDisplayName: 'FAKE-PLAN', accessToken: 'FAKE-TOKEN' }
})

function setup(opts: { files?: Record<string, string>; dirs?: string[]; sessions?: PtyInfo[]; ptyAvailable?: boolean; claudeFound?: boolean } = {}) {
  const fs = createMemoryFs(
    { [`${HOME}/.claude.json`]: claudeJson, ...(opts.files ?? {}) },
    [`${HOME}/.claude`, `${HOME}/work/x`, ...(opts.dirs ?? [])],
    { caseInsensitive: true }
  )
  const exitCbs: Array<(id: string, code: number) => void> = []
  const sessions = opts.sessions ?? []
  const pty = {
    available: vi.fn(async () => opts.ptyAvailable ?? true),
    spawnClaude: vi.fn(async () => ({ ok: true, id: 'p9' })),
    write: vi.fn(() => true),
    resize: vi.fn(() => true),
    kill: vi.fn(() => true),
    buffer: vi.fn(() => ''),
    list: vi.fn(() => sessions),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn((cb: (id: string, code: number) => void) => (exitCbs.push(cb), () => undefined)),
    disposeAll: vi.fn()
  } as unknown as PtyManagerApi & { spawnClaude: ReturnType<typeof vi.fn> }
  const watchers: Array<() => void> = []
  const watchFile: WatchFile = (_f, onChange) => (watchers.push(onChange), { close: () => undefined })
  const svc = createAccountsService({ fs, host, userDataDir: USERDATA, pty, watchFile, claudeFound: () => opts.claudeFound ?? true })
  return { svc, fs, pty, sessions, exitCbs, watchers }
}

const session = (over: Partial<PtyInfo>): PtyInfo => ({
  id: 'p1',
  purpose: 'claude',
  cwd: `${HOME}/work/x`,
  accountId: 'work',
  configDir: '~/.claude-work',
  pid: 1,
  startedAt: '2026-11-19T10:00:00.000Z',
  ...over
})

async function twoAccounts(t = setup({ dirs: [`${HOME}/.claude-work`] })) {
  const work = await t.svc.saveProfile({ name: 'Work', color: '#6E9BF0', configDir: '~/.claude-work', kind: 'company' })
  const me = await t.svc.saveProfile({ name: 'Me', color: '#F2A541', configDir: '~/.claude', kind: 'personal' })
  await t.svc.setRules([{ pattern: '~/work/**', accountId: work.accountId!, note: '' }])
  return { ...t, work: work.accountId!, me: me.accountId! }
}

describe('R-02/R-03 accountsService snapshot', () => {
  it('R-03 a fresh snapshot detects ~/.claude with email + org, no plan, no tokens, and exposes pty/claude flags', async () => {
    const { svc } = setup()
    const s = await svc.snapshot()
    const d = s.detected.find((x) => x.configDir === '~/.claude')!
    expect(d).toMatchObject({ email: 'me@example.com', org: 'Example Org', signedIn: true })
    expect(s.accounts).toEqual([])
    expect(s.ptyAvailable).toBe(true)
    expect(s.claudeFound).toBe(true)
    expect(s.sessions).toEqual([])
    expect(JSON.stringify(s)).not.toMatch(/FAKE|planDisplayName/)
  })

  it('R-09 reports ptyAvailable=false and claudeFound=false when they are not', async () => {
    const s = await setup({ ptyAvailable: false, claudeFound: false }).svc.snapshot()
    expect(s.ptyAvailable).toBe(false)
    expect(s.claudeFound).toBe(false)
  })

  it('R-03 a linked account shows email and org from the file; plan and tokensToday stay undefined', async () => {
    const { svc } = setup()
    const r = await svc.linkDetected({ configDir: '~/.claude' })
    expect(r.ok).toBe(true)
    const s = await svc.snapshot()
    expect(s.accounts).toHaveLength(1)
    const a = s.accounts[0]
    expect(a).toMatchObject({ id: r.accountId, email: 'me@example.com', org: 'Example Org', signedIn: true, isDefaultDir: true })
    expect(a!.plan).toBeUndefined()
    expect(a!.tokensToday).toBeUndefined()
    expect(s.detected.find((d) => d.configDir === '~/.claude')?.linkedAccountId).toBe(r.accountId)
  })
})

describe('R-12 accountsService mutations', () => {
  it('R-12 linkDetected creates a named profile, makes the first one the default, and emits changed', async () => {
    const { svc } = setup()
    const changed = vi.fn()
    svc.onChanged(changed)
    const r = await svc.linkDetected({ configDir: '~/.claude' })
    const s = await svc.snapshot()
    expect(s.accounts[0]!.name).toBe('Example Org')
    expect(s.defaultAccountId).toBe(r.accountId)
    expect(changed).toHaveBeenCalled()
    expect((changed.mock.calls.at(-1)![0] as AccountsSnapshot).accounts).toHaveLength(1)
  })

  it('R-12 linkDetected with an accountId only repoints that profile', async () => {
    const t = await twoAccounts()
    const r = await t.svc.linkDetected({ configDir: '~/.claude-other', accountId: t.work })
    expect(r).toMatchObject({ ok: true, accountId: t.work })
    const s = await t.svc.snapshot()
    expect(s.accounts.find((a) => a.id === t.work)?.configDir).toBe('~/.claude-other')
    expect(s.accounts).toHaveLength(2)
  })

  it('R-12 saveProfile creates then updates; saveProfile with an id edits in place', async () => {
    const { svc } = setup()
    const a = await svc.saveProfile({ name: 'Work', color: '#6E9BF0', configDir: '~/.claude-work', kind: 'company' })
    expect(a.ok).toBe(true)
    const b = await svc.saveProfile({ id: a.accountId, name: 'Work 2', color: '#C792EA', configDir: '~/.claude-work', kind: 'personal' })
    expect(b.accountId).toBe(a.accountId)
    const s = await svc.snapshot()
    expect(s.accounts).toHaveLength(1)
    expect(s.accounts[0]).toMatchObject({ name: 'Work 2', color: '#C792EA' })
  })

  it('R-12 saveProfile rejects invalid input (empty name, bad color)', async () => {
    const { svc } = setup()
    expect((await svc.saveProfile({ name: '', color: '#6E9BF0', configDir: '~/.claude-x' })).ok).toBe(false)
    expect((await svc.saveProfile({ name: 'X', color: 'nope', configDir: '~/.claude-x' })).ok).toBe(false)
    expect((await svc.snapshot()).accounts).toEqual([])
  })

  it('R-12 saveProfile and linkDetected with a relative config dir -> invalid-folder and nothing is written', async () => {
    const { svc, fs } = setup()
    expect(await svc.saveProfile({ name: 'X', color: '#6E9BF0', configDir: 'foo' })).toMatchObject({ ok: false, reason: 'invalid-folder' })
    expect(await svc.linkDetected({ configDir: 'foo/bar' })).toMatchObject({ ok: false, reason: 'invalid-folder' })
    expect(await svc.saveProfile({ name: 'X', color: '#6E9BF0', configDir: '   ' })).toMatchObject({ ok: false, reason: 'invalid-args' })
    expect(fs.writes).toEqual([])
    expect((await svc.snapshot()).accounts).toEqual([])
  })

  it('R-12 removeProfile removes its rules and clears the default', async () => {
    const t = await twoAccounts()
    await t.svc.setDefault(t.work)
    expect(await t.svc.removeProfile(t.work)).toMatchObject({ ok: true })
    const s = await t.svc.snapshot()
    expect(s.accounts.map((a) => a.id)).toEqual([t.me])
    expect(s.rules).toEqual([])
    expect(s.defaultAccountId).not.toBe(t.work)
    expect((await t.svc.removeProfile('ghost')).ok).toBe(false)
  })

  it('R-12 setDefault accepts a known account and rejects an unknown one', async () => {
    const t = await twoAccounts()
    expect((await t.svc.setDefault(t.me)).ok).toBe(true)
    expect((await t.svc.snapshot()).defaultAccountId).toBe(t.me)
    expect((await t.svc.setDefault('ghost')).ok).toBe(false)
  })

  it('R-07 setRules drops rules for unknown accounts and fallback patterns, keeps ask and order', async () => {
    const t = await twoAccounts()
    await t.svc.setRules([
      { pattern: '~/a/**', accountId: t.me, note: '' },
      { pattern: '~/ghost/**', accountId: 'ghost', note: '' },
      { pattern: 'Anything else', accountId: t.work, note: '' },
      { pattern: '*', accountId: t.work, note: '' },
      { pattern: '~/b/**', accountId: 'ask', note: '' }
    ])
    expect((await t.svc.snapshot()).rules.map((r) => r.pattern)).toEqual(['~/a/**', '~/b/**'])
  })

  it('R-12 setSafety and setLimitPolicy persist to accounts.json', async () => {
    const t = setup()
    await t.svc.setSafety({ warnPersonalInCompanyFolder: false, showAccountColorEdge: false, lockAccountOnTeamStart: false })
    await t.svc.setLimitPolicy('wait')
    const s = await t.svc.snapshot()
    expect(s.safety.lockAccountOnTeamStart).toBe(false)
    expect(s.limitPolicy).toBe('wait')
    const saved = JSON.parse(t.fs.content(`${USERDATA}/accounts.json`)!)
    expect(saved.limitPolicy).toBe('wait')
    expect(saved.safety.warnPersonalInCompanyFolder).toBe(false)
  })

  it('R-12 setLimitPolicy rejects an unknown policy', async () => {
    const { svc } = setup()
    expect((await svc.setLimitPolicy('explode' as never)).ok).toBe(false)
  })

  it('R-06 a second service instance over the same fs sees the persisted profiles', async () => {
    const t = await twoAccounts()
    const svc2 = createAccountsService({
      fs: t.fs,
      host,
      userDataDir: USERDATA,
      pty: t.pty,
      watchFile: () => ({ close: () => undefined }),
      claudeFound: () => true
    })
    expect((await svc2.snapshot()).accounts.map((a) => a.name).sort()).toEqual(['Me', 'Work'])
  })
})

describe('R-07/R-08 accountsService folder resolution and launch checks', () => {
  it('R-07 resolveFolder uses the stored rules and falls back to ask', async () => {
    const t = await twoAccounts()
    expect(await t.svc.resolveFolder(`${HOME}/work/x`)).toMatchObject({ accountId: t.work, ruleIndex: 0 })
    expect(await t.svc.resolveFolder('D:/elsewhere')).toEqual({ accountId: 'ask', ruleIndex: -1 })
  })

  it('R-08 a personal account in a company folder is allowed with the warning', async () => {
    const t = await twoAccounts()
    const r = await t.svc.checkLaunch(`${HOME}/work/x`, t.me)
    expect(r).toMatchObject({ allowed: true, warnings: ['personal-in-company-folder'] })
  })

  it('R-08 an unknown account is blocked', async () => {
    const t = await twoAccounts()
    expect((await t.svc.checkLaunch(`${HOME}/work/x`, 'ghost')).blockedReason).toBe('unknown-account')
  })

  it('R-08 a running claude session locks the folder against a different account', async () => {
    const t = await twoAccounts()
    t.sessions.push(session({ accountId: t.work }))
    const r = await t.svc.checkLaunch(`${HOME}/work/x`, t.me)
    expect(r).toMatchObject({ allowed: false, blockedReason: 'account-locked' })
  })

  it('R-08 a lock toggle off lets a different account in', async () => {
    const t = await twoAccounts()
    await t.svc.setSafety({ warnPersonalInCompanyFolder: false, showAccountColorEdge: true, lockAccountOnTeamStart: false })
    t.sessions.push(session({ accountId: t.work }))
    expect((await t.svc.checkLaunch(`${HOME}/work/x`, t.me)).allowed).toBe(true)
  })

  it('R-08 login ptys are not sessions and never lock', async () => {
    const t = await twoAccounts()
    await t.svc.setSafety({ warnPersonalInCompanyFolder: false, showAccountColorEdge: true, lockAccountOnTeamStart: true })
    t.sessions.push(session({ purpose: 'login', accountId: t.work }))
    expect((await t.svc.checkLaunch(`${HOME}/work/x`, t.me)).allowed).toBe(true)
  })
})

describe('R-13 accountsService launchClaude', () => {
  it('R-13 a nonexistent or relative cwd -> invalid-folder', async () => {
    const t = await twoAccounts()
    expect(await t.svc.launchClaude({ cwd: 'D:/does/not/exist', accountId: t.work, cols: 80, rows: 24 })).toMatchObject({
      ok: false,
      reason: 'invalid-folder'
    })
    expect(await t.svc.launchClaude({ cwd: 'relative/x', accountId: t.work, cols: 80, rows: 24 })).toMatchObject({
      ok: false,
      reason: 'invalid-folder'
    })
    expect(t.pty.spawnClaude).not.toHaveBeenCalled()
  })

  it('R-08 a locked folder -> account-locked, nothing spawned', async () => {
    const t = await twoAccounts()
    t.sessions.push(session({ accountId: t.work }))
    const r = await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.me, cols: 80, rows: 24, confirmed: true })
    expect(r).toMatchObject({ ok: false, reason: 'account-locked' })
    expect(t.pty.spawnClaude).not.toHaveBeenCalled()
  })

  it('R-08 a warned launch needs confirmed:true, then spawns', async () => {
    const t = await twoAccounts()
    const first = await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.me, cols: 80, rows: 24 })
    expect(first).toMatchObject({ ok: false, reason: 'needs-confirmation', warnings: ['personal-in-company-folder'] })
    expect(t.pty.spawnClaude).not.toHaveBeenCalled()
    const second = await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.me, cols: 80, rows: 24, confirmed: true })
    expect(second).toMatchObject({ ok: true, ptyId: 'p9' })
    expect(t.pty.spawnClaude).toHaveBeenCalledTimes(1)
  })

  it('R-09 spawn passes configDirAbs for a custom dir and null for the default dir', async () => {
    const t = await twoAccounts()
    await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.work, cols: 100, rows: 30 })
    const a = t.pty.spawnClaude.mock.calls[0]![0] as Record<string, unknown>
    expect(a).toMatchObject({ purpose: 'claude', accountId: t.work, configDirDisplay: '~/.claude-work', cols: 100, rows: 30 })
    expect(fwd(a.configDirAbs as string)).toBe(`${HOME}/.claude-work`)
    expect(fwd(a.cwd as string)).toBe(`${HOME}/work/x`)

    await t.svc.setSafety({ warnPersonalInCompanyFolder: false, showAccountColorEdge: true, lockAccountOnTeamStart: true })
    await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.me, cols: 80, rows: 24 })
    expect((t.pty.spawnClaude.mock.calls[1]![0] as { configDirAbs: unknown }).configDirAbs).toBeNull()
  })

  it('R-09 a failed spawn maps the reason', async () => {
    const t = await twoAccounts()
    t.pty.spawnClaude.mockResolvedValueOnce({ ok: false, reason: 'claude-not-found' })
    expect(await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.work, cols: 80, rows: 24 })).toMatchObject({
      ok: false,
      reason: 'claude-not-found'
    })
  })

  it('R-13 a launch emits changed', async () => {
    const t = await twoAccounts()
    const changed = vi.fn()
    t.svc.onChanged(changed)
    await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.work, cols: 80, rows: 24 })
    expect(changed).toHaveBeenCalled()
  })

  it('R-12 a running session appears in the snapshot, locks its account and becomes the active account', async () => {
    const t = await twoAccounts()
    t.sessions.push(session({ id: 'p1', accountId: t.work, cwd: `${HOME}/work/x` }))
    const s = await t.svc.snapshot()
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0]).toMatchObject({ accountId: t.work, ptyId: 'p1', teamName: 'x', agentCount: 1 })
    expect(s.sessions[0]!.path).toBe('~/work/x')
    expect(s.accounts.find((a) => a.id === t.work)?.locked).toBe(true)
    expect(s.accounts.find((a) => a.id === t.me)?.locked).toBeFalsy()
    expect(s.activeAccountId).toBe(t.work)
  })

  it('R-12 with no session the active account is the default account', async () => {
    const t = await twoAccounts()
    await t.svc.setDefault(t.me)
    expect((await t.svc.snapshot()).activeAccountId).toBe(t.me)
  })

  it('R-08 two quick launches for different accounts in one folder: the second sees the first session and is locked', async () => {
    const t = await twoAccounts()
    await t.svc.setSafety({ warnPersonalInCompanyFolder: true, showAccountColorEdge: true, lockAccountOnTeamStart: true })
    t.pty.spawnClaude.mockImplementation(async (r: { accountId?: string; cwd: string }) => {
      await new Promise((res) => setTimeout(res, 5))
      t.sessions.push(session({ id: `s${t.sessions.length}`, accountId: r.accountId, cwd: r.cwd }))
      return { ok: true, id: `s${t.sessions.length}` }
    })
    const cwd = `${HOME}/work/x`
    const [a, b] = await Promise.all([
      t.svc.launchClaude({ cwd, accountId: t.work, cols: 80, rows: 24 }),
      t.svc.launchClaude({ cwd, accountId: t.me, cols: 80, rows: 24, confirmed: true })
    ])
    expect(a.ok).toBe(true)
    expect(b).toMatchObject({ ok: false, reason: 'account-locked' })
    expect(t.pty.spawnClaude).toHaveBeenCalledTimes(1)
  })

  it('R-10 a sign-in that completes via the file watcher emits changed (before the login process exits)', async () => {
    const t = setup()
    await t.svc.signIn.start('~/.claude-new')
    const changed = vi.fn()
    t.svc.onChanged(changed)
    t.fs.setFile(`${HOME}/.claude-new/.claude.json`, claudeJson)
    t.watchers[0]!()
    await new Promise((r) => setTimeout(r, 20))
    expect(t.svc.signIn.status('~/.claude-new').step).toBe('done')
    expect(changed).toHaveBeenCalled()
  })

  it('R-13 a pty exit triggers a changed event', async () => {
    const t = await twoAccounts()
    const changed = vi.fn()
    t.svc.onChanged(changed)
    t.exitCbs.forEach((cb) => cb('p1', 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(changed).toHaveBeenCalled()
  })
})

describe('R-14 accountsService writes', () => {
  it('R-14 every write lands under userDataDir (nothing in ~/.claude*, nothing in VS Code settings)', async () => {
    const t = await twoAccounts()
    await t.svc.linkDetected({ configDir: '~/.claude' })
    await t.svc.setSafety({ warnPersonalInCompanyFolder: true, showAccountColorEdge: false, lockAccountOnTeamStart: true })
    await t.svc.setLimitPolicy('switch')
    await t.svc.scan()
    await t.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.work, cols: 80, rows: 24 })
    await t.svc.signIn.start('~/.claude-work')
    await t.svc.signIn.cancel('~/.claude-work')
    expect(t.fs.writes.length).toBeGreaterThan(0)
    for (const w of t.fs.writes) expect(fwd(w).toLowerCase().startsWith(USERDATA.toLowerCase())).toBe(true)
  })
})

describe('R-04 accountsService launchControlled', () => {
  function withControl(t: Awaited<ReturnType<typeof twoAccounts>>, running: { cwd: string; accountId: string }[] = []) {
    const create = vi.fn((o: { cwd: string; accountId: string }) => ({ id: 'c1', ...o }))
    const svc = createAccountsService({
      fs: t.fs,
      host,
      userDataDir: USERDATA,
      pty: t.pty,
      watchFile: () => ({ close: () => undefined }),
      claudeFound: () => true,
      control: { create: create as never, running: () => running }
    })
    return { svc, create, running }
  }

  it('R-04 creates a controlled session with the profile config dir and never spawns a pty', async () => {
    const t = await twoAccounts()
    const c = withControl(t)
    const r = await c.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: t.work, permissionMode: 'acceptEdits', model: 'm1' })
    expect(r).toEqual({ ok: true, controlId: 'c1' })
    expect(c.create).toHaveBeenCalledTimes(1)
    const a = c.create.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(fwd(a.configDirAbs as string)).toBe(`${HOME}/.claude-work`)
    expect(a).toMatchObject({ accountId: t.work, permissionMode: 'acceptEdits', model: 'm1' })
    expect(fwd(a.cwd as string)).toBe(`${HOME}/work/x`)
    expect(t.pty.spawnClaude).not.toHaveBeenCalled()
  })

  it('R-04 the default config dir is passed as null and the mode defaults to default', async () => {
    const t = await twoAccounts()
    const c = withControl(t)
    await c.svc.setSafety({ warnPersonalInCompanyFolder: false, showAccountColorEdge: true, lockAccountOnTeamStart: true })
    await c.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: t.me })
    expect(c.create.mock.calls[0]![0]).toMatchObject({ configDirAbs: null, permissionMode: 'default' })
  })

  it('R-04 invalid folder, invalid args and a missing control dep are refused without creating', async () => {
    const t = await twoAccounts()
    const c = withControl(t)
    expect(await c.svc.launchControlled({ cwd: 'D:/does/not/exist', accountId: t.work })).toMatchObject({ ok: false, reason: 'invalid-folder' })
    expect(await c.svc.launchControlled({ cwd: 'relative/x', accountId: t.work })).toMatchObject({ ok: false, reason: 'invalid-folder' })
    expect(await c.svc.launchControlled({ cwd: 5, accountId: t.work } as never)).toMatchObject({ ok: false, reason: 'invalid-args' })
    expect(await t.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: t.work })).toMatchObject({ ok: false, reason: 'invalid-args' })
    expect(c.create).not.toHaveBeenCalled()
  })

  it('R-04 unknown account is blocked', async () => {
    const t = await twoAccounts()
    const c = withControl(t)
    expect(await c.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: 'nobody' })).toMatchObject({ ok: false, reason: 'unknown-account' })
    expect(c.create).not.toHaveBeenCalled()
  })

  it('R-04 a running controlled session of another account locks the folder', async () => {
    const t = await twoAccounts()
    const c = withControl(t, [{ cwd: `${HOME}/work/x`, accountId: t.work }])
    const r = await c.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: t.me, confirmed: true })
    expect(r).toMatchObject({ ok: false, reason: 'account-locked' })
    expect(c.create).not.toHaveBeenCalled()
  })

  it('R-04 a warned launch needs confirmed:true, then creates', async () => {
    const t = await twoAccounts()
    const c = withControl(t)
    const first = await c.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: t.me })
    expect(first).toMatchObject({ ok: false, reason: 'needs-confirmation', warnings: ['personal-in-company-folder'] })
    expect(c.create).not.toHaveBeenCalled()
    expect(await c.svc.launchControlled({ cwd: `${HOME}/work/x`, accountId: t.me, confirmed: true })).toMatchObject({ ok: true, controlId: 'c1' })
  })

  it('R-04 launchClaude also sees a controlled session as running (lock)', async () => {
    const t = await twoAccounts()
    const c = withControl(t, [{ cwd: `${HOME}/work/x`, accountId: t.work }])
    expect(await c.svc.launchClaude({ cwd: `${HOME}/work/x`, accountId: t.me, cols: 80, rows: 24, confirmed: true })).toMatchObject({
      ok: false,
      reason: 'account-locked'
    })
  })

  it('R-04 the snapshot lists controlled sessions (no ptyId) and locks their account', async () => {
    const t = await twoAccounts()
    const c = withControl(t, [{ cwd: `${HOME}/work/x`, accountId: t.work }])
    const snap = await c.svc.snapshot()
    expect(snap.sessions).toHaveLength(1)
    expect(snap.sessions[0]).toMatchObject({ teamName: 'x', accountId: t.work, agentCount: 1 })
    expect(snap.sessions[0]!.ptyId).toBeUndefined()
    expect(snap.accounts.find((a) => a.id === t.work)!.locked).toBe(true)
    expect(snap.accounts.find((a) => a.id === t.me)!.locked).toBeUndefined()
    expect(snap.activeAccountId).toBe(t.work)
  })
})
