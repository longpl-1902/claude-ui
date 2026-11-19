// T21 / R-22, R-23, F1-F3: attention hub = light status of every live session + deduped attention items + per-project status.
// Everything injected: in-memory transcripts (read-only), session list, controlled sessions, hook events, manual timers.
import { beforeEach, describe, expect, it } from 'vitest'
import { createStatusHub } from '../../../src/main/attention/statusHub'
import { createMemoryByteFs, type MemoryByteFs } from '../transcripts/memoryByteFs'
import {
  T0_MS, apiErrorLine, askUserQuestionUse, assistantBlocks, at, exitPlanModeUse, jsonl, textBlock, toolResult, userPrompt
} from '../../fixtures/transcripts/builders'

const NOW = T0_MS + 3_600_000
const CFG = 'C:/Users/u/.claude-acme'
const PROJ = { key: 'c:/users/u/acme', name: 'acme', root: 'C:/Users/u/acme', git: true }
const PROJ2 = { key: 'c:/users/u/beta', name: 'beta', root: 'C:/Users/u/beta', git: true }
const S1 = '11111111-aaaa-4bbb-8ccc-000000000001'
const S2 = '22222222-aaaa-4bbb-8ccc-000000000002'
const S3 = '33333333-aaaa-4bbb-8ccc-000000000003'
const sec = (s: number): string => at(3600 + s) // seconds relative to NOW
const msAt = (s: number): number => NOW + s * 1000

const sess = (sessionId: string, o: Record<string, unknown> = {}): any => ({
  sessionId, accountId: 'acme', configDir: CFG, projectDir: 'C--Users-u-acme', cwd: 'C:/Users/u/acme', mtimeMs: NOW - 60_000, sizeBytes: 0,
  live: true, registryStatus: 'busy', project: PROJ, entrypoint: 'cli', registryPid: 4242, ...o
})
const fileOf = (s: any): string => `${s.configDir}/projects/${s.projectDir}/${s.sessionId}.jsonl`

let msgN = 0
const asst = (blocks: Record<string, unknown>[], s: number, extra: Record<string, unknown> = {}) =>
  assistantBlocks(blocks, { messageId: `msg_${++msgN}`, stopReason: 'tool_use', ts: sec(s), sessionId: S1, ...extra })

interface Ctx {
  fs: MemoryByteFs
  sessions: any[]
  controls: any[]
  usage: Record<string, any>
  now: number
  hub: ReturnType<typeof createStatusHub>
  pushes: any[]
  timers: Map<number, { at: number; fn: () => void }>
  advance(ms: number): void
}
function setup(sessions: any[], transcripts: Record<string, unknown[]> = {}, o: { controls?: any[]; usage?: Record<string, any> } = {}): Ctx {
  const files: Record<string, string> = {}
  for (const s of sessions) files[fileOf(s)] = jsonl(transcripts[s.sessionId] ?? [userPrompt('hi', { ts: sec(-100), sessionId: s.sessionId, parentUuid: null })])
  const fs = createMemoryByteFs(files)
  const ctx: Ctx = { fs, sessions, controls: o.controls ?? [], usage: o.usage ?? {}, now: NOW, hub: undefined as never, pushes: [], timers: new Map(), advance: () => {} }
  let seq = 0
  ctx.advance = (ms) => {
    const target = ctx.now + ms
    for (;;) {
      const due = [...ctx.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      ctx.timers.delete(due[0])
      ctx.now = Math.max(ctx.now, due[1].at)
      due[1].fn()
    }
    ctx.now = target
  }
  ctx.hub = createStatusHub({
    fs, nowMs: () => ctx.now, listSessions: async () => ctx.sessions, controls: () => ctx.controls, sessionFile: fileOf,
    usageByProject: () => ctx.usage,
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; ctx.timers.set(id, { at: ctx.now + ms, fn }); return id },
    clearTimer: (t: unknown) => void ctx.timers.delete(t as number)
  } as never)
  ctx.hub.onChanged((s) => ctx.pushes.push(s))
  return ctx
}
const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)) }
const items = (c: Ctx): any[] => c.hub.snapshot().items as any[]
const proj = (c: Ctx, key = PROJ.key): any => (c.hub.snapshot().projects as any[]).find((p) => p.key === key)
const hookEv = (event: string, over: Record<string, unknown> = {}): any => ({ event, sessionId: S1, receivedMs: msAt(-30), ...over })

beforeEach(() => { msgN = 0 })

describe('R-23 items from transcripts: open questions and plans', () => {
  it('R-23 an open AskUserQuestion is a blocked question item with project, session, agent and a stable id', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-120), sessionId: S1, parentUuid: null }), ...asst([askUserQuestionUse('q1', 'Which database?')], -60)] })
    await c.hub.refresh()
    expect(items(c)).toHaveLength(1)
    expect(items(c)[0]).toMatchObject({
      kind: 'question', severity: 'blocked', projectKey: PROJ.key, projectName: 'acme', accountId: 'acme', sessionId: S1, agentId: 'lead', external: true, sinceMs: msAt(-60)
    })
    expect(typeof items(c)[0].id).toBe('string')
    expect(typeof items(c)[0].detail).toBe('string')
    const id = items(c)[0].id
    await c.hub.refresh()
    expect(items(c)[0].id).toBe(id)
  })
  it('R-23 an open ExitPlanMode is a plan item', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-120), sessionId: S1, parentUuid: null }), ...asst([exitPlanModeUse('p1', 'Step 1\nStep 2')], -50)] })
    await c.hub.refresh()
    expect(items(c).map((i) => [i.kind, i.severity])).toEqual([['plan', 'blocked']])
  })
  it('R-23 the item disappears once the tool result arrives (appended bytes only, then onFileChanged)', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-120), sessionId: S1, parentUuid: null }), ...asst([askUserQuestionUse('q1', 'Which?')], -60)] })
    await c.hub.refresh()
    expect(items(c)).toHaveLength(1)
    c.fs.append(fileOf(s), jsonl([toolResult('q1', 'A', { ts: sec(-10), sessionId: S1 })]))
    c.hub.onFileChanged(fileOf(s))
    c.advance(2000)
    await settle()
    await c.hub.refresh()
    expect(items(c)).toEqual([])
  })
  it('R-23 resolved questions in the file never show up', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-120), sessionId: S1, parentUuid: null }), ...asst([askUserQuestionUse('q1', 'Which?')], -100), toolResult('q1', 'A', { ts: sec(-90), sessionId: S1 })] })
    await c.hub.refresh()
    expect(items(c)).toEqual([])
  })
  it('R-23 an API error as the last turn (within 30 min) is a blocked api-error item; a later assistant message clears it', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-300), sessionId: S1, parentUuid: null }), apiErrorLine('rate_limit', { ts: sec(-200), sessionId: S1 })] })
    await c.hub.refresh()
    expect(items(c).map((i) => [i.kind, i.severity])).toEqual([['api-error', 'blocked']])
    c.fs.append(fileOf(s), jsonl(asst([textBlock('recovered')], -20, { stopReason: 'end_turn' })))
    c.hub.onFileChanged(fileOf(s))
    c.advance(2000)
    await settle()
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'api-error')).toEqual([])
  })
  it('R-23 an API error older than 30 minutes is not an item', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-4000), sessionId: S1, parentUuid: null }), apiErrorLine('rate_limit', { ts: sec(-3600), sessionId: S1 })] })
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'api-error')).toEqual([])
  })
})

describe('R-23 items from the registry (F2 severity)', () => {
  it('R-23 registry waiting -> a blocked input item', async () => {
    const c = setup([sess(S1, { registryStatus: 'waiting' })])
    await c.hub.refresh()
    expect(items(c).map((i) => [i.kind, i.severity, i.external])).toEqual([['input', 'blocked', true]])
  })
  it('F2 a live session that is idle after a turn is an IDLE item (kind input), never blocked', async () => {
    const c = setup([sess(S1, { registryStatus: 'idle' })], { [S1]: [userPrompt('go', { ts: sec(-120), sessionId: S1, parentUuid: null }), ...asst([textBlock('done')], -60, { stopReason: 'end_turn' })] })
    await c.hub.refresh()
    expect(items(c).map((i) => [i.kind, i.severity])).toEqual([['input', 'idle']])
  })
  it('R-23 busy sessions produce no item', async () => {
    const c = setup([sess(S1, { registryStatus: 'busy' })])
    await c.hub.refresh()
    expect(items(c)).toEqual([])
  })
  it('R-23 items are sorted oldest first', async () => {
    const s1 = sess(S1)
    const s2 = sess(S2, { registryStatus: 'waiting' })
    const c = setup([s1, s2], { [S1]: [userPrompt('go', { ts: sec(-500), sessionId: S1, parentUuid: null }), ...asst([askUserQuestionUse('q1', 'Q?')], -100)] })
    c.hub.ingestHook(hookEv('PermissionRequest', { sessionId: S2, toolName: 'Bash', receivedMs: msAt(-300) }))
    await c.hub.refresh()
    const since = items(c).map((i) => i.sinceMs)
    expect(since).toEqual([...since].sort((a, b) => a - b))
    expect(items(c).length).toBeGreaterThanOrEqual(2)
  })
})

describe('R-23 / F1 items from controlled sessions', () => {
  const prompt = (over: Record<string, unknown> = {}) => ({
    requestId: 'req_1', toolName: 'Bash', displayName: 'Bash', inputPreview: 'npm run build && node scripts/deploy.mjs --env staging', canAllowSession: true,
    decisionReason: 'Not in allow list', receivedAt: new Date(msAt(-40)).toISOString(), ...over
  })
  const ctl = (permissions: any[] = [prompt()]) => ({
    info: { id: 'c1', accountId: 'acme', cwd: 'C:/Users/u/acme', state: 'busy', permissionMode: 'default', sessionId: S1, slashCommands: [], pendingPermissions: permissions.length, queuedTurns: 0 },
    permissions
  })
  const csess = () => sess(S1, { controlled: true, controlId: 'c1', entrypoint: 'sdk-cli', registryPid: undefined, live: false, registryStatus: undefined })

  it('F1 a pending permission carries controlId, requestId, canAllowSession, toolName, full input and cwd; it is app-controlled (external false)', async () => {
    const c = setup([csess()], {}, { controls: [ctl()] })
    await c.hub.refresh()
    const p = items(c).find((i) => i.kind === 'permission')
    expect(p).toBeDefined()
    expect(p).toMatchObject({
      severity: 'blocked', external: false, controlId: 'c1', requestId: 'req_1', canAllowSession: true, toolName: 'Bash', cwd: 'C:/Users/u/acme', sessionId: S1, projectKey: PROJ.key, sinceMs: msAt(-40)
    })
    expect(String(p.input)).toContain('npm run build && node scripts/deploy.mjs --env staging')
  })
  it('F1 the displayed input is capped around 4 kB', async () => {
    const c = setup([csess()], {}, { controls: [ctl([prompt({ inputPreview: 'x'.repeat(10_000) })])] })
    await c.hub.refresh()
    const p = items(c).find((i) => i.kind === 'permission')
    expect(String(p.input).length).toBeLessThanOrEqual(4200)
    expect(String(p.input).length).toBeGreaterThan(1000)
  })
  it('R-23 several prompts of one session are separate items with distinct stable ids', async () => {
    const c = setup([csess()], {}, { controls: [ctl([prompt(), prompt({ requestId: 'req_2', toolName: 'Write', inputPreview: 'C:/Users/u/acme/a.ts' })])] })
    await c.hub.refresh()
    const perms = items(c).filter((i) => i.kind === 'permission')
    expect(perms).toHaveLength(2)
    expect(new Set(perms.map((p) => p.id)).size).toBe(2)
    const ids = perms.map((p) => p.id)
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'permission').map((p) => p.id)).toEqual(ids)
  })
  it('R-23 answering (prompt gone from controls) removes the item on the next refresh', async () => {
    const c = setup([csess()], {}, { controls: [ctl()] })
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'permission')).toHaveLength(1)
    c.controls = [ctl([])]
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'permission')).toEqual([])
  })
  it('R-23 a controlled session in state draft or exited is not tracked', async () => {
    const c = setup([csess()], {}, { controls: [{ ...ctl(), info: { ...ctl().info, state: 'exited' } }] })
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'permission')).toEqual([])
  })
})

describe('R-23 / F1 / F2 items from hooks', () => {
  const live = () => setup([sess(S1)])
  it('F1 PermissionRequest -> external blocked permission item with toolName and cwd, no controlId', async () => {
    const c = live()
    c.hub.ingestHook(hookEv('PermissionRequest', { toolName: 'Write', cwd: 'C:/Users/u/acme-wt/feat' }))
    await c.hub.refresh()
    const p = items(c).find((i) => i.kind === 'permission')
    expect(p).toMatchObject({ severity: 'blocked', external: true, toolName: 'Write', cwd: 'C:/Users/u/acme-wt/feat', agentId: 'lead', sinceMs: msAt(-30) })
    expect(p.controlId).toBeUndefined()
    expect(p.requestId).toBeUndefined()
  })
  it('R-23 Notification permission_prompt also gives a permission item', async () => {
    const c = live()
    c.hub.ingestHook(hookEv('Notification', { notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' }))
    await c.hub.refresh()
    expect(items(c).map((i) => [i.kind, i.severity])).toContainEqual(['permission', 'blocked'])
  })
  it('R-23 agent_needs_input / elicitation_dialog -> blocked input items', async () => {
    for (const type of ['agent_needs_input', 'elicitation_dialog']) {
      const c = live()
      c.hub.ingestHook(hookEv('Notification', { notificationType: type, message: 'Need a value' }))
      await c.hub.refresh()
      expect(items(c).map((i) => [i.kind, i.severity]), type).toContainEqual(['input', 'blocked'])
    }
  })
  it('F2 idle_prompt and agent_completed notifications are IDLE items (never blocked)', async () => {
    for (const type of ['idle_prompt', 'agent_completed']) {
      const c = live()
      c.hub.ingestHook(hookEv('Notification', { notificationType: type }))
      await c.hub.refresh()
      const hooked = items(c).filter((i) => i.sinceMs === msAt(-30))
      expect(hooked.length, type).toBeGreaterThan(0)
      for (const i of hooked) expect(i.severity, type).toBe('idle')
    }
  })
  it('R-23 sub-agent prompts (agent_id from hooks) belong to that agent', async () => {
    const c = live()
    c.hub.ingestHook(hookEv('PermissionRequest', { toolName: 'Edit', agentId: 'a1b2c3d4e5f6a7b81', agentType: 'Explore' }))
    await c.hub.refresh()
    expect(items(c).find((i) => i.kind === 'permission').agentId).toBe('a1b2c3d4e5f6a7b81')
  })
  it('R-23 the next tool / stop event of that session clears the hook item (same rules as applyHook)', async () => {
    for (const ev of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']) {
      const c = live()
      c.hub.ingestHook(hookEv('PermissionRequest', { toolName: 'Bash' }))
      await c.hub.refresh()
      expect(items(c).filter((i) => i.kind === 'permission'), ev).toHaveLength(1)
      c.hub.ingestHook(hookEv(ev, { receivedMs: msAt(-10) }))
      await c.hub.refresh()
      expect(items(c).filter((i) => i.kind === 'permission'), ev).toEqual([])
    }
  })
  it('R-23 hooks for a session that is not in the session list produce no item', async () => {
    const c = live()
    c.hub.ingestHook(hookEv('PermissionRequest', { sessionId: S3, toolName: 'Bash' }))
    await c.hub.refresh()
    expect(items(c)).toEqual([])
  })
  it('R-23 a session with a hook event in the last 10 min is tracked even when it is not live', async () => {
    const c = setup([sess(S1, { live: false, registryStatus: undefined })])
    c.hub.ingestHook(hookEv('PermissionRequest', { toolName: 'Bash', receivedMs: msAt(-120) }))
    await c.hub.refresh()
    expect(items(c).filter((i) => i.kind === 'permission')).toHaveLength(1)
  })
  it('R-23 hook ingestion pushes onChanged after a refresh', async () => {
    const c = live()
    c.hub.ingestHook(hookEv('PermissionRequest', { toolName: 'Bash' }))
    await c.hub.refresh()
    expect(c.pushes.length).toBeGreaterThan(0)
    expect(c.pushes[c.pushes.length - 1].items.length).toBeGreaterThan(0)
  })
})

describe('R-22 per-project status', () => {
  it('R-22 groups ALL recent sessions by project key with name, root, live and running counts', async () => {
    const c = setup([
      sess(S1, { registryStatus: 'busy' }),
      sess(S2, { registryStatus: 'idle' }),
      sess(S3, { project: PROJ2, projectDir: 'C--Users-u-beta', cwd: 'C:/Users/u/beta', live: false, registryStatus: undefined, accountId: 'acme' })
    ])
    await c.hub.refresh()
    expect(proj(c)).toMatchObject({ key: PROJ.key, name: 'acme', root: PROJ.root, git: true, liveSessions: 2, running: 1 })
    expect(proj(c, PROJ2.key)).toMatchObject({ name: 'beta', liveSessions: 0, running: 0 })
  })
  it('R-22 sessions older than 24 h do not create a project', async () => {
    const c = setup([sess(S1), sess(S3, { project: PROJ2, mtimeMs: NOW - 25 * 3_600_000, live: false, registryStatus: undefined })])
    await c.hub.refresh()
    expect(proj(c, PROJ2.key)).toBeUndefined()
  })
  it('R-22 account stripe data: distinct accounts of LIVE sessions, mixedAccounts when more than one', async () => {
    const one = setup([sess(S1), sess(S2)])
    await one.hub.refresh()
    expect(proj(one)).toMatchObject({ accountIds: ['acme'], mixedAccounts: false })
    const two = setup([sess(S1), sess(S2, { accountId: 'beta' }), sess(S3, { accountId: 'gamma', live: false, registryStatus: undefined })])
    await two.hub.refresh()
    expect([...proj(two).accountIds].sort()).toEqual(['acme', 'beta'])
    expect(proj(two).mixedAccounts).toBe(true)
  })
  it('R-22 controlled busy sessions count as running', async () => {
    const cs = sess(S1, { controlled: true, controlId: 'c1', live: false, registryStatus: undefined, entrypoint: 'sdk-cli' })
    const c = setup([cs], {}, { controls: [{ info: { id: 'c1', accountId: 'acme', cwd: 'C:/Users/u/acme', state: 'busy', sessionId: S1, permissionMode: 'default', slashCommands: [], pendingPermissions: 0, queuedTurns: 0 }, permissions: [] }] })
    await c.hub.refresh()
    expect(proj(c).running).toBe(1)
  })
  it('R-26 tokensToday comes from usageByProject for the project key', async () => {
    const c = setup([sess(S1)], {}, { usage: { [PROJ.key]: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0 } } })
    await c.hub.refresh()
    expect(proj(c).tokensToday).toBe(150)
    const none = setup([sess(S1)])
    await none.hub.refresh()
    expect(proj(none).tokensToday).toBe(0)
  })
  it('R-22 lastActivityMs is the newest session mtime of the project', async () => {
    const c = setup([sess(S1, { mtimeMs: NOW - 600_000 }), sess(S2, { mtimeMs: NOW - 5_000, registryStatus: 'idle' })])
    await c.hub.refresh()
    expect(proj(c).lastActivityMs).toBe(NOW - 5_000)
  })
  it('F2 needsYou counts BLOCKED items only: an idle item never raises it', async () => {
    const c = setup([sess(S1, { registryStatus: 'idle' })], { [S1]: [userPrompt('go', { ts: sec(-120), sessionId: S1, parentUuid: null }), ...asst([textBlock('done')], -60, { stopReason: 'end_turn' })] })
    await c.hub.refresh()
    expect(items(c).some((i) => i.severity === 'idle')).toBe(true)
    expect(proj(c).needsYou).toBe(0)
  })
  it('R-22 needsYou counts the blocked items of the project (question + permission)', async () => {
    const c = setup([sess(S1), sess(S2)], { [S1]: [userPrompt('go', { ts: sec(-300), sessionId: S1, parentUuid: null }), ...asst([askUserQuestionUse('q1', 'Q?')], -100)] })
    c.hub.ingestHook(hookEv('PermissionRequest', { sessionId: S2, toolName: 'Bash' }))
    await c.hub.refresh()
    expect(proj(c).needsYou).toBe(2)
  })
  it('F3 hooksActive: true when a hook event for the project arrived in the last 24 h, false otherwise', async () => {
    const c = setup([sess(S1), sess(S3, { project: PROJ2, projectDir: 'C--Users-u-beta', cwd: 'C:/Users/u/beta' })])
    c.hub.ingestHook(hookEv('PreToolUse', { receivedMs: msAt(-3 * 3600) }))
    await c.hub.refresh()
    expect(proj(c).hooksActive).toBe(true)
    expect(proj(c, PROJ2.key).hooksActive).toBe(false)
  })
  it('F3 hooksActive expires after 24 h without events', async () => {
    const c = setup([sess(S1)])
    c.hub.ingestHook(hookEv('PreToolUse', { receivedMs: NOW - 1000 }))
    await c.hub.refresh()
    expect(proj(c).hooksActive).toBe(true)
    c.now = NOW + 25 * 3_600_000
    c.sessions = [sess(S1, { mtimeMs: c.now - 1000 })]
    await c.hub.refresh()
    expect(proj(c).hooksActive).toBe(false)
  })
})

describe('R-22 tracking limits and cost bound (D13)', () => {
  it('R-22 at most 20 sessions are tracked (the newest); projects still count all live sessions', async () => {
    const sessions = Array.from({ length: 25 }, (_, i) => {
      const id = `00000000-aaaa-4bbb-8ccc-${String(i).padStart(12, '0')}`
      return sess(id, { mtimeMs: NOW - (25 - i) * 1000 })
    })
    const tr: Record<string, unknown[]> = {}
    for (const s of sessions) tr[s.sessionId] = [userPrompt('go', { ts: sec(-300), sessionId: s.sessionId, parentUuid: null }), ...asst([askUserQuestionUse(`q-${s.sessionId}`, 'Q?')], -100, { sessionId: s.sessionId })]
    const c = setup(sessions, tr)
    await c.hub.refresh()
    expect(items(c)).toHaveLength(20)
    expect(new Set(items(c).map((i) => i.sessionId)).size).toBe(20)
    expect(items(c).some((i) => i.sessionId === sessions[0]!.sessionId)).toBe(false)
    expect(items(c).some((i) => i.sessionId === sessions[24]!.sessionId)).toBe(true)
    expect(proj(c).liveSessions).toBe(25)
  })
  it('D13 the first read starts at max(0, size - 256 KiB); a small file is read from 0', async () => {
    const s = sess(S1)
    const big = userPrompt('x'.repeat(400_000), { ts: sec(-300), sessionId: S1, parentUuid: null })
    const c = setup([s], { [S1]: [big, ...asst([askUserQuestionUse('q1', 'Q?')], -100)] })
    const size = c.fs.bytes(fileOf(s))!.length
    await c.hub.refresh()
    expect(c.fs.rangeCalls[0]).toMatchObject({ path: fileOf(s), start: size - 256 * 1024 })
    expect(items(c).map((i) => i.kind)).toEqual(['question'])
    const small = setup([sess(S2)])
    await small.hub.refresh()
    expect(small.fs.rangeCalls[0]!.start).toBe(0)
  })
  it('D13 later refreshes read only the appended bytes', async () => {
    const s = sess(S1)
    const c = setup([s], { [S1]: [userPrompt('go', { ts: sec(-300), sessionId: S1, parentUuid: null })] })
    await c.hub.refresh()
    const size1 = c.fs.bytes(fileOf(s))!.length
    c.fs.append(fileOf(s), jsonl(asst([askUserQuestionUse('q1', 'Q?')], -50)))
    c.hub.onFileChanged(fileOf(s))
    c.advance(2000)
    await settle()
    await c.hub.refresh()
    const starts = c.fs.rangeCalls.map((r) => r.start)
    expect(starts[starts.length - 1]).toBe(size1)
    expect(items(c).map((i) => i.kind)).toEqual(['question'])
  })
  it('D13 onFileChanged for an untracked path reads nothing', async () => {
    const c = setup([sess(S1)])
    await c.hub.refresh()
    c.fs.clearLog()
    c.hub.onFileChanged('C:/Users/u/.claude-acme/projects/other/zzz.jsonl')
    c.advance(5000)
    await settle()
    expect(c.fs.reads).toEqual([])
  })
  it('D13 only main transcripts are read: never sub-agent files or non-jsonl files', async () => {
    const s = sess(S1)
    const c = setup([s])
    c.fs.set(`${CFG}/projects/C--Users-u-acme/${S1}/subagents/agent-a1.jsonl`, jsonl([userPrompt('sub', { ts: sec(-5), sessionId: S1, agentId: 'a1', parentUuid: null })]))
    await c.hub.refresh()
    for (const p of c.fs.reads) {
      expect(p).toMatch(/\.jsonl$/)
      expect(p).not.toContain('/subagents/')
    }
    expect(c.fs.writes).toEqual([])
  })
  it('R-19 the hub has no write path: the injected fs exposes none and nothing is spawned or written', async () => {
    const c = setup([sess(S1, { registryStatus: 'waiting' })])
    await c.hub.refresh()
    c.hub.dispose()
    expect(c.fs.writes).toEqual([])
  })
})

describe('R-22 snapshot / onChanged', () => {
  it('R-22 snapshot() has items, projects and updatedAt; an empty hub gives empty lists', async () => {
    const c = setup([])
    await c.hub.refresh()
    expect(c.hub.snapshot()).toMatchObject({ items: [], projects: [] })
    expect(typeof c.hub.snapshot().updatedAt).toBe('string')
  })
  it('R-22 onChanged fires when the result changes and not for an identical refresh', async () => {
    const c = setup([sess(S1, { registryStatus: 'waiting' })])
    await c.hub.refresh()
    const n = c.pushes.length
    expect(n).toBeGreaterThan(0)
    await c.hub.refresh()
    expect(c.pushes).toHaveLength(n)
    c.sessions = [sess(S1, { registryStatus: 'busy' })]
    await c.hub.refresh()
    expect(c.pushes).toHaveLength(n + 1)
  })
  it('R-22 onChanged can be unsubscribed and dispose clears timers', async () => {
    const c = setup([sess(S1, { registryStatus: 'waiting' })])
    const got: unknown[] = []
    const off = c.hub.onChanged((s) => got.push(s))
    off()
    await c.hub.refresh()
    expect(got).toHaveLength(0)
    c.hub.onFileChanged(fileOf(sess(S1)))
    c.hub.dispose()
    expect(c.timers.size).toBe(0)
  })
  it('R-22 a listSessions failure keeps the previous snapshot and does not throw', async () => {
    const c = setup([sess(S1, { registryStatus: 'waiting' })])
    await c.hub.refresh()
    const before = items(c).length
    c.sessions = null as never
    await expect(c.hub.refresh()).resolves.toBeUndefined()
    expect(items(c)).toHaveLength(before)
  })
})
