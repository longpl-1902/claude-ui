import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, type InvokeChannel } from '@shared/ipc'
import { mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import { createHandlers, registerIpcHandlers, type HandlerDeps } from '../../src/main/ipc/handlers'

type Listener = (event: unknown, ...args: unknown[]) => unknown

function register(deps?: HandlerDeps) {
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

const OK = { ok: true }
function fakeControl(over: Record<string, unknown> = {}) {
  const calls: string[] = []
  const rec = (name: string, ret: unknown) => (...args: unknown[]) => {
    calls.push(`${name}:${JSON.stringify(args)}`)
    return typeof ret === 'function' ? (ret as () => unknown)() : ret
  }
  const control = {
    create: rec('create', { id: 'c1' }),
    send: rec('send', Promise.resolve(OK)),
    interrupt: rec('interrupt', OK),
    interruptAll: rec('interruptAll', 2),
    answer: rec('answer', OK),
    setModel: rec('setModel', OK),
    setMode: rec('setMode', OK),
    stop: rec('stop', Promise.resolve(OK)),
    remove: rec('remove', OK),
    list: rec('list', []),
    get: rec('get', undefined),
    streamState: rec('streamState', null),
    onChanged: rec('onChanged', () => {}),
    onStream: rec('onStream', () => {}),
    disposeAll: rec('disposeAll', undefined),
    ...over
  }
  return { control: control as never, calls }
}
const GOOD_START = { cwd: 'C:/p', accountId: 'a' }
const accountsWith = (launch: (...a: any[]) => Promise<unknown> = vi.fn(async () => ({ ok: true, controlId: 'c1' }))) => ({ launchControlled: launch }) as never

describe('T13 control handlers', () => {
  it('control:start validates, then delegates to accounts.launchControlled', async () => {
    const launch = vi.fn(async () => ({ ok: true, controlId: 'c1' }))
    const { control } = fakeControl()
    const { invoke } = register({ accounts: accountsWith(launch), control })
    expect(await invoke('control:start', GOOD_START)).toEqual({ ok: true, controlId: 'c1' })
    expect(launch).toHaveBeenCalledWith(GOOD_START)
    expect(await invoke('control:start', { cwd: '', accountId: 'a' })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('control:start', null)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('control:start refuses to resume a session that is live elsewhere, but allows fork and unrelated sessions', async () => {
    const launch = vi.fn(async () => ({ ok: true, controlId: 'c1' }))
    const isSessionLive = vi.fn(async (_a: string, id: string) => id === 'LIVE')
    const { control } = fakeControl()
    const { invoke } = register({ accounts: accountsWith(launch), control, isSessionLive })
    expect(await invoke('control:start', { ...GOOD_START, resume: { kind: 'resume', sessionId: 'LIVE' } })).toEqual({
      ok: false,
      reason: 'session-live-elsewhere'
    })
    expect(launch).not.toHaveBeenCalled()
    expect(isSessionLive).toHaveBeenCalledWith('a', 'LIVE')
    expect(((await invoke('control:start', { ...GOOD_START, resume: { kind: 'resume', sessionId: 'LIVE', fork: true } })) as { ok: boolean }).ok).toBe(true)
    expect(((await invoke('control:start', { ...GOOD_START, resume: { kind: 'resume', sessionId: 'OTHER' } })) as { ok: boolean }).ok).toBe(true)
    expect(((await invoke('control:start', { ...GOOD_START, resume: { kind: 'continue' } })) as { ok: boolean }).ok).toBe(true)
    expect(launch).toHaveBeenCalledTimes(3)
  })

  it('control:send/interrupt/stop/answer/set-model/set-mode/list/get-stream reach the manager on valid args', async () => {
    const { control, calls } = fakeControl()
    const { invoke } = register({ control })
    expect(await invoke('control:send', 'c1', 'hello')).toEqual(OK)
    expect(await invoke('control:interrupt', 'c1')).toEqual(OK)
    expect(await invoke('control:stop', 'c1')).toEqual(OK)
    expect(await invoke('control:answer', 'c1', 'r1', { behavior: 'allow', scope: 'once' })).toEqual(OK)
    expect(await invoke('control:set-model', 'c1', 'claude-opus-4-1')).toEqual(OK)
    expect(await invoke('control:set-model', 'c1', null)).toEqual(OK)
    expect(await invoke('control:set-mode', 'c1', 'plan')).toEqual(OK)
    expect(await invoke('control:list')).toEqual([])
    expect(await invoke('control:get-stream', 'c1')).toBeNull()
    expect(calls).toEqual([
      'send:["c1","hello"]',
      'interrupt:["c1"]',
      'stop:["c1"]',
      'answer:["c1","r1",{"behavior":"allow","scope":"once"}]',
      'setModel:["c1","claude-opus-4-1"]',
      'setModel:["c1",null]',
      'setMode:["c1","plan"]',
      'list:[]',
      'streamState:["c1"]'
    ])
  })

  it('control handlers answer invalid-args without touching the manager', async () => {
    const { control, calls } = fakeControl()
    const { invoke } = register({ control })
    const bad = { ok: false, reason: 'invalid-args' }
    expect(await invoke('control:send', 1, 'x')).toEqual(bad)
    expect(await invoke('control:send', 'c1', 'x'.repeat(32_001))).toEqual(bad)
    expect(await invoke('control:interrupt', 5)).toEqual(bad)
    expect(await invoke('control:stop', null)).toEqual(bad)
    expect(await invoke('control:answer', 'c1', 'r1', { behavior: 'maybe' })).toEqual(bad)
    expect(await invoke('control:answer', 'c1', 2, { behavior: 'allow' })).toEqual(bad)
    expect(await invoke('control:set-model', 'c1', 'bad model!')).toEqual(bad)
    expect(await invoke('control:set-model', 'c1', 7)).toEqual(bad)
    expect(await invoke('control:set-mode', 'c1', 'bypassPermissions')).toEqual(bad)
    expect(await invoke('control:get-stream', 3)).toBeNull()
    expect(calls).toEqual([])
    expect(((await invoke('control:send', 'c1', 'x'.repeat(32_000))) as { ok: boolean }).ok).toBe(true)
  })

  it('team:pause-all reports the interrupted count, or nothing-running', async () => {
    const a = register({ control: fakeControl().control })
    expect(await a.invoke('team:pause-all')).toEqual({ ok: true, reason: '2' })
    const b = register({ control: fakeControl({ interruptAll: () => 0 }).control })
    expect(await b.invoke('team:pause-all')).toEqual({ ok: false, reason: 'nothing-running' })
  })

  it('R-19 creating handlers never calls send/start/create; only an invoked handler does', async () => {
    const { control, calls } = fakeControl()
    const launch = vi.fn(async () => ({ ok: true }))
    const { invoke } = register({ accounts: accountsWith(launch), control })
    expect(calls).toEqual([])
    expect(launch).not.toHaveBeenCalled()
    await invoke('control:list')
    expect(calls.filter((c) => /^(send|create|setMode|answer)/.test(c))).toEqual([])
    expect(launch).not.toHaveBeenCalled()
    await invoke('control:send', 'c1', 'go')
    expect(calls).toContain('send:["c1","go"]')
  })

  it('R-19 index.ts never calls control.send or starts a session itself', () => {
    const code = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf8').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/control\.(send|start)\(/)
    expect(code).not.toMatch(/launchControlled|launchClaude/)
  })
})

describe('T13 external kill, editor, git, hooks, attention handlers', () => {
  it('session:kill-external validates and delegates', async () => {
    const kill = vi.fn(async () => OK)
    const { invoke } = register({ externalKiller: { kill } })
    const req = { accountId: 'a', sessionId: 's', pid: 42 }
    expect(await invoke('session:kill-external', req)).toEqual(OK)
    expect(kill).toHaveBeenCalledWith(req)
    expect(await invoke('session:kill-external', { ...req, pid: -1 })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('session:kill-external', { ...req, pid: '42' })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('session:kill-external', null)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('worktree:open-in-editor validates and delegates', async () => {
    const open = vi.fn(async () => OK)
    const { invoke } = register({ openInEditor: { open } })
    expect(await invoke('worktree:open-in-editor', 'C:/p/wt')).toEqual(OK)
    expect(open).toHaveBeenCalledWith('C:/p/wt')
    expect(await invoke('worktree:open-in-editor', 5)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('worktree:open-in-editor', '')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('worktree:open-in-editor', 'x'.repeat(1025))).toEqual({ ok: false, reason: 'invalid-args' })
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('git:watch accepts a string or null; git:compare needs two strings', async () => {
    const snap = { root: null, base: null, worktrees: [], overlaps: [], updatedAt: 'x' }
    const watch = vi.fn(async (_r: string | null) => snap)
    const compare = vi.fn(async () => [])
    const { invoke } = register({ worktrees: { watch, compare } as never })
    await invoke('git:watch', 'C:/p')
    await invoke('git:watch', null)
    expect(watch.mock.calls).toEqual([['C:/p'], [null]])
    await invoke('git:watch', 'x'.repeat(1025))
    await invoke('git:watch', 42)
    expect(watch.mock.calls.slice(2)).toEqual([[null], [null]])
    expect(await invoke('git:compare', 'C:/p', 'a.ts')).toEqual([])
    expect(compare).toHaveBeenCalledWith('C:/p', 'a.ts')
    expect(await invoke('git:compare', 'C:/p', 5)).toEqual([])
    expect(await invoke('git:compare', 1, 'a.ts')).toEqual([])
    expect(compare).toHaveBeenCalledTimes(1)
  })

  it('hooks:status/preview/apply validate and delegate', async () => {
    const status = vi.fn(async (r: string | null) => ({ projectRoot: r }))
    const preview = vi.fn(async () => ({ previewId: 'p1' }))
    const apply = vi.fn(async () => OK)
    const { invoke } = register({ hooks: { status, preview, apply } as never })
    expect(await invoke('hooks:status', 'C:/p')).toEqual({ projectRoot: 'C:/p' })
    expect(await invoke('hooks:status', null)).toEqual({ projectRoot: null })
    expect(await invoke('hooks:status', 9)).toEqual({ projectRoot: null })
    expect(await invoke('hooks:preview', 'C:/p', 'install')).toEqual({ previewId: 'p1' })
    expect(await invoke('hooks:preview', 'C:/p', 'wipe')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('hooks:preview', 3, 'install')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(preview).toHaveBeenCalledTimes(1)
    expect(await invoke('hooks:apply', 'p1')).toEqual(OK)
    expect(await invoke('hooks:apply', 4)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('attention:get / get-prefs / set-prefs (set-prefs validates, accepts notifyIdle)', async () => {
    const snapshot = { items: [], projects: [], updatedAt: 'x' }
    const prefs = { mutedProjects: [], dnd: false, notifyErrors: false, notifyIdle: false }
    const setPrefs = vi.fn(async (_p: unknown) => OK)
    const { invoke } = register({ attention: { snapshot: () => snapshot, getPrefs: () => prefs, setPrefs } })
    expect(await invoke('attention:get')).toEqual(snapshot)
    expect(await invoke('attention:get-prefs')).toEqual(prefs)
    expect(await invoke('attention:set-prefs', { ...prefs, notifyIdle: true })).toEqual(OK)
    expect(setPrefs).toHaveBeenCalledWith({ ...prefs, notifyIdle: true })
    expect(await invoke('attention:set-prefs', { ...prefs, notifyIdle: 'yes' })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('attention:set-prefs', { mutedProjects: [], dnd: 1, notifyErrors: false })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(setPrefs).toHaveBeenCalledTimes(1)
  })

  it('electron-builder ships the hook script as an extra resource', () => {
    const yml = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/extraResources:\s*\n\s*- from: resources\/hook\s*\n\s*to: hook/)
  })
})

// ---- T26: contract v5 handlers ----
const V5_UUID = '33333333-aaaa-4bbb-8ccc-000000000003'
const BAD = { ok: false, reason: 'invalid-args' }

describe('T26 v5 control handlers', () => {
  const control = () => {
    const calls: string[] = []
    const rec = (name: string, ret: unknown) => (...args: unknown[]) => {
      calls.push(`${name}:${JSON.stringify(args)}`)
      return ret
    }
    const c = {
      ...(fakeControl().control as object),
      details: rec('details', { controlId: 'c1' }),
      sendRich: rec('sendRich', Promise.resolve(OK)),
      refreshContext: rec('refreshContext', Promise.resolve(OK)),
      mcpToggle: rec('mcpToggle', Promise.resolve(OK)),
      mcpReconnect: rec('mcpReconnect', Promise.resolve(OK)),
      fileSuggestions: rec('fileSuggestions', Promise.resolve(null)),
      rewindPreview: rec('rewindPreview', Promise.resolve({ canRewind: true, filesChanged: [], insertions: 0, deletions: 0 })),
      rewind: rec('rewind', Promise.resolve(OK)),
      forkAt: rec('forkAt', { ok: true, controlId: 'c2' }),
      setEffort: rec('setEffort', Promise.resolve(OK)),
      setOutputStyle: rec('setOutputStyle', Promise.resolve(OK)),
      rename: rec('rename', Promise.resolve(OK)),
      getPlan: rec('getPlan', Promise.resolve({ exists: true, content: 'p' }))
    }
    return { control: c as never, calls }
  }

  it('valid calls reach the manager', async () => {
    const { control: c, calls } = control()
    const { invoke } = register({ control: c })
    const png = { mediaType: 'image/png', dataBase64: 'AAAA' }
    expect(await invoke('control:details', 'c1')).toEqual({ controlId: 'c1' })
    expect(await invoke('control:send-rich', 'c1', 'hi', [png])).toEqual(OK)
    expect(await invoke('control:refresh-context', 'c1')).toEqual(OK)
    expect(await invoke('control:mcp-toggle', 'c1', 'github', false)).toEqual(OK)
    expect(await invoke('control:mcp-reconnect', 'c1', 'github')).toEqual(OK)
    expect(await invoke('control:rewind-preview', 'c1', V5_UUID)).toMatchObject({ canRewind: true })
    expect(await invoke('control:rewind', 'c1', V5_UUID)).toEqual(OK)
    expect(await invoke('control:fork-at', 'c1', V5_UUID)).toEqual({ ok: true, controlId: 'c2' })
    expect(await invoke('control:set-effort', 'c1', 'xhigh')).toEqual(OK)
    expect(await invoke('control:set-effort', 'c1', null)).toEqual(OK)
    expect(await invoke('control:set-output-style', 'c1', 'Explanatory')).toEqual(OK)
    expect(await invoke('control:set-output-style', 'c1', null)).toEqual(OK)
    expect(await invoke('control:rename', 'c1', 'My title')).toEqual(OK)
    expect(await invoke('control:get-plan', 'c1')).toEqual({ exists: true, content: 'p' })
    expect(calls).toEqual([
      'details:["c1"]',
      `sendRich:["c1","hi",[${JSON.stringify(png)}]]`,
      'refreshContext:["c1"]',
      'mcpToggle:["c1","github",false]',
      'mcpReconnect:["c1","github"]',
      `rewindPreview:["c1","${V5_UUID}"]`,
      `rewind:["c1","${V5_UUID}"]`,
      `forkAt:["c1","${V5_UUID}"]`,
      'setEffort:["c1","xhigh"]',
      'setEffort:["c1",null]',
      'setOutputStyle:["c1","Explanatory"]',
      'setOutputStyle:["c1",null]',
      'rename:["c1","My title"]',
      'getPlan:["c1"]'
    ])
  })

  it('invalid arguments never reach the manager', async () => {
    const { control: c, calls } = control()
    const { invoke } = register({ control: c })
    const png = { mediaType: 'image/png', dataBase64: 'AAAA' }
    expect(await invoke('control:details', 5)).toBeNull()
    expect(await invoke('control:send-rich', 'c1', 'hi', Array.from({ length: 6 }, () => png))).toEqual(BAD)
    expect(await invoke('control:send-rich', 'c1', 'hi', [{ mediaType: 'image/bmp', dataBase64: 'AAAA' }])).toEqual(BAD)
    expect(await invoke('control:send-rich', 'c1', 'x'.repeat(32_001), [])).toEqual(BAD)
    expect(await invoke('control:send-rich', 'c1', 'hi', [{ mediaType: 'image/png', dataBase64: 'A'.repeat(8 * 1024 * 1024) }])).toEqual(BAD)
    expect(await invoke('control:mcp-toggle', 'c1', 'bad name!', true)).toEqual(BAD)
    expect(await invoke('control:mcp-toggle', 'c1', 'github', 'yes')).toEqual(BAD)
    expect(await invoke('control:mcp-reconnect', 'c1', '')).toEqual(BAD)
    expect(await invoke('control:rewind-preview', 'c1', 'nope')).toEqual({ canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'invalid-args' })
    expect(await invoke('control:rewind', 'c1', 'nope')).toEqual(BAD)
    expect(await invoke('control:fork-at', 'c1', 'nope')).toEqual(BAD)
    expect(await invoke('control:set-effort', 'c1', 'turbo')).toEqual(BAD)
    expect(await invoke('control:set-output-style', 'c1', 'x'.repeat(129))).toEqual(BAD)
    expect(await invoke('control:set-output-style', 'c1', '')).toEqual(BAD)
    expect(await invoke('control:rename', 'c1', 'x'.repeat(201))).toEqual(BAD)
    expect(await invoke('control:rename', 'c1', '   ')).toEqual(BAD)
    expect(await invoke('control:get-plan', 7)).toEqual({ exists: false })
    expect(calls).toEqual([])
  })

  it('control:start applies effort and output style to the new draft only when they were requested', async () => {
    const { control: c, calls } = control()
    const launch = vi.fn(async () => ({ ok: true, controlId: 'c9' }))
    const { invoke } = register({ accounts: accountsWith(launch), control: c })
    await invoke('control:start', GOOD_START)
    expect(calls).toEqual([])
    await invoke('control:start', { ...GOOD_START, effort: 'high', outputStyle: 'Learning' })
    expect(calls).toEqual(['setEffort:["c9","high"]', 'setOutputStyle:["c9","Learning"]'])
  })

  it('R-19 creating the handlers calls no v5 manager method', () => {
    const { control: c, calls } = control()
    register({ control: c })
    expect(calls).toEqual([])
  })
})

describe('T26 control:file-suggestions', () => {
  const gitOut = ['src/main/index.ts', 'src/main/control/controlSession.ts', 'README.md', 'src/renderer/App.tsx', 'docs/main-notes.md', ''].join('\n')
  const noLive = () => ({ ...(fakeControl().control as object), fileSuggestions: async () => null }) as never

  it('uses the running session when it answers', async () => {
    const c = { ...(fakeControl().control as object), fileSuggestions: async () => [{ path: 'from/cli.ts' }] } as never
    const execGit = vi.fn(async () => ({ stdout: gitOut }))
    const { invoke } = register({ control: c, execGit })
    expect(await invoke('control:file-suggestions', 'c1', 'C:/p', 'x')).toEqual([{ path: 'from/cli.ts' }])
    expect(execGit).not.toHaveBeenCalled()
  })

  it('id null or a non-running session falls back to git ls-files, fuzzy-filtered', async () => {
    const execGit = vi.fn(async () => ({ stdout: gitOut }))
    const { invoke } = register({ control: noLive(), execGit })
    const r = (await invoke('control:file-suggestions', null, 'C:/p', 'main')) as { path: string }[]
    expect(execGit).toHaveBeenCalledWith(['-C', 'C:/p', 'ls-files', '-co', '--exclude-standard'])
    expect(r.map((x) => x.path)).toEqual(expect.arrayContaining(['src/main/index.ts', 'docs/main-notes.md']))
    expect(r.map((x) => x.path)).not.toContain('README.md')
    expect(r.map((x) => x.path)).not.toContain('src/renderer/App.tsx')
    const sub = (await invoke('control:file-suggestions', 'c1', 'C:/p', 'smi')) as { path: string }[]
    expect(sub.map((x) => x.path)).toContain('src/main/index.ts')
    expect((await invoke('control:file-suggestions', null, 'C:/p', '')) as unknown[]).toHaveLength(5)
  })

  it('caches the file list for 30 s per folder, caps it at 20 000 paths and answers at 50', async () => {
    let now = 1_000_000
    const many = Array.from({ length: 25_000 }, (_, i) => `dir/file${i}.ts`).join('\n')
    const execGit = vi.fn(async () => ({ stdout: many }))
    const { invoke } = register({ control: noLive(), execGit, now: () => now })
    const first = (await invoke('control:file-suggestions', null, 'C:/p', 'file')) as { path: string }[]
    expect(first).toHaveLength(50)
    expect(await invoke('control:file-suggestions', null, 'C:/p', 'file24999')).toEqual([])
    expect(((await invoke('control:file-suggestions', null, 'C:/p', 'file19999')) as unknown[]).length).toBeGreaterThan(0)
    now += 29_000
    await invoke('control:file-suggestions', null, 'C:/p', 'a')
    expect(execGit).toHaveBeenCalledTimes(1)
    await invoke('control:file-suggestions', null, 'C:/other', 'a')
    expect(execGit).toHaveBeenCalledTimes(2)
    now += 2_000
    await invoke('control:file-suggestions', null, 'C:/p', 'a')
    expect(execGit).toHaveBeenCalledTimes(3)
  })

  it('a failing git, bad arguments and no git dependency answer an empty list', async () => {
    const { invoke } = register({
      control: noLive(),
      execGit: async () => {
        throw new Error('not a repo')
      }
    })
    expect(await invoke('control:file-suggestions', null, 'C:/p', 'a')).toEqual([])
    expect(await invoke('control:file-suggestions', null, '', 'a')).toEqual([])
    expect(await invoke('control:file-suggestions', 5 as never, 'C:/p', 'a')).toEqual([])
    expect(await invoke('control:file-suggestions', null, 'C:/p', 'x'.repeat(257))).toEqual([])
    expect(await register({ control: noLive() }).invoke('control:file-suggestions', null, 'C:/p', 'a')).toEqual([])
  })
})

describe('T26 catalog, mcp, plugins and cli handlers', () => {
  const DIR = { abs: 'C:/Users/u/.claude-acme', configDirAbs: 'C:/Users/u/.claude-acme', display: '~/.claude-acme' }
  const DEFAULT_DIR = { abs: 'C:/Users/u/.claude', configDirAbs: null, display: '~/.claude' }
  const preview = { previewId: 'p1', argvDisplay: ['claude', 'mcp', 'list'], cwd: 'C:/p', configDir: '~/.claude-acme', effect: 'e', warnings: [] }
  const mcpReq = { projectRoot: 'C:/p', accountId: 'acme', name: 'gh', scope: 'user', transport: 'http', commandOrUrl: 'https://example.com/mcp', args: [], env: {}, headers: {} }

  function services() {
    const catalog = { list: vi.fn(async () => [{ kind: 'skill', name: 'a', scope: 'user', path: 'C:/skills/a/SKILL.md' }]) }
    const claudeCli = {
      mcpList: vi.fn(async () => ({ servers: [{ name: 's', scope: 'unknown', target: 'x', status: 'connected' }] })),
      pluginList: vi.fn(async () => ({ plugins: [{ id: 'p@m', name: 'p', enabled: true, installPath: 'C:/plugins/p' }] })),
      previewMcpAdd: vi.fn(() => preview),
      previewMcpRemove: vi.fn(() => preview),
      previewPlugin: vi.fn(() => preview),
      apply: vi.fn(async () => ({ ok: true, output: 'done' }))
    }
    const resolveAccountDir = vi.fn(async (id: string) => (id === 'acme' ? DIR : id === 'def' ? DEFAULT_DIR : null))
    const open = vi.fn(async () => OK)
    let now = 5_000_000
    const deps = { catalog, claudeCli, resolveAccountDir, openInEditor: { open }, now: () => now } as never
    return { catalog, claudeCli, resolveAccountDir, open, deps, tick: (ms: number) => void (now += ms) }
  }

  it('catalog:list resolves the account dir, feeds plugin install paths (cached 5 min) and returns the items', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    const items = await invoke('catalog:list', 'C:/p', 'acme')
    expect(items).toEqual([{ kind: 'skill', name: 'a', scope: 'user', path: 'C:/skills/a/SKILL.md' }])
    expect(s.catalog.list).toHaveBeenCalledWith({ configDirAbs: DIR.abs, projectRoot: 'C:/p', plugins: [{ name: 'p', installPath: 'C:/plugins/p' }] })
    expect(s.claudeCli.pluginList).toHaveBeenCalledWith({ configDirAbs: DIR.configDirAbs })
    await invoke('catalog:list', null, 'acme')
    expect(s.claudeCli.pluginList).toHaveBeenCalledTimes(1)
    s.tick(5 * 60_000 + 1)
    await invoke('catalog:list', null, 'acme')
    expect(s.claudeCli.pluginList).toHaveBeenCalledTimes(2)
    expect(await invoke('catalog:list', null, 'ghost')).toEqual([])
    expect(await invoke('catalog:list', 5 as never, 'acme')).toEqual([])
  })

  it('plugins:list refreshes the cache and hides install paths; the default account uses a null config dir', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    await invoke('catalog:list', null, 'def')
    expect(s.claudeCli.pluginList).toHaveBeenLastCalledWith({ configDirAbs: null })
    const r = await invoke('plugins:list', 'def')
    expect(r).toEqual({ plugins: [{ id: 'p@m', name: 'p', enabled: true }] })
    expect(s.claudeCli.pluginList).toHaveBeenCalledTimes(2)
    expect(await invoke('plugins:list', 'ghost')).toEqual({ plugins: [], error: 'unknown-account' })
    expect(await invoke('plugins:list', '')).toEqual({ plugins: [], error: 'invalid-args' })
  })

  it('catalog:open opens only paths returned by the last catalog list', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    expect(await invoke('catalog:open', 'C:/skills/a/SKILL.md')).toEqual({ ok: false, reason: 'not-listed' })
    await invoke('catalog:list', null, 'acme')
    expect(await invoke('catalog:open', 'C:/skills/a/SKILL.md')).toEqual(OK)
    expect(s.open).toHaveBeenCalledWith('C:/skills/a/SKILL.md')
    expect(await invoke('catalog:open', 'C:/Windows/system32/cmd.exe')).toEqual({ ok: false, reason: 'not-listed' })
    expect(await invoke('catalog:open', '')).toEqual(BAD)
    expect(await invoke('catalog:open', 5 as never)).toEqual(BAD)
    s.catalog.list.mockResolvedValueOnce([])
    await invoke('catalog:list', null, 'acme')
    expect(await invoke('catalog:open', 'C:/skills/a/SKILL.md')).toEqual({ ok: false, reason: 'not-listed' })
    expect(s.open).toHaveBeenCalledTimes(1)
  })

  it('mcp:list runs claude mcp list in the project with the account dir, and stamps ranAt', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    const r = (await invoke('mcp:list', 'C:/p', 'acme')) as { servers: unknown[]; ranAt: string; error?: string }
    expect(s.claudeCli.mcpList).toHaveBeenCalledWith({ cwd: 'C:/p', configDirAbs: DIR.configDirAbs })
    expect(r.servers).toHaveLength(1)
    expect(Number.isNaN(Date.parse(r.ranAt))).toBe(false)
    expect(((await invoke('mcp:list', 'C:/p', 'ghost')) as { error?: string }).error).toBe('unknown-account')
    expect(((await invoke('mcp:list', '', 'acme')) as { error?: string }).error).toBe('invalid-args')
    expect(s.claudeCli.mcpList).toHaveBeenCalledTimes(1)
  })

  it('previews validate, then pass the account dir to the CLI runner; nothing runs until cli:apply', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    expect(await invoke('mcp:preview-add', mcpReq)).toEqual(preview)
    expect(s.claudeCli.previewMcpAdd).toHaveBeenCalledWith({ ...mcpReq, configDirAbs: DIR.configDirAbs, configDirDisplay: DIR.display })
    expect(await invoke('mcp:preview-remove', 'C:/p', 'acme', 'gh', 'user')).toEqual(preview)
    expect(s.claudeCli.previewMcpRemove).toHaveBeenCalledWith({ cwd: 'C:/p', name: 'gh', scope: 'user', configDirAbs: DIR.configDirAbs, configDirDisplay: DIR.display })
    expect(await invoke('mcp:preview-remove', 'C:/p', 'acme', 'gh', null)).toEqual(preview)
    expect(await invoke('plugins:preview', 'acme', 'install', 'p@m')).toEqual(preview)
    expect(s.claudeCli.previewPlugin).toHaveBeenCalledWith({ action: 'install', id: 'p@m', configDirAbs: DIR.configDirAbs, configDirDisplay: DIR.display })
    expect(s.claudeCli.apply).not.toHaveBeenCalled()
    expect(s.claudeCli.mcpList).not.toHaveBeenCalled()
  })

  it('invalid preview requests and unknown accounts never reach the runner', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    expect(await invoke('mcp:preview-add', { ...mcpReq, name: '--bad' })).toEqual(BAD)
    expect(await invoke('mcp:preview-add', { ...mcpReq, scope: 'global' })).toEqual(BAD)
    expect(await invoke('mcp:preview-add', null)).toEqual(BAD)
    expect(await invoke('mcp:preview-add', { ...mcpReq, accountId: 'ghost' })).toEqual({ ok: false, reason: 'unknown-account' })
    expect(await invoke('mcp:preview-remove', 'C:/p', 'acme', 'bad name', 'user')).toEqual(BAD)
    expect(await invoke('mcp:preview-remove', 'C:/p', 'acme', 'gh', 'galaxy' as never)).toEqual(BAD)
    expect(await invoke('plugins:preview', 'acme', 'explode' as never, 'p')).toEqual(BAD)
    expect(await invoke('plugins:preview', 'acme', 'enable', '')).toEqual(BAD)
    expect(await invoke('plugins:preview', 'ghost', 'enable', 'p')).toEqual({ ok: false, reason: 'unknown-account' })
    expect(s.claudeCli.previewMcpAdd).not.toHaveBeenCalled()
    expect(s.claudeCli.previewMcpRemove).not.toHaveBeenCalled()
    expect(s.claudeCli.previewPlugin).not.toHaveBeenCalled()
  })

  it('cli:apply runs the stored preview and drops the plugin cache', async () => {
    const s = services()
    const { invoke } = register(s.deps)
    await invoke('plugins:list', 'acme')
    expect(await invoke('cli:apply', 'p1')).toEqual({ ok: true, output: 'done' })
    expect(s.claudeCli.apply).toHaveBeenCalledWith('p1')
    await invoke('catalog:list', null, 'acme')
    expect(s.claudeCli.pluginList).toHaveBeenCalledTimes(2)
    expect(await invoke('cli:apply', '')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await invoke('cli:apply', 5 as never)).toEqual({ ok: false, reason: 'invalid-args' })
  })

  it('without the T25 services the channels keep their stubs (never run anything)', async () => {
    const { invoke } = register()
    expect(await invoke('catalog:list', null, 'acme')).toEqual([])
    expect(await invoke('cli:apply', 'p1')).toEqual({ ok: false, reason: 'not-implemented' })
  })
})

describe('T26 main wiring', () => {
  const code = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf8').replace(/\/\/.*$/gm, '')

  it('index.ts pushes control details, builds the catalog and CLI runner and hands them to the handlers', () => {
    expect(code).toMatch(/control\.onDetails\(\(d\)\s*=>\s*broadcast\(IPC\.controlDetailsChanged,\s*d\)\)/)
    expect(code).toMatch(/createCatalog\(\{\s*fs:\s*catalogFs/)
    expect(code).toMatch(/createClaudeCli\(\{[^}]*exec:\s*cliExec/)
    expect(code).toMatch(/createHandlers\(\{[\s\S]*catalog,\s*claudeCli,\s*resolveAccountDir,\s*execGit/)
  })

  it('the CLI exec wrapper resolves non-zero exits instead of rejecting, and credential files stay denied', () => {
    expect(code).toMatch(/typeof e\.code === 'number'\)\s*return resolve\(\{[^}]*code: e\.code/)
    expect(code).toMatch(/isDeniedPath\(p\)\) return null/)
  })

  it('handlers.ts stays free of fs / child_process / network (R-17) after the v5 wiring', () => {
    const src = readFileSync(resolve(__dirname, '../../src/main/ipc/handlers.ts'), 'utf8')
    expect(src).not.toMatch(/from\s+['"](node:)?(fs|fs\/promises|child_process|net|http|https|os|path)['"]/)
    expect(src).not.toMatch(/\bfetch\(|https?:\/\//)
  })
})
