import { describe, expect, it, vi } from 'vitest'
import { createSignInController, type WatchFile } from '../../../src/main/accounts/signIn'
import type { HostEnv } from '../../../src/main/contracts'
import type { PtyManagerApi } from '../../../src/main/pty/types'
import type { SignInStatus } from '@shared/types'
import { createMemoryFs } from './memoryFs'

const HOME = 'C:/Users/u'
const host: HostEnv = { home: HOME, platform: 'win32', env: {}, appData: `${HOME}/AppData/Roaming` }
const DIR = '~/.claude-new'
const FILE = `${HOME}/.claude-new/.claude.json`
const withEmail = (email = 'me@example.com'): string => JSON.stringify({ oauthAccount: { emailAddress: email, organizationName: 'Example Org', accessToken: 'FAKE' } })
const noEmail = JSON.stringify({ firstStartTime: '2026-11-19T00:00:00Z' })
const fwd = (s: string): string => s.replace(/\\/g, '/')
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function setup(files: Record<string, string> = {}, spawnResult: unknown = { ok: true, id: 'pty1' }) {
  const fs = createMemoryFs(files, [], { caseInsensitive: true })
  const exitCbs: Array<(id: string, code: number) => void> = []
  const pty = {
    available: vi.fn(async () => true),
    spawnClaude: vi.fn(async () => spawnResult),
    write: vi.fn(() => true),
    resize: vi.fn(() => true),
    kill: vi.fn(() => true),
    buffer: vi.fn(() => ''),
    list: vi.fn(() => []),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn((cb: (id: string, code: number) => void) => (exitCbs.push(cb), () => undefined)),
    disposeAll: vi.fn()
  } as unknown as PtyManagerApi & { spawnClaude: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
  const watchers: Array<{ file: string; trigger: () => void; closed: boolean }> = []
  const watchFile: WatchFile = (file, onChange) => {
    const w = { file, trigger: onChange, closed: false }
    watchers.push(w)
    return { close: () => void (w.closed = true) }
  }
  const ctl = createSignInController({ pty, fs, host, watchFile })
  const statuses: SignInStatus[] = []
  ctl.onStatus((s) => statuses.push(s))
  const exit = (code: number, id = 'pty1'): void => exitCbs.forEach((cb) => cb(id, code))
  return { ctl, fs, pty, watchers, statuses, exit }
}

describe('R-10 sign-in controller', () => {
  it('R-10 start spawns `claude auth login` for a non-default dir with the absolute config dir', async () => {
    const { ctl, pty } = setup()
    expect(await ctl.start(DIR)).toMatchObject({ ok: true })
    expect(pty.spawnClaude).toHaveBeenCalledTimes(1)
    const arg = pty.spawnClaude.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({ purpose: 'login', args: ['auth', 'login'], configDirDisplay: DIR })
    expect(fwd(arg.configDirAbs as string)).toBe(`${HOME}/.claude-new`)
    expect(fwd(arg.cwd as string)).toBe(HOME)
  })

  it('R-10 the default dir ~/.claude leaves CLAUDE_CONFIG_DIR unset (configDirAbs null) and watches ~/.claude.json', async () => {
    const { ctl, pty, watchers } = setup()
    await ctl.start('~/.claude')
    expect((pty.spawnClaude.mock.calls[0]![0] as { configDirAbs: unknown }).configDirAbs).toBeNull()
    expect(fwd(watchers[0]!.file)).toBe(`${HOME}/.claude.json`)
  })

  it('R-10 status is waiting with the ptyId and the watcher targets <dir>/.claude.json', async () => {
    const { ctl, watchers, statuses } = setup()
    await ctl.start(DIR)
    expect(ctl.status(DIR)).toMatchObject({ configDir: DIR, step: 'waiting', ptyId: 'pty1' })
    expect(watchers).toHaveLength(1)
    expect(fwd(watchers[0]!.file)).toBe(FILE)
    expect(statuses.at(-1)).toMatchObject({ step: 'waiting' })
  })

  it('R-10 a file change without an email keeps waiting', async () => {
    const { ctl, fs, watchers } = setup()
    await ctl.start(DIR)
    fs.setFile(FILE, noEmail)
    watchers[0]!.trigger()
    await flush()
    expect(ctl.status(DIR).step).toBe('waiting')
    expect(watchers[0]!.closed).toBe(false)
  })

  it('R-10 a change that has an email completes once, emits done once and closes the watcher', async () => {
    const { ctl, fs, watchers, statuses } = setup()
    await ctl.start(DIR)
    fs.setFile(FILE, withEmail())
    watchers[0]!.trigger()
    await flush()
    watchers[0]!.trigger()
    await flush()
    expect(ctl.status(DIR)).toMatchObject({ step: 'done', email: 'me@example.com', org: 'Example Org' })
    expect(statuses.filter((s) => s.step === 'done')).toHaveLength(1)
    expect(watchers[0]!.closed).toBe(true)
    expect(JSON.stringify(statuses)).not.toContain('FAKE')
  })

  it('R-10 a dir already signed in at baseline is done only after an mtime bump (or exit 0)', async () => {
    const { ctl, fs, watchers } = setup({ [FILE]: withEmail('old@example.com') })
    await ctl.start(DIR)
    watchers[0]!.trigger()
    await flush()
    expect(ctl.status(DIR).step).toBe('waiting')
    fs.setFile(FILE, withEmail('new@example.com'))
    watchers[0]!.trigger()
    await flush()
    expect(ctl.status(DIR)).toMatchObject({ step: 'done', email: 'new@example.com' })
  })

  it('R-10 baseline signed in + exit 0 -> done', async () => {
    const { ctl, exit } = setup({ [FILE]: withEmail() })
    await ctl.start(DIR)
    exit(0)
    await flush()
    expect(ctl.status(DIR).step).toBe('done')
  })

  it('R-10 exit 0 with an email but no change after a signed-out baseline -> done', async () => {
    const { ctl, fs, exit } = setup()
    await ctl.start(DIR)
    fs.setFile(FILE, withEmail())
    exit(0)
    await flush()
    expect(ctl.status(DIR).step).toBe('done')
  })

  it('R-10 a non-zero exit without an email is an error (login-exited)', async () => {
    const { ctl, exit, watchers, statuses } = setup()
    await ctl.start(DIR)
    exit(1)
    await flush()
    expect(ctl.status(DIR)).toMatchObject({ step: 'error', reason: 'login-exited' })
    expect(watchers[0]!.closed).toBe(true)
    expect(statuses.at(-1)?.step).toBe('error')
  })

  it('R-10 exit 0 without an email is not done', async () => {
    const { ctl, exit } = setup()
    await ctl.start(DIR)
    exit(0)
    await flush()
    expect(ctl.status(DIR).step).not.toBe('done')
  })

  it('R-10 an exit from an unrelated pty is ignored', async () => {
    const { ctl, exit } = setup()
    await ctl.start(DIR)
    exit(1, 'some-other-pty')
    await flush()
    expect(ctl.status(DIR).step).toBe('waiting')
  })

  it('R-10 check() re-reads the file without needing a watcher event', async () => {
    const { ctl, fs } = setup()
    await ctl.start(DIR)
    fs.setFile(FILE, withEmail())
    const s = await ctl.check(DIR)
    expect(s).toMatchObject({ step: 'done', email: 'me@example.com' })
  })

  it('R-10 check() while still signed out stays waiting', async () => {
    const { ctl } = setup()
    await ctl.start(DIR)
    expect((await ctl.check(DIR)).step).toBe('waiting')
  })

  it('R-10 starting again while a login is active returns ok without a second spawn', async () => {
    const { ctl, pty } = setup()
    await ctl.start(DIR)
    expect(await ctl.start(DIR)).toMatchObject({ ok: true })
    expect(pty.spawnClaude).toHaveBeenCalledTimes(1)
  })

  it('R-10 reopen kills the current pty and respawns the login', async () => {
    const { ctl, pty } = setup()
    await ctl.start(DIR)
    expect(await ctl.reopen(DIR)).toMatchObject({ ok: true })
    expect(pty.kill).toHaveBeenCalledWith('pty1')
    expect(pty.spawnClaude).toHaveBeenCalledTimes(2)
    expect(ctl.status(DIR).step).toBe('waiting')
  })

  it('R-10 cancel kills the pty, closes the watcher and resets to none', async () => {
    const { ctl, pty, watchers } = setup()
    await ctl.start(DIR)
    expect(await ctl.cancel(DIR)).toMatchObject({ ok: true })
    expect(pty.kill).toHaveBeenCalledWith('pty1')
    expect(watchers[0]!.closed).toBe(true)
    expect(ctl.status(DIR).step).toBe('none')
  })

  it('R-10 a relative dir is rejected as invalid-folder and nothing is spawned', async () => {
    const { ctl, pty } = setup()
    expect(await ctl.start('some/relative')).toEqual({ ok: false, reason: 'invalid-folder' })
    expect(pty.spawnClaude).not.toHaveBeenCalled()
  })

  it('R-10 pty-unavailable puts the status into error with that reason', async () => {
    const { ctl, watchers } = setup({}, { ok: false, reason: 'pty-unavailable' })
    await ctl.start(DIR)
    expect(ctl.status(DIR)).toMatchObject({ step: 'error', reason: 'pty-unavailable' })
    expect(watchers.every((w) => w.closed) || watchers.length === 0).toBe(true)
  })

  it('R-10 claude-not-found puts the status into error with that reason', async () => {
    const { ctl } = setup({}, { ok: false, reason: 'claude-not-found' })
    await ctl.start(DIR)
    expect(ctl.status(DIR)).toMatchObject({ step: 'error', reason: 'claude-not-found' })
  })

  it('R-10 status of an unknown dir is none', () => {
    const { ctl } = setup()
    expect(ctl.status('~/.claude-never')).toMatchObject({ step: 'none' })
  })

  it('R-10 disposeAll closes watchers and kills login ptys', async () => {
    const { ctl, pty, watchers } = setup()
    await ctl.start(DIR)
    ctl.disposeAll()
    expect(watchers[0]!.closed).toBe(true)
    expect(pty.kill).toHaveBeenCalledWith('pty1')
  })

  it('R-14 sign-in never writes: no mkdir of the config dir, no file writes', async () => {
    const { ctl, fs, watchers } = setup()
    await ctl.start(DIR)
    fs.setFile(FILE, withEmail())
    watchers[0]!.trigger()
    await flush()
    await ctl.cancel(DIR)
    expect(fs.writes).toEqual([])
  })

  it('R-10 never runs `claude auth status` (Verified fact 5)', async () => {
    const { ctl, pty } = setup()
    await ctl.start(DIR)
    await ctl.check(DIR)
    for (const c of pty.spawnClaude.mock.calls) expect((c[0] as { args?: string[] }).args).toEqual(['auth', 'login'])
  })
})
