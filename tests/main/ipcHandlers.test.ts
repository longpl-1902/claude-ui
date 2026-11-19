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
    ['pty:get-buffer', ['p1'], ''],
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
