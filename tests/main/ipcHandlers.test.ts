import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, type InvokeChannel } from '@shared/ipc'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import { createHandlers, registerIpcHandlers } from '../../src/main/ipc/handlers'

type Listener = (event: unknown, ...args: unknown[]) => unknown

function register(deps?: { version?: string }) {
  const handle = vi.fn()
  registerIpcHandlers({ handle } as never, createHandlers(deps))
  const listeners = new Map<string, Listener>()
  for (const call of handle.mock.calls) listeners.set(call[0] as string, call[1] as Listener)
  const invoke = async (channel: InvokeChannel, ...args: unknown[]) => listeners.get(channel)!({}, ...args)
  return { handle, listeners, invoke }
}

describe('R-03 registerIpcHandlers', () => {
  it('registers exactly one handler per invoke channel', () => {
    const { handle, listeners } = register()
    expect(handle).toHaveBeenCalledTimes(INVOKE_CHANNELS.length)
    expect([...listeners.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort())
    for (const call of handle.mock.calls) expect(typeof call[1]).toBe('function')
  })

  it('createHandlers has a function for every invoke channel', () => {
    const handlers = createHandlers()
    for (const ch of INVOKE_CHANNELS) expect(typeof handlers[ch]).toBe('function')
  })
})

describe('R-03 Phase 1 handler behaviour', () => {
  it('team:get-snapshot returns the mock (6 agents) as a fresh clone each call', async () => {
    const { invoke } = register()
    const first = (await invoke('team:get-snapshot')) as typeof mockTeamSnapshot
    expect(first.agents).toHaveLength(6)
    expect(first).toEqual(mockTeamSnapshot)
    first.agents.length = 0
    first.teamName = 'mutated'
    const second = (await invoke('team:get-snapshot')) as typeof mockTeamSnapshot
    expect(second.agents).toHaveLength(6)
    expect(second.teamName).toBe('sheet-export')
    expect(mockTeamSnapshot.agents).toHaveLength(6)
  })

  it('accounts:get-snapshot returns the accounts mock as a fresh clone', async () => {
    const { invoke } = register()
    const first = (await invoke('accounts:get-snapshot')) as typeof mockAccountsSnapshot
    expect(first.accounts.map((a) => a.id)).toEqual(['company', 'personal'])
    first.accounts.length = 0
    const second = (await invoke('accounts:get-snapshot')) as typeof mockAccountsSnapshot
    expect(second.accounts).toHaveLength(2)
    expect(mockAccountsSnapshot.accounts).toHaveLength(2)
  })

  it('accounts:set-default returns ok', async () => {
    const { invoke } = register()
    expect(await invoke('accounts:set-default', 'personal')).toEqual({ ok: true })
  })

  it('accounts sign-in handlers follow the Phase 1 stubs', async () => {
    const { invoke } = register()
    expect(await invoke('accounts:start-sign-in', '~/.claude-personal')).toEqual({ ok: false, reason: 'not-implemented' })
    expect(await invoke('accounts:check-sign-in', '~/.claude-personal')).toEqual({ configDir: '~/.claude-personal', step: 'waiting' })
    expect(await invoke('accounts:cancel-sign-in', '~/.claude-personal')).toEqual({ ok: true })
  })

  it.each([
    ['agent:send-message', ['be', 'hello']],
    ['agent:pause', ['be']],
    ['agent:stop', ['be']],
    ['team:pause-all', []],
    ['worktree:open-in-editor', ['.worktrees/backend']]
  ] as [InvokeChannel, unknown[]][])('%s returns not-implemented', async (channel, args) => {
    const { invoke } = register()
    expect(await invoke(channel, ...args)).toEqual({ ok: false, reason: 'not-implemented' })
  })

  it('returns invalid-args for non-string ids', async () => {
    const { invoke } = register()
    expect(await invoke('agent:stop', 123)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('agent:pause', undefined)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('agent:send-message', 'be', 42)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('accounts:set-default', {})).toEqual({ ok: false, reason: 'invalid-args' })
  })

  it('app:get-version returns the injected version, default 0.0.0', async () => {
    expect(await register({ version: '9.8.7' }).invoke('app:get-version')).toBe('9.8.7')
    expect(await register().invoke('app:get-version')).toBe('0.0.0')
  })
})

describe('Phase 2 contract stubs', () => {
  it.each([
    ['accounts:resolve-folder', ['C:/x'], { accountId: 'ask', ruleIndex: -1 }],
    ['accounts:check-launch', ['C:/x', 'company'], { allowed: false, warnings: [], blockedReason: 'pty-unavailable', matched: { accountId: 'ask', ruleIndex: -1 } }],
    ['pty:list', [], []],
    ['pty:get-buffer', ['p1'], { data: '', end: 0 }],
    ['app:pick-folder', [], null],
    ['app:get-default-cwd', [], ''],
    ['accounts:remove-profile', ['company'], { ok: false, reason: 'not-implemented' }],
    ['accounts:set-limit-policy', ['pause'], { ok: false, reason: 'not-implemented' }],
    ['accounts:reopen-sign-in', ['~/.claude'], { ok: false, reason: 'not-implemented' }],
    ['pty:kill', ['p1'], { ok: false, reason: 'not-implemented' }],
    ['pty:spawn', [{ cwd: 'C:/x', accountId: 'company', cols: 80, rows: 24 }], { ok: false, reason: 'pty-unavailable' }],
    ['pty:spawn', [42], { ok: false, reason: 'invalid-args' }],
    ['pty:resize', ['p1', 'x', 2], { ok: false, reason: 'invalid-args' }]
  ] as [InvokeChannel, unknown[], unknown][])('%s stub returns its shape', async (channel, args, expected) => {
    const { invoke } = register()
    expect(await invoke(channel, ...args)).toEqual(expected)
  })

  it('accounts:scan returns the mock snapshot', async () => {
    const { invoke } = register()
    expect(await invoke('accounts:scan')).toEqual(mockAccountsSnapshot)
  })
})

function fakeDeps() {
  const ok = { ok: true }
  const signIn = {
    start: vi.fn(async () => ok),
    check: vi.fn(async (d: string) => ({ configDir: d, step: 'waiting' })),
    reopen: vi.fn(async () => ok),
    cancel: vi.fn(async () => ok)
  }
  const accounts = {
    snapshot: vi.fn(async () => ({ real: true })),
    scan: vi.fn(async () => ({ scanned: true })),
    linkDetected: vi.fn(async () => ({ ok: true, accountId: 'a' })),
    saveProfile: vi.fn(async () => ({ ok: true, accountId: 'a' })),
    removeProfile: vi.fn(async () => ok),
    setDefault: vi.fn(async () => ok),
    setRules: vi.fn(async () => ok),
    setSafety: vi.fn(async () => ok),
    setLimitPolicy: vi.fn(async () => ok),
    resolveFolder: vi.fn(async () => ({ accountId: 'x', ruleIndex: 0 })),
    checkLaunch: vi.fn(async () => ({ allowed: true, warnings: [], matched: { accountId: 'x', ruleIndex: 0 } })),
    launchClaude: vi.fn(async () => ({ ok: true, ptyId: 'p1' })),
    signIn
  }
  const pty = {
    write: vi.fn(() => true),
    resize: vi.fn(() => true),
    kill: vi.fn(() => true),
    list: vi.fn(() => [{ id: 'p1' }]),
    buffer: vi.fn(() => 'buf'),
    snapshot: vi.fn(() => ({ data: 'buf', end: 3 }))
  }
  const deps = { accounts, pty, pickFolder: vi.fn(async () => 'C:/picked'), defaultCwd: vi.fn(() => 'C:/cwd') }
  const handle = vi.fn()
  registerIpcHandlers({ handle } as never, createHandlers(deps as never))
  const listeners = new Map<string, Listener>()
  for (const call of handle.mock.calls) listeners.set(call[0] as string, call[1] as Listener)
  const invoke = async (channel: InvokeChannel, ...args: unknown[]) => listeners.get(channel)!({}, ...args)
  return { accounts, signIn, pty, deps, invoke }
}

describe('Phase 2 real handlers delegate to the services', () => {
  it('delegates every accounts channel', async () => {
    const { invoke, accounts, signIn } = fakeDeps()
    expect(await invoke('accounts:get-snapshot')).toEqual({ real: true })
    expect(await invoke('accounts:scan')).toEqual({ scanned: true })
    await invoke('accounts:set-default', 'a')
    expect(accounts.setDefault).toHaveBeenCalledWith('a')
    await invoke('accounts:link-detected', { configDir: '~/.claude' })
    expect(accounts.linkDetected).toHaveBeenCalledWith({ configDir: '~/.claude' })
    await invoke('accounts:save-profile', { name: 'n' })
    expect(accounts.saveProfile).toHaveBeenCalled()
    await invoke('accounts:remove-profile', 'a')
    expect(accounts.removeProfile).toHaveBeenCalledWith('a')
    await invoke('accounts:set-rules', [])
    expect(accounts.setRules).toHaveBeenCalledWith([])
    await invoke('accounts:set-safety', { a: true })
    expect(accounts.setSafety).toHaveBeenCalled()
    await invoke('accounts:set-limit-policy', 'wait')
    expect(accounts.setLimitPolicy).toHaveBeenCalledWith('wait')
    expect(await invoke('accounts:resolve-folder', 'C:/x')).toEqual({ accountId: 'x', ruleIndex: 0 })
    await invoke('accounts:check-launch', 'C:/x', 'a')
    expect(accounts.checkLaunch).toHaveBeenCalledWith('C:/x', 'a')
    await invoke('accounts:start-sign-in', '~/.c')
    await invoke('accounts:check-sign-in', '~/.c')
    await invoke('accounts:reopen-sign-in', '~/.c')
    await invoke('accounts:cancel-sign-in', '~/.c')
    for (const fn of [signIn.start, signIn.check, signIn.reopen, signIn.cancel]) expect(fn).toHaveBeenCalledWith('~/.c')
  })

  it('pty and app channels delegate', async () => {
    const { invoke, pty, deps } = fakeDeps()
    expect(await invoke('pty:write', 'p1', 'ls')).toEqual({ ok: true })
    expect(pty.write).toHaveBeenCalledWith('p1', 'ls')
    expect(await invoke('pty:kill', 'p1')).toEqual({ ok: true })
    expect(await invoke('pty:list')).toEqual([{ id: 'p1' }])
    expect(await invoke('pty:get-buffer', 'p1')).toEqual({ data: 'buf', end: 3 })
    expect(await invoke('app:pick-folder')).toBe('C:/picked')
    expect(await invoke('app:get-default-cwd')).toBe('C:/cwd')
    expect(deps.pickFolder).toHaveBeenCalled()
  })

  it('pty:write on an unknown id reports not-found', async () => {
    const { invoke, pty } = fakeDeps()
    pty.write.mockReturnValueOnce(false)
    expect(await invoke('pty:write', 'zz', 'x')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('pty:spawn passes a cleaned request to launchClaude and clamps cols/rows', async () => {
    const { invoke, accounts } = fakeDeps()
    const r = await invoke('pty:spawn', { cwd: 'C:/x', accountId: 'a', cols: 9999, rows: 1, confirmed: true, command: 'evil', args: ['x'] })
    expect(r).toEqual({ ok: true, ptyId: 'p1' })
    expect(accounts.launchClaude).toHaveBeenCalledWith({ cwd: 'C:/x', accountId: 'a', cols: 500, rows: 5, confirmed: true })
  })

  it('pty:resize clamps to 20..500 x 5..200', async () => {
    const { invoke, pty } = fakeDeps()
    await invoke('pty:resize', 'p1', 1, 100000)
    expect(pty.resize).toHaveBeenCalledWith('p1', 20, 200)
  })

  it('rejects bad shapes with invalid-args', async () => {
    const { invoke, accounts, pty } = fakeDeps()
    const bad = { ok: false, reason: 'invalid-args' }
    expect(await invoke('pty:spawn', { cwd: 'C:/x', accountId: 'a', cols: -1, rows: 24 })).toEqual(bad)
    expect(await invoke('pty:spawn', { cwd: 5, accountId: 'a', cols: 80, rows: 24 })).toEqual(bad)
    expect(await invoke('pty:spawn', null)).toEqual(bad)
    expect(await invoke('pty:resize', 'p1', NaN, 24)).toEqual(bad)
    expect(await invoke('pty:write', 'p1', 5)).toEqual(bad)
    expect(await invoke('pty:kill', 7)).toEqual(bad)
    expect(await invoke('accounts:set-rules', 'nope')).toEqual(bad)
    expect(await invoke('accounts:save-profile', 'nope')).toEqual(bad)
    expect(await invoke('accounts:start-sign-in', 3)).toEqual(bad)
    expect(accounts.launchClaude).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
  })

  it('rejects oversized pty:write data (> 64 KiB)', async () => {
    const { invoke, pty } = fakeDeps()
    expect(await invoke('pty:write', 'p1', 'x'.repeat(64 * 1024 + 1))).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('pty:write', 'p1', 'x'.repeat(64 * 1024))).toEqual({ ok: true })
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('team and agent channels stay mock-backed', async () => {
    const { invoke } = fakeDeps()
    expect(((await invoke('team:get-snapshot')) as typeof mockTeamSnapshot).agents).toHaveLength(6)
  })
})

describe('R-01 Phase 3 real handlers delegate to the transcript service', () => {
  function withTranscripts(extra: Record<string, unknown> = {}) {
    const live = { ...structuredClone(mockTeamSnapshot), source: 'live' as const, sessionId: 'sess-1' }
    const transcripts = {
      snapshot: vi.fn(() => live),
      listSessions: vi.fn(async () => [{ sessionId: 'sess-1' }]),
      select: vi.fn(async () => live),
      getSelection: vi.fn(() => ({ mode: 'session', accountId: 'a', sessionId: 'sess-1' })),
      usageToday: vi.fn(() => ({ day: '2026-11-19', byAccount: { a: { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 } } }))
    }
    const handle = vi.fn()
    registerIpcHandlers({ handle } as never, createHandlers({ transcripts, ...extra } as never))
    const listeners = new Map<string, Listener>()
    for (const call of handle.mock.calls) listeners.set(call[0] as string, call[1] as Listener)
    const invoke = async (channel: InvokeChannel, ...args: unknown[]) => listeners.get(channel)!({}, ...args)
    return { transcripts, live, invoke }
  }

  it('team:get-snapshot returns the live snapshot instead of the mock', async () => {
    const { invoke, live } = withTranscripts()
    expect(await invoke('team:get-snapshot')).toBe(live)
  })

  it('list-sessions, get-selection and usage:get-today delegate', async () => {
    const { invoke, transcripts } = withTranscripts()
    expect(await invoke('transcripts:list-sessions')).toEqual([{ sessionId: 'sess-1' }])
    expect(await invoke('transcripts:get-selection')).toEqual({ mode: 'session', accountId: 'a', sessionId: 'sess-1' })
    expect(((await invoke('usage:get-today')) as { day: string }).day).toBe('2026-11-19')
    expect(transcripts.usageToday).toHaveBeenCalled()
  })

  it('transcripts:select delegates valid selections and answers the empty snapshot to invalid ones', async () => {
    const { invoke, transcripts, live } = withTranscripts()
    expect(await invoke('transcripts:select', { mode: 'auto' })).toBe(live)
    expect(transcripts.select).toHaveBeenLastCalledWith({ mode: 'auto' })
    await invoke('transcripts:select', { mode: 'session', accountId: 'a', sessionId: 's' })
    expect(transcripts.select).toHaveBeenLastCalledWith({ mode: 'session', accountId: 'a', sessionId: 's' })
    await invoke('transcripts:select', { mode: 'auto', projectKey: 'd:/repos/main' })
    expect(transcripts.select).toHaveBeenLastCalledWith({ mode: 'auto', projectKey: 'd:/repos/main' })
    transcripts.select.mockClear()
    for (const bad of [{ mode: 'auto', projectKey: 5 }, null, 'auto', { mode: 'session' }, { mode: 'session', accountId: 1, sessionId: 's' }, { mode: 'x' }]) {
      expect(await invoke('transcripts:select', bad)).toMatchObject({ source: 'empty', agents: [] })
    }
    expect(transcripts.select).not.toHaveBeenCalled()
  })

  it('pty:spawn calls onPtySpawned only for an ok result', async () => {
    const fake = fakeDeps()
    const onPtySpawned = vi.fn()
    const handle = vi.fn()
    registerIpcHandlers({ handle } as never, createHandlers({ ...fake.deps, onPtySpawned } as never))
    const spawn = handle.mock.calls.find((c) => c[0] === 'pty:spawn')![1] as Listener
    const req = { cwd: 'C:/x', accountId: 'a', cols: 80, rows: 24 }
    expect(await spawn({}, req)).toMatchObject({ ok: true, ptyId: 'p1' })
    expect(onPtySpawned).toHaveBeenCalledTimes(1)
    expect(onPtySpawned).toHaveBeenCalledWith('p1')
    fake.accounts.launchClaude.mockResolvedValueOnce({ ok: false, reason: 'spawn-failed' } as never)
    await spawn({}, req)
    await spawn({}, { cwd: 1 })
    expect(onPtySpawned).toHaveBeenCalledTimes(1)
  })
})

describe('R-17 handlers.ts has no fs / network / child_process / credential access', () => {
  const src = readFileSync(resolve(__dirname, '../../src/main/ipc/handlers.ts'), 'utf8')

  it('imports nothing risky', () => {
    expect(src).not.toMatch(/from\s+['"](node:)?(fs|fs\/promises|child_process|net|http|https|os|path)['"]/)
    expect(src).not.toMatch(/require\(/)
    expect(src).not.toMatch(/\bfetch\(|https?:\/\//)
  })

  it('imports electron only as a type', () => {
    const lines = src.split('\n').filter((l) => /from\s+['"]electron['"]/.test(l))
    for (const l of lines) expect(l).toMatch(/import\s+type/)
  })
})

describe('R-03 main/index.ts wiring', () => {
  it('registers the handlers inside whenReady with the app version', () => {
    const src = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf8')
    const code = src.replace(/\/\/.*$/gm, '')
    expect(code).toMatch(/registerIpcHandlers\(\s*ipcMain\s*,\s*createHandlers\(\s*\{[^}]*app\.getVersion\(\)/)
    expect(code.indexOf('registerIpcHandlers(')).toBeLessThan(code.indexOf('createWindow()', code.indexOf('whenReady')))
  })
})
