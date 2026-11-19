import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS, IPC, PUSH_CHANNELS } from '@shared/ipc'

describe('IPC contract', () => {
  const values = Object.values(IPC)

  it('has unique channel values', () => {
    expect(new Set(values).size).toBe(values.length)
  })

  it('INVOKE_CHANNELS covers every channel except the push channels', () => {
    expect(INVOKE_CHANNELS.length).toBe(values.length - PUSH_CHANNELS.length)
    expect(INVOKE_CHANNELS).not.toContain(IPC.teamEvent)
  })

  it('every channel matches the naming pattern', () => {
    for (const v of values) expect(v).toMatch(/^[a-z]+:[a-z-]+$/)
  })
})

// ---- Phase 2 (contract v2) ----

const NEW_INVOKE = {
  accountsScan: 'accounts:scan',
  accountsLinkDetected: 'accounts:link-detected',
  accountsSaveProfile: 'accounts:save-profile',
  accountsRemoveProfile: 'accounts:remove-profile',
  accountsSetRules: 'accounts:set-rules',
  accountsSetSafety: 'accounts:set-safety',
  accountsSetLimitPolicy: 'accounts:set-limit-policy',
  accountsResolveFolder: 'accounts:resolve-folder',
  accountsCheckLaunch: 'accounts:check-launch',
  accountsReopenSignIn: 'accounts:reopen-sign-in',
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyGetBuffer: 'pty:get-buffer',
  appPickFolder: 'app:pick-folder',
  appGetDefaultCwd: 'app:get-default-cwd'
} as const

const NEW_PUSH = {
  accountsChanged: 'accounts:changed',
  accountsSignInStatus: 'accounts:sign-in-status',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const

describe('R-01 IPC contract v2', () => {
  const ipc = IPC as Record<string, string>

  it.each(Object.entries(NEW_INVOKE))('R-01 IPC.%s = %s and is an invoke channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(INVOKE_CHANNELS).toContain(channel)
  })

  it.each(Object.entries(NEW_PUSH))('R-01 IPC.%s = %s is a push-only channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(PUSH_CHANNELS).toContain(channel)
    expect(INVOKE_CHANNELS).not.toContain(channel)
  })

  it('R-01 PUSH_CHANNELS is exactly teamEvent, the four v2 pushes and the three v3 pushes', () => {
    expect([...PUSH_CHANNELS].sort()).toEqual(
      [
        IPC.teamEvent, 'accounts:changed', 'accounts:sign-in-status', 'pty:data', 'pty:exit',
        'team:changed', 'transcripts:sessions-changed', 'usage:changed'
      ].sort()
    )
  })

  it('R-01 INVOKE_CHANNELS = every channel minus PUSH_CHANNELS (no gaps, no duplicates)', () => {
    const expected = Object.values(IPC).filter((c) => !(PUSH_CHANNELS as readonly string[]).includes(c))
    expect([...INVOKE_CHANNELS].sort()).toEqual([...expected].sort())
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length)
  })

  it('R-01 every new channel matches the naming pattern and is unique', () => {
    for (const c of [...Object.values(NEW_INVOKE), ...Object.values(NEW_PUSH)]) expect(c).toMatch(/^[a-z]+:[a-z-]+$/)
    expect(new Set(Object.values(IPC)).size).toBe(Object.values(IPC).length)
  })

  it('R-01 the preload bridge references every new channel constant', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')
    for (const key of [...Object.keys(NEW_INVOKE), ...Object.keys(NEW_PUSH)]) expect(src).toContain(`IPC.${key}`)
  })

  it('R-01 the preload exposes the new ConsoleApi surface', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')
    for (const name of [
      'scan', 'linkDetected', 'saveProfile', 'removeProfile', 'setRules', 'setSafety', 'setLimitPolicy', 'resolveFolder',
      'checkLaunch', 'reopenSignIn', 'onChanged', 'onSignInStatus', 'spawn', 'write', 'resize', 'kill', 'list', 'getBuffer',
      'onData', 'onExit', 'pickFolder', 'getDefaultCwd'
    ]) {
      expect(src, `preload should define ${name}`).toMatch(new RegExp(String.raw`\b${name}\b`))
    }
  })
})

// ---- Phase 3 (contract v3) ----

const V3_INVOKE = {
  transcriptsListSessions: 'transcripts:list-sessions',
  transcriptsSelect: 'transcripts:select',
  transcriptsGetSelection: 'transcripts:get-selection',
  usageGetToday: 'usage:get-today'
} as const

const V3_PUSH = {
  teamChanged: 'team:changed',
  transcriptsSessionsChanged: 'transcripts:sessions-changed',
  usageChanged: 'usage:changed'
} as const

describe('R-01 IPC contract v3', () => {
  const ipc = IPC as Record<string, string>
  const preload = (): string => readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

  it.each(Object.entries(V3_INVOKE))('R-01 IPC.%s = %s and is an invoke channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(INVOKE_CHANNELS).toContain(channel)
    expect(PUSH_CHANNELS as readonly string[]).not.toContain(channel)
  })

  it.each(Object.entries(V3_PUSH))('R-01 IPC.%s = %s is a push-only channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(PUSH_CHANNELS as readonly string[]).toContain(channel)
    expect(INVOKE_CHANNELS as readonly string[]).not.toContain(channel)
  })

  it('R-01 no push channel is invokable and every new channel matches the naming pattern', () => {
    for (const c of Object.values(V3_PUSH)) expect(INVOKE_CHANNELS as readonly string[]).not.toContain(c)
    for (const c of [...Object.values(V3_INVOKE), ...Object.values(V3_PUSH)]) expect(c).toMatch(/^[a-z]+:[a-z-]+$/)
  })

  it('R-01 team:event stays as an (unused) push channel', () => {
    expect(PUSH_CHANNELS as readonly string[]).toContain(IPC.teamEvent)
  })

  it('R-01 every channel value is still unique and INVOKE_CHANNELS = all channels minus pushes', () => {
    const all = Object.values(IPC)
    expect(new Set(all).size).toBe(all.length)
    const expected = all.filter((c) => !(PUSH_CHANNELS as readonly string[]).includes(c))
    expect([...INVOKE_CHANNELS].sort()).toEqual([...expected].sort())
  })

  it('R-01 PUSH_CHANNELS holds the v2 pushes plus the three new ones', () => {
    for (const c of ['team:event', 'accounts:changed', 'accounts:sign-in-status', 'pty:data', 'pty:exit', ...Object.values(V3_PUSH)]) {
      expect(PUSH_CHANNELS as readonly string[]).toContain(c)
    }
    expect(PUSH_CHANNELS.length).toBe(8)
  })

  it('R-01 the preload bridge references every new channel constant', () => {
    const src = preload()
    for (const key of [...Object.keys(V3_INVOKE), ...Object.keys(V3_PUSH)]) expect(src, `preload should use IPC.${key}`).toContain(`IPC.${key}`)
  })

  it('R-01 the preload exposes the transcripts / usage / team.onChanged surface', () => {
    const src = preload()
    for (const name of ['transcripts', 'usage', 'listSessions', 'select', 'getSelection', 'onSessionsChanged', 'getToday', 'onChanged']) {
      expect(src, `preload should define ${name}`).toMatch(new RegExp(String.raw`\b${name}\b`))
    }
  })
})
