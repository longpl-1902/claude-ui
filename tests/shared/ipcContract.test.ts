import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS, IPC, PUSH_CHANNELS } from '@shared/ipc'
import {
  createHandlers, isControlStartRequest, isEffort, isImageAttachment, isImageList, isMcpAddRequest, isPermissionAnswer, isUuid
} from '../../src/main/ipc/handlers'

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

  it('R-01 PUSH_CHANNELS contains teamEvent, the four v2 pushes and the three v3 pushes (v4 adds more, see below)', () => {
    for (const c of [
      IPC.teamEvent, 'accounts:changed', 'accounts:sign-in-status', 'pty:data', 'pty:exit',
      'team:changed', 'transcripts:sessions-changed', 'usage:changed'
    ]) expect(PUSH_CHANNELS as readonly string[]).toContain(c)
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
    expect(PUSH_CHANNELS.length).toBeGreaterThanOrEqual(8)
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

// ---- Phase 3b/4/5 (contract v4, T01) ----
// Assumption: IPC keys are the camelCase of the channel (control:set-model -> controlSetModel).

const V4_INVOKE = {
  controlStart: 'control:start',
  controlSend: 'control:send',
  controlInterrupt: 'control:interrupt',
  controlStop: 'control:stop',
  controlAnswer: 'control:answer',
  controlSetModel: 'control:set-model',
  controlSetMode: 'control:set-mode',
  controlList: 'control:list',
  controlGetStream: 'control:get-stream',
  sessionKillExternal: 'session:kill-external',
  gitWatch: 'git:watch',
  gitCompare: 'git:compare',
  hooksStatus: 'hooks:status',
  hooksPreview: 'hooks:preview',
  hooksApply: 'hooks:apply',
  attentionGet: 'attention:get',
  attentionGetPrefs: 'attention:get-prefs',
  attentionSetPrefs: 'attention:set-prefs'
} as const

const V4_PUSH = {
  controlChanged: 'control:changed',
  controlStream: 'control:stream',
  gitChanged: 'git:changed',
  hooksChanged: 'hooks:changed',
  attentionChanged: 'attention:changed',
  attentionFocus: 'attention:focus'
} as const

describe('R-01 IPC contract v4', () => {
  const ipc = IPC as Record<string, string>
  const preload = (): string => readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

  it.each(Object.entries(V4_INVOKE))('R-01 IPC.%s = %s and is an invoke channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(INVOKE_CHANNELS as readonly string[]).toContain(channel)
    expect(PUSH_CHANNELS as readonly string[]).not.toContain(channel)
  })

  it.each(Object.entries(V4_PUSH))('R-01 IPC.%s = %s is a push-only channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(PUSH_CHANNELS as readonly string[]).toContain(channel)
    expect(INVOKE_CHANNELS as readonly string[]).not.toContain(channel)
  })

  it('R-01 PUSH_CHANNELS = v2 + v3 pushes + the six v4 pushes + the v5 push (15), no duplicates', () => {
    expect([...PUSH_CHANNELS].sort()).toEqual(
      [
        'team:event', 'accounts:changed', 'accounts:sign-in-status', 'pty:data', 'pty:exit',
        'team:changed', 'transcripts:sessions-changed', 'usage:changed',
        ...Object.values(V4_PUSH),
        'control:details-changed'
      ].sort()
    )
    expect(PUSH_CHANNELS.length).toBe(15)
  })

  it('R-01 INVOKE_CHANNELS = every channel minus pushes, still unique, v4 names match the pattern', () => {
    const all = Object.values(IPC)
    expect(new Set(all).size).toBe(all.length)
    const expected = all.filter((c) => !(PUSH_CHANNELS as readonly string[]).includes(c))
    expect([...INVOKE_CHANNELS].sort()).toEqual([...expected].sort())
    for (const c of [...Object.values(V4_INVOKE), ...Object.values(V4_PUSH)]) expect(c).toMatch(/^[a-z]+:[a-z-]+$/)
  })

  it('R-01 the legacy agent:*, team:pause-all and worktree:open-in-editor channels are unchanged', () => {
    for (const c of ['agent:pause', 'team:pause-all', 'worktree:open-in-editor']) expect(INVOKE_CHANNELS as readonly string[]).toContain(c)
  })

  it('R-01 the preload bridge references every v4 channel constant', () => {
    const src = preload()
    for (const key of [...Object.keys(V4_INVOKE), ...Object.keys(V4_PUSH)]) expect(src, `preload should use IPC.${key}`).toContain(`IPC.${key}`)
  })

  it('R-01 the preload exposes control / git / hooks / attention / session.killExternal', () => {
    const src = preload()
    for (const name of [
      'control', 'git', 'hooks', 'attention', 'killExternal', 'start', 'send', 'interrupt', 'stop', 'answer', 'setModel',
      'setMode', 'getStream', 'watch', 'compare', 'status', 'preview', 'apply', 'getPrefs', 'setPrefs', 'onStream', 'onFocus'
    ]) {
      expect(src, `preload should define ${name}`).toMatch(new RegExp(String.raw`\b${name}\b`))
    }
  })
})

// ---- Contract v5: VS Code parity (T23) ----

const V5_INVOKE = {
  controlDetails: 'control:details',
  controlSendRich: 'control:send-rich',
  controlRefreshContext: 'control:refresh-context',
  controlMcpToggle: 'control:mcp-toggle',
  controlMcpReconnect: 'control:mcp-reconnect',
  controlFileSuggestions: 'control:file-suggestions',
  controlRewindPreview: 'control:rewind-preview',
  controlRewind: 'control:rewind',
  controlForkAt: 'control:fork-at',
  controlSetEffort: 'control:set-effort',
  controlSetOutputStyle: 'control:set-output-style',
  controlRename: 'control:rename',
  controlGetPlan: 'control:get-plan',
  catalogList: 'catalog:list',
  catalogOpen: 'catalog:open',
  mcpList: 'mcp:list',
  mcpPreviewAdd: 'mcp:preview-add',
  mcpPreviewRemove: 'mcp:preview-remove',
  pluginsList: 'plugins:list',
  pluginsPreview: 'plugins:preview',
  cliApply: 'cli:apply'
} as const

describe('R-27..R-32 IPC contract v5', () => {
  const ipc = IPC as Record<string, string>
  const preload = (): string => readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

  it.each(Object.entries(V5_INVOKE))('IPC.%s = %s and is an invoke channel', (key, channel) => {
    expect(ipc[key]).toBe(channel)
    expect(INVOKE_CHANNELS as readonly string[]).toContain(channel)
    expect(PUSH_CHANNELS as readonly string[]).not.toContain(channel)
    expect(channel).toMatch(/^[a-z]+:[a-z-]+$/)
  })

  it('the details push is its own channel, distinct from the control:details invoke', () => {
    expect(IPC.controlDetailsChanged).toBe('control:details-changed')
    expect(PUSH_CHANNELS as readonly string[]).toContain(IPC.controlDetailsChanged)
    expect(INVOKE_CHANNELS as readonly string[]).not.toContain(IPC.controlDetailsChanged)
    expect(IPC.controlDetailsChanged).not.toBe(IPC.controlDetails)
  })

  it('channel values stay unique and INVOKE_CHANNELS = all minus pushes', () => {
    const all = Object.values(IPC)
    expect(new Set(all).size).toBe(all.length)
    const expected = all.filter((c) => !(PUSH_CHANNELS as readonly string[]).includes(c))
    expect([...INVOKE_CHANNELS].sort()).toEqual([...expected].sort())
  })

  it('the preload references every v5 channel constant and exposes the new groups', () => {
    const src = preload()
    for (const key of [...Object.keys(V5_INVOKE), 'controlDetailsChanged']) expect(src, `preload should use IPC.${key}`).toContain(`IPC.${key}`)
    for (const name of ['catalog', 'mcp', 'plugins', 'cli', 'onDetails', 'sendRich', 'fileSuggestions', 'rewindPreview', 'forkAt', 'previewAdd', 'apply']) {
      expect(src, `preload should define ${name}`).toMatch(new RegExp(String.raw`\b${name}\b`))
    }
  })

  describe('validators', () => {
    const png = Buffer.from('hello').toString('base64')
    it('isEffort accepts only the five levels', () => {
      for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) expect(isEffort(e)).toBe(true)
      for (const e of ['', 'LOW', 'ultra', null, undefined, 3]) expect(isEffort(e)).toBe(false)
    })

    it('isUuid accepts uuid-shaped ids only', () => {
      expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
      for (const u of ['', 'abc', '../etc/passwd', '123e4567-e89b-12d3-a456-42661417400', 42, null]) expect(isUuid(u)).toBe(false)
    })

    it('isImageAttachment enforces the media type whitelist, base64 charset and size', () => {
      expect(isImageAttachment({ mediaType: 'image/png', dataBase64: png })).toBe(true)
      expect(isImageAttachment({ mediaType: 'image/webp', dataBase64: png, name: 'a.webp' })).toBe(true)
      expect(isImageAttachment({ mediaType: 'image/svg+xml', dataBase64: png })).toBe(false)
      expect(isImageAttachment({ mediaType: 'image/png', dataBase64: 'not base64!!' })).toBe(false)
      expect(isImageAttachment({ mediaType: 'image/png', dataBase64: '' })).toBe(false)
      expect(isImageAttachment({ mediaType: 'image/png', dataBase64: png, name: 5 })).toBe(false)
      const atLimit = Buffer.alloc(5 * 1024 * 1024).toString('base64')
      const over = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')
      expect(isImageAttachment({ mediaType: 'image/png', dataBase64: atLimit })).toBe(true)
      expect(isImageAttachment({ mediaType: 'image/png', dataBase64: over })).toBe(false)
      expect(isImageAttachment(null)).toBe(false)
    })

    it('isImageList caps at 5 images', () => {
      const one = { mediaType: 'image/png', dataBase64: png }
      expect(isImageList([])).toBe(true)
      expect(isImageList(Array(5).fill(one))).toBe(true)
      expect(isImageList(Array(6).fill(one))).toBe(false)
      expect(isImageList('x')).toBe(false)
    })

    const mcp = {
      projectRoot: 'D:/p', accountId: 'a1', name: 'my-server_1.0', scope: 'project', transport: 'stdio',
      commandOrUrl: 'node', args: ['server.js'], env: { K: 'v' }, headers: {}
    }
    it('isMcpAddRequest validates name, enums and string maps', () => {
      expect(isMcpAddRequest(mcp)).toBe(true)
      expect(isMcpAddRequest({ ...mcp, name: 'bad name' })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, name: '' })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, name: 'a'.repeat(65) })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, scope: 'plugin' })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, transport: 'ws' })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, env: { K: 1 } })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, env: { K: 'x'.repeat(4097) } })).toBe(false)
      const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']))
      expect(isMcpAddRequest({ ...mcp, headers: many })).toBe(false)
      expect(isMcpAddRequest({ ...mcp, headers: Object.fromEntries(Object.entries(many).slice(0, 50)) })).toBe(true)
      expect(isMcpAddRequest({ ...mcp, args: 'x' })).toBe(false)
      expect(isMcpAddRequest(null)).toBe(false)
    })

    it('ControlStartRequest accepts effort/outputStyle and resumeAt only with resume.fork', () => {
      const base = { cwd: 'D:/p', accountId: 'a1' }
      const uuid = '123e4567-e89b-12d3-a456-426614174000'
      expect(isControlStartRequest({ ...base, effort: 'high', outputStyle: 'Explanatory' })).toBe(true)
      expect(isControlStartRequest({ ...base, effort: 'huge' })).toBe(false)
      expect(isControlStartRequest({ ...base, resume: { kind: 'resume', sessionId: 's', fork: true }, resumeAt: uuid })).toBe(true)
      expect(isControlStartRequest({ ...base, resume: { kind: 'resume', sessionId: 's' }, resumeAt: uuid })).toBe(false)
      expect(isControlStartRequest({ ...base, resumeAt: uuid })).toBe(false)
      expect(isControlStartRequest({ ...base, resume: { kind: 'resume', sessionId: 's', fork: true }, resumeAt: 'nope' })).toBe(false)
    })

    it('PermissionAnswer accepts an answers string map and rejects other shapes', () => {
      expect(isPermissionAnswer({ behavior: 'allow', answers: { 'Which?': 'A' } })).toBe(true)
      expect(isPermissionAnswer({ behavior: 'allow', answers: { q: 1 } })).toBe(false)
      expect(isPermissionAnswer({ behavior: 'allow', answers: ['a'] })).toBe(false)
      expect(isPermissionAnswer({ behavior: 'allow', scope: 'forever' })).toBe(false)
    })
  })

  describe('mock stubs never start anything (R-19)', () => {
    const h = createHandlers()
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    it('read-only stubs return empty values', async () => {
      expect(await h['control:details']('c1')).toBeNull()
      expect(await h['control:file-suggestions'](null, 'D:/p', 'x')).toEqual([])
      expect(await h['control:get-plan']('c1')).toEqual({ exists: false })
      expect(await h['catalog:list'](null, 'a1')).toEqual([])
      expect((await h['mcp:list']('D:/p', 'a1')).servers).toEqual([])
      expect((await h['plugins:list']('a1')).plugins).toEqual([])
    })
    it('mutating stubs answer not-implemented / not ok and never a controlId', async () => {
      expect(await h['control:send-rich']('c1', 'hi', [])).toEqual({ ok: false, reason: 'not-implemented' })
      expect(await h['control:rewind']('c1', uuid)).toEqual({ ok: false, reason: 'not-implemented' })
      expect(await h['control:set-effort']('c1', 'high')).toEqual({ ok: false, reason: 'not-implemented' })
      const fork = await h['control:fork-at']('c1', uuid)
      expect(fork.ok).toBe(false)
      expect(fork.controlId).toBeUndefined()
      expect(await h['cli:apply']('p1')).toEqual({ ok: false, reason: 'not-implemented' })
      expect((await h['control:rewind-preview']('c1', uuid)).canRewind).toBe(false)
    })
    it('invalid arguments are rejected as invalid-args', async () => {
      expect(await h['control:send-rich']('c1', 'hi', [{ mediaType: 'image/svg+xml', dataBase64: 'AAAA' }] as never)).toEqual({ ok: false, reason: 'invalid-args' })
      expect(await h['control:rewind']('c1', '../x')).toEqual({ ok: false, reason: 'invalid-args' })
      expect(await h['control:set-effort']('c1', 'ultra' as never)).toEqual({ ok: false, reason: 'invalid-args' })
      expect(await h['mcp:preview-add']({ name: 'x' } as never)).toEqual({ ok: false, reason: 'invalid-args' })
      expect(await h['plugins:preview']('a1', 'nuke' as never, 'p')).toEqual({ ok: false, reason: 'invalid-args' })
      expect(await h['cli:apply'](5 as never)).toEqual({ ok: false, reason: 'invalid-args' })
    })
  })
})
