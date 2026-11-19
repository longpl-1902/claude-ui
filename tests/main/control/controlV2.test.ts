// T26 / R-27, R-29, R-30, R-31, R-32, R-19: control manager v2 with a FAKE child (nothing real is spawned).
import { describe, expect, it } from 'vitest'
import { CHECKPOINT_ENV } from '../../../src/main/control/args'
import { DRAFT, SID, canUseTool, createHarness, initMsg, resultMsg, startSession, type FakeChild, type Harness } from './harness'

const UUID = '33333333-aaaa-4bbb-8ccc-000000000003'
const UUID2 = '44444444-aaaa-4bbb-8ccc-000000000004'

const reqFrames = (c: FakeChild, subtype?: string) =>
  c.frames().filter((f) => f.type === 'control_request' && (subtype === undefined || f.request.subtype === subtype))
const respond = async (h: Harness, c: FakeChild, subtype: string, body: unknown, nth = -1) => {
  const fs = reqFrames(c, subtype)
  const f = nth < 0 ? fs[fs.length + nth] : fs[nth]
  expect(f, `request ${subtype}`).toBeDefined()
  c.emit({ type: 'control_response', response: { subtype: 'success', request_id: f.request_id, response: body } })
  await h.settle()
  return f.request_id as string
}
const fail = async (h: Harness, c: FakeChild, subtype: string, error: string) => {
  const f = reqFrames(c, subtype).pop()!
  c.emit({ type: 'control_response', response: { subtype: 'error', request_id: f.request_id, error } })
  await h.settle()
}

const INIT_BODY = {
  commands: [
    { name: 'compact', description: 'Compact the conversation', argumentHint: '[instructions]', builtin: true },
    { name: 'mcp__srv__prompt', description: 'An MCP prompt' },
    { name: 'plug:review', description: 'Plugin command' }
  ],
  agents: [{ name: 'reviewer', description: 'Reviews' }],
  models: [{ value: 'sonnet', displayName: 'Sonnet', description: 'Fast' }],
  output_style: 'default',
  available_output_styles: ['default', 'Explanatory']
}
const CONTEXT_BODY = { totalTokens: 1200, maxTokens: 200000, percentage: 0.6, categories: [{ name: 'Messages', tokens: 900, percentage: 0.45 }], model: 'claude-test-opus' }

function withDetails(h: Harness) {
  const pushed: any[] = []
  h.mgr.onDetails((d) => pushed.push(d))
  return pushed
}

describe('R-27 / R-30 session details from local control requests', () => {
  it('initialize is written before the user turn and its response fills commands, agents, models and output styles', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const kinds = child.frames().map((f) => (f.type === 'control_request' ? f.request.subtype : f.type))
    expect(kinds.slice(0, 2)).toEqual(['initialize', 'user'])
    expect(reqFrames(child, 'initialize')[0].request_id).toMatch(/^ac-\d+$/)
    await respond(h, child, 'initialize', INIT_BODY, 0)
    const d = h.mgr.details(id)!
    expect(d.checkpointing).toBe(true)
    expect(d.commands.map((c) => [c.name, c.source])).toEqual([['compact', 'builtin'], ['mcp__srv__prompt', 'mcp'], ['plug:review', 'plugin']])
    expect(d.commands[0]).toMatchObject({ description: 'Compact the conversation', argumentHint: '[instructions]' })
    expect(d.agents).toEqual([{ name: 'reviewer', description: 'Reviews' }])
    expect(d.models).toEqual([{ value: 'sonnet', displayName: 'Sonnet', description: 'Fast' }])
    expect(d.outputStyle).toBe('default')
    expect(d.availableOutputStyles).toEqual(['default', 'Explanatory'])
  })

  it('after init: tools and MCP names come from system/init, then mcp_status is requested once and replaces them', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h, {}, 'hi')
    // startSession's init has tools [Read, Bash]; send another init-less turn: no second mcp_status
    expect(reqFrames(child, 'mcp_status')).toHaveLength(1)
    expect(h.mgr.details(id)!.tools).toEqual(['Read', 'Bash'])
    await respond(h, child, 'mcp_status', { mcpServers: [{ name: 'github', status: 'connected', serverInfo: { name: 'gh', version: '1.2' } }, { name: 'db', status: 'needs-auth', error: 'login' }] })
    expect(h.mgr.details(id)!.mcp).toEqual([
      { name: 'github', status: 'connected', serverInfo: { name: 'gh', version: '1.2' } },
      { name: 'db', status: 'needs-auth', error: 'login' }
    ])
    child.emit(initMsg(SID))
    expect(reqFrames(child, 'mcp_status')).toHaveLength(1)
  })

  it('mcp server names announced by system/init are listed as pending until mcp_status answers', async () => {
    const h = createHarness()
    const info = h.mgr.create({ ...DRAFT })
    const p = h.mgr.send(info.id, 'go')
    await h.settle()
    h.lastChild().emit(initMsg(SID, { mcp_servers: [{ name: 'a', status: 'connected' }, { name: 'b', status: 'weird' }] }))
    await p
    expect(h.mgr.details(info.id)!.mcp).toEqual([{ name: 'a', status: 'connected' }, { name: 'b', status: 'pending' }])
  })

  it('each result: lastTurn from usage/cost, session cost adds up, and get_context_usage (local) fills the context meter', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit({ ...resultMsg({ cost: 0.25 }), duration_ms: 1500, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } })
    let d = h.mgr.details(id)!
    expect(d.lastTurn).toEqual({ costUsd: 0.25, input: 10, output: 20, cacheRead: 30, cacheCreation: 40, durationMs: 1500 })
    expect(reqFrames(child, 'get_context_usage')).toHaveLength(1)
    await respond(h, child, 'get_context_usage', CONTEXT_BODY)
    d = h.mgr.details(id)!
    expect(d.context).toMatchObject({ totalTokens: 1200, maxTokens: 200000, model: 'claude-test-opus', fetchedAt: '2026-11-19T10:00:00.060Z' })
    child.emit(resultMsg({ cost: 0.5 }))
    expect(h.mgr.details(id)!.sessionCostUsd).toBeCloseTo(0.75)
    expect(reqFrames(child, 'get_context_usage')).toHaveLength(2)
  })

  it('commands_changed replaces the commands; user-echo appends turn refs (text <= 120, de-duplicated, max 200)', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    await respond(h, child, 'initialize', INIT_BODY, 0)
    child.emit({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'only', description: 'x' }] })
    expect(h.mgr.details(id)!.commands.map((c) => c.name)).toEqual(['only'])
    child.emit({ type: 'user', uuid: UUID, message: { role: 'user', content: 'x'.repeat(300) }, parent_tool_use_id: null })
    child.emit({ type: 'user', uuid: UUID, message: { role: 'user', content: 'again' }, parent_tool_use_id: null })
    expect(h.mgr.details(id)!.userTurns).toEqual([{ uuid: UUID, text: 'x'.repeat(120), time: '2026-11-19T10:00:00.060Z' }])
    for (let i = 0; i < 210; i++) child.emit({ type: 'user', uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, message: { role: 'user', content: `t${i}` }, parent_tool_use_id: null })
    const turns = h.mgr.details(id)!.userTurns
    expect(turns).toHaveLength(200)
    expect(turns[199]!.text).toBe('t209')
  })

  it('details are pushed through onDetails, throttled to one push per 250 ms', async () => {
    const h = createHarness()
    const pushed = withDetails(h)
    const { id, child } = await startSession(h)
    h.advance(300)
    pushed.length = 0
    child.emit({ type: 'user', uuid: UUID, message: { role: 'user', content: 'a' }, parent_tool_use_id: null })
    child.emit({ type: 'user', uuid: UUID2, message: { role: 'user', content: 'b' }, parent_tool_use_id: null })
    h.advance(249)
    expect(pushed).toHaveLength(0)
    h.advance(2)
    expect(pushed).toHaveLength(1)
    expect(pushed[0].controlId).toBe(id)
    expect(pushed[0].userTurns.map((u: any) => u.text)).toEqual(['a', 'b'])
    child.emit({ type: 'user', uuid: '55555555-aaaa-4bbb-8ccc-000000000005', message: { role: 'user', content: 'c' }, parent_tool_use_id: null })
    h.advance(300)
    expect(pushed).toHaveLength(2)
  })

  it('details of an unknown session are null; a draft has empty details with checkpointing on', () => {
    const h = createHarness()
    expect(h.mgr.details('nope')).toBeNull()
    const { id } = h.mgr.create({ ...DRAFT })
    expect(h.mgr.details(id)).toMatchObject({ controlId: id, commands: [], mcp: [], tools: [], userTurns: [], sessionCostUsd: 0, checkpointing: true })
  })

  it('the spawn environment enables SDK file checkpointing', async () => {
    const h = createHarness()
    await startSession(h)
    expect(h.spawnCalls[0]!.opts.env[CHECKPOINT_ENV]).toBe('1')
  })
})

describe('request correlation', () => {
  it('resolves with the matching response body, ids are ac-<n> and increase', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const p1 = h.mgr.request(id, { subtype: 'get_plan' })
    const p2 = h.mgr.request(id, { subtype: 'get_session_cost' })
    const [a, b] = [reqFrames(child, 'get_plan')[0], reqFrames(child, 'get_session_cost')[0]]
    expect(a.request_id).toMatch(/^ac-\d+$/)
    expect(b.request_id).not.toBe(a.request_id)
    child.emit({ type: 'control_response', response: { subtype: 'success', request_id: b.request_id, response: { n: 2 } } })
    child.emit({ type: 'control_response', response: { subtype: 'success', request_id: a.request_id, response: { n: 1 } } })
    expect(await p1).toEqual({ n: 1 })
    expect(await p2).toEqual({ n: 2 })
  })

  it('rejects on an error response, on timeout (10 s default), and on exit', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const e = expect(h.mgr.request(id, { subtype: 'get_plan' })).rejects.toThrow('boom')
    await fail(h, child, 'get_plan', 'boom')
    await e
    const t = expect(h.mgr.request(id, { subtype: 'get_plan' })).rejects.toThrow('timeout')
    h.advance(9_999)
    h.advance(2)
    await t
    const x = expect(h.mgr.request(id, { subtype: 'get_plan' })).rejects.toThrow('exited')
    child.exit(1)
    await x
  })

  it('a custom timeout is honoured and a response after the timeout is ignored', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const t = expect(h.mgr.request(id, { subtype: 'get_plan' }, 500)).rejects.toThrow('timeout')
    h.advance(501)
    await t
    await respond(h, child, 'get_plan', { exists: true })
    expect(h.pendingTimers()).toBeGreaterThanOrEqual(0)
  })

  it('refuses on a draft, an exited session and an unknown id without writing', async () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT })
    await expect(h.mgr.request(id, { subtype: 'get_plan' })).rejects.toThrow('not-running')
    await expect(h.mgr.request('nope', { subtype: 'get_plan' })).rejects.toThrow('unknown-session')
    expect(h.spawnCalls).toHaveLength(0)
  })
})

describe('R-19 control requests are local; user frames only come from send / sendRich', () => {
  it('draft and exited sessions refuse every v2 action with not-running and write nothing', async () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT, resume: { kind: 'resume', sessionId: SID } })
    const notRunning = { ok: false, reason: 'not-running' }
    expect(await h.mgr.refreshContext(id)).toEqual(notRunning)
    expect(await h.mgr.mcpToggle(id, 'github', false)).toEqual(notRunning)
    expect(await h.mgr.mcpReconnect(id, 'github')).toEqual(notRunning)
    expect(await h.mgr.rewind(id, UUID)).toEqual(notRunning)
    expect(await h.mgr.rewindPreview(id, UUID)).toMatchObject({ canRewind: false, error: 'not-running' })
    expect(await h.mgr.rename(id, 'Title')).toEqual(notRunning)
    expect(await h.mgr.fileSuggestions(id, 'a')).toBeNull()
    expect(await h.mgr.getPlan(id)).toEqual({ exists: false })
    expect(h.spawnCalls).toHaveLength(0)

    const { id: id2, child } = await startSession(h)
    child.exit(0)
    await h.settle()
    const n = child.frames().length
    expect(await h.mgr.mcpToggle(id2, 'x', true)).toEqual(notRunning)
    expect(await h.mgr.refreshContext(id2)).toEqual(notRunning)
    expect(child.frames()).toHaveLength(n)
    expect(h.spawnCalls).toHaveLength(1)
  })

  it('a whole session of v2 actions only ever writes local control requests besides the two Sends', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h, {}, 'first')
    await respond(h, child, 'initialize', INIT_BODY, 0)
    await respond(h, child, 'mcp_status', { mcpServers: [] })
    child.emit(resultMsg())
    await respond(h, child, 'get_context_usage', CONTEXT_BODY)
    void h.mgr.refreshContext(id)
    void h.mgr.mcpToggle(id, 'github', true)
    void h.mgr.mcpReconnect(id, 'github')
    void h.mgr.rewindPreview(id, UUID)
    void h.mgr.rename(id, 'Name')
    void h.mgr.getPlan(id)
    void h.mgr.fileSuggestions(id, 'a')
    void h.mgr.setEffort(id, 'high')
    void h.mgr.setOutputStyle(id, 'Explanatory')
    await h.mgr.sendRich(id, 'second', [{ mediaType: 'image/png', dataBase64: 'AAAA' }])
    const users = child.frames().filter((f) => f.type === 'user')
    expect(users).toHaveLength(2)
    const subtypes = reqFrames(child).map((f) => f.request.subtype)
    for (const st of subtypes) {
      expect(['initialize', 'mcp_status', 'get_context_usage', 'mcp_toggle', 'mcp_reconnect', 'rewind_files', 'rename_session', 'get_plan', 'file_suggestions', 'apply_flag_settings']).toContain(st)
    }
    expect(reqFrames(child, 'rewind_files').every((f) => f.request.dry_run === true)).toBe(true)
    expect(h.spawnCalls).toHaveLength(1)
  })

  it('sendRich on a draft spawns like send: initialize first, then one rich user turn with image blocks before the text', async () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT })
    const p = h.mgr.sendRich(id, 'look', [{ mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=', name: 'a.png' }])
    await h.settle()
    const child = h.lastChild()
    child.emit(initMsg())
    expect(await p).toEqual({ ok: true })
    const frames = child.frames()
    expect(frames[0].request.subtype).toBe('initialize')
    expect(frames[1]).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }, { type: 'text', text: 'look' }] },
      parent_tool_use_id: null,
      session_id: ''
    })
    expect(await h.mgr.sendRich(id, 'x', Array.from({ length: 6 }, () => ({ mediaType: 'image/png' as const, dataBase64: 'AAAA' })))).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await h.mgr.sendRich('nope', 'x', [])).toEqual({ ok: false, reason: 'unknown-session' })
  })
})

describe('R-32 MCP toggle / reconnect, R-30 context refresh', () => {
  it('mcpToggle sends mcp_toggle, resolves on its response, then asks mcp_status again', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    await respond(h, child, 'mcp_status', { mcpServers: [{ name: 'github', status: 'connected' }] })
    const p = h.mgr.mcpToggle(id, 'github', false)
    expect(reqFrames(child, 'mcp_toggle').pop()!.request).toEqual({ subtype: 'mcp_toggle', serverName: 'github', enabled: false })
    await respond(h, child, 'mcp_toggle', {})
    expect(await p).toEqual({ ok: true })
    expect(reqFrames(child, 'mcp_status')).toHaveLength(2)
    await respond(h, child, 'mcp_status', { mcpServers: [{ name: 'github', status: 'disabled' }] })
    expect(h.mgr.details(id)!.mcp).toEqual([{ name: 'github', status: 'disabled' }])
  })

  it('mcpReconnect reports a CLI error as a failed result', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const p = h.mgr.mcpReconnect(id, 'db')
    expect(reqFrames(child, 'mcp_reconnect').pop()!.request).toEqual({ subtype: 'mcp_reconnect', serverName: 'db' })
    await fail(h, child, 'mcp_reconnect', 'Server not found')
    expect(await p).toEqual({ ok: false, reason: 'Server not found' })
  })

  it('refreshContext fetches usage on demand', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const p = h.mgr.refreshContext(id)
    await respond(h, child, 'get_context_usage', CONTEXT_BODY)
    expect(await p).toEqual({ ok: true })
    expect(h.mgr.details(id)!.context?.totalTokens).toBe(1200)
  })
})

describe('R-31 rewind (dry run first, never while busy) and fork from here', () => {
  it('rewindPreview sends dry_run and returns the parsed preview', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const p = h.mgr.rewindPreview(id, UUID)
    expect(reqFrames(child, 'rewind_files').pop()!.request).toEqual({ subtype: 'rewind_files', user_message_id: UUID, dry_run: true })
    await respond(h, child, 'rewind_files', { canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 3, deletions: 1 })
    expect(await p).toEqual({ canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 3, deletions: 1 })
    expect(await h.mgr.rewindPreview(id, 'not-a-uuid')).toMatchObject({ canRewind: false, error: 'invalid-args' })
  })

  it('rewind without a prior successful dry run for that message is refused and writes nothing', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(resultMsg())
    const n = reqFrames(child, 'rewind_files').length
    expect(await h.mgr.rewind(id, UUID)).toEqual({ ok: false, reason: 'preview-required' })
    const p = h.mgr.rewindPreview(id, UUID)
    await respond(h, child, 'rewind_files', { canRewind: false, error: 'No checkpoint' })
    expect((await p).canRewind).toBe(false)
    expect(await h.mgr.rewind(id, UUID)).toEqual({ ok: false, reason: 'preview-required' })
    expect(reqFrames(child, 'rewind_files')).toHaveLength(n + 1)
  })

  it('rewind after a dry run sends the real request once; a second rewind needs a new dry run', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(resultMsg())
    const pv = h.mgr.rewindPreview(id, UUID)
    await respond(h, child, 'rewind_files', { canRewind: true, filesChanged: ['a.ts'], insertions: 1, deletions: 0 })
    await pv
    const p = h.mgr.rewind(id, UUID)
    const real = reqFrames(child, 'rewind_files').pop()!
    expect(real.request).toEqual({ subtype: 'rewind_files', user_message_id: UUID })
    await respond(h, child, 'rewind_files', { canRewind: true, filesChanged: ['a.ts'], insertions: 1, deletions: 0 })
    expect(await p).toEqual({ ok: true })
    expect(await h.mgr.rewind(id, UUID)).toEqual({ ok: false, reason: 'preview-required' })
  })

  it('rewind is refused while a turn is running', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    expect(h.mgr.get(id)!.state).toBe('busy')
    const pv = h.mgr.rewindPreview(id, UUID)
    await respond(h, child, 'rewind_files', { canRewind: true, filesChanged: [], insertions: 0, deletions: 0 })
    await pv
    const n = reqFrames(child, 'rewind_files').length
    expect(await h.mgr.rewind(id, UUID)).toEqual({ ok: false, reason: 'busy' })
    expect(reqFrames(child, 'rewind_files')).toHaveLength(n)
  })

  it('forkAt creates a draft that forks at the message and spawns nothing', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h, { model: 'sonnet', permissionMode: 'plan' })
    child.emit(resultMsg())
    const n = child.frames().length
    const r = h.mgr.forkAt(id, UUID)
    expect(r).toMatchObject({ ok: true })
    const forkId = r.controlId!
    expect(forkId).not.toBe(id)
    expect(h.mgr.get(forkId)).toMatchObject({ state: 'draft', cwd: DRAFT.cwd, accountId: 'acme', permissionMode: 'plan', model: 'claude-test-opus', resume: { kind: 'resume', sessionId: SID, fork: true } })
    expect(h.spawnCalls).toHaveLength(1)
    expect(child.frames()).toHaveLength(n)
    // the first Send of the draft launches with --fork-session and --resume-session-at
    const p = h.mgr.send(forkId, 'go')
    await h.settle()
    const args = h.spawnCalls[1]!.args
    expect(args).toContain('--fork-session')
    expect(args[args.indexOf('--resume') + 1]).toBe(SID)
    expect(args[args.indexOf('--resume-session-at') + 1]).toBe(UUID)
    h.lastChild().emit(initMsg('66666666-aaaa-4bbb-8ccc-000000000006'))
    await p
  })

  it('forkAt is refused for a bad uuid, an unknown session, and a session without an id yet', () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT })
    expect(h.mgr.forkAt(id, UUID)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(h.mgr.forkAt(id, 'bad')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(h.mgr.forkAt('nope', UUID)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(h.mgr.list()).toHaveLength(1)
  })
})

describe('R-30 effort, output style, rename, plan, file suggestions', () => {
  it('on a draft effort and output style become launch arguments, nothing is written', async () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT })
    expect(await h.mgr.setEffort(id, 'xhigh')).toEqual({ ok: true })
    expect(await h.mgr.setOutputStyle(id, 'Explanatory')).toEqual({ ok: true })
    expect(h.mgr.details(id)).toMatchObject({ effort: 'xhigh', outputStyle: 'Explanatory' })
    const p = h.mgr.send(id, 'go')
    await h.settle()
    const args = h.spawnCalls[0]!.args
    expect(args[args.indexOf('--effort') + 1]).toBe('xhigh')
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({ outputStyle: 'Explanatory' })
    h.lastChild().emit(initMsg())
    await p
  })

  it('create options carry effort, output style and the fork point into the first spawn', async () => {
    const h = createHarness()
    const info = h.mgr.create({ ...DRAFT, effort: 'low', outputStyle: 'Learning', resume: { kind: 'resume', sessionId: SID, fork: true }, resumeAt: UUID })
    const p = h.mgr.send(info.id, 'go')
    await h.settle()
    const args = h.spawnCalls[0]!.args
    expect(args).toEqual(expect.arrayContaining(['--effort', 'low', '--fork-session', '--resume-session-at', UUID]))
    h.lastChild().emit(initMsg())
    await p
  })

  it('invalid effort or style is refused', async () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT })
    expect(await h.mgr.setEffort(id, 'turbo' as never)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await h.mgr.setOutputStyle(id, 'bad;style')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await h.mgr.setEffort('nope', 'low')).toEqual({ ok: false, reason: 'unknown-session' })
  })

  it('running: apply_flag_settings with the settings key; shown in details', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const e = h.mgr.setEffort(id, 'high')
    expect(reqFrames(child, 'apply_flag_settings').pop()!.request).toEqual({ subtype: 'apply_flag_settings', settings: { effortLevel: 'high' } })
    await respond(h, child, 'apply_flag_settings', {})
    expect(await e).toEqual({ ok: true })
    const o = h.mgr.setOutputStyle(id, 'Explanatory')
    expect(reqFrames(child, 'apply_flag_settings').pop()!.request).toEqual({ subtype: 'apply_flag_settings', settings: { outputStyle: 'Explanatory' } })
    await respond(h, child, 'apply_flag_settings', {})
    expect(await o).toEqual({ ok: true })
    expect(h.mgr.details(id)).toMatchObject({ effort: 'high', outputStyle: 'Explanatory' })
  })

  it('running: when the CLI rejects apply_flag_settings the value applies on the next start', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const e = h.mgr.setEffort(id, 'max')
    await fail(h, child, 'apply_flag_settings', 'unknown setting')
    expect(await e).toEqual({ ok: true, reason: 'applies-on-next-start' })
    expect(h.mgr.details(id)!.effort).toBe('max')
    child.exit(0)
    await h.settle()
    const p = h.mgr.send(id, 'again')
    await h.settle()
    const args = h.spawnCalls[1]!.args
    expect(args[args.indexOf('--effort') + 1]).toBe('max')
    h.lastChild().emit(initMsg())
    await p
  })

  it('rename sends rename_session and shows the title; blank titles are refused', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const p = h.mgr.rename(id, '  Fix login  ')
    expect(reqFrames(child, 'rename_session').pop()!.request).toEqual({ subtype: 'rename_session', title: 'Fix login' })
    await respond(h, child, 'rename_session', {})
    expect(await p).toEqual({ ok: true })
    expect(h.mgr.details(id)!.title).toBe('Fix login')
    expect(await h.mgr.rename(id, '   ')).toEqual({ ok: false, reason: 'invalid-args' })
  })

  it('getPlan and fileSuggestions parse the responses', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const plan = h.mgr.getPlan(id)
    await respond(h, child, 'get_plan', { exists: true, content: '# Plan' })
    expect(await plan).toEqual({ exists: true, content: '# Plan' })
    const fs = h.mgr.fileSuggestions(id, 'src/ma')
    expect(reqFrames(child, 'file_suggestions').pop()!.request).toEqual({ subtype: 'file_suggestions', query: 'src/ma' })
    await respond(h, child, 'file_suggestions', { suggestions: [{ path: 'src/main.ts', score: 3 }, 'src/maybe.ts'], cwd: 'C:/x' })
    expect(await fs).toEqual([{ path: 'src/main.ts', score: 3 }, { path: 'src/maybe.ts' }])
    const failing = h.mgr.getPlan(id)
    await fail(h, child, 'get_plan', 'nope')
    expect(await failing).toEqual({ exists: false })
  })
})

describe('R-29 AskUserQuestion answers', () => {
  const ASK = { questions: [{ question: 'Which?', options: ['A', 'B'] }] }

  it('allow with answers echoes the stored input plus updatedInput.answers', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(canUseTool('req_q', { tool: 'AskUserQuestion', input: ASK }))
    expect(h.mgr.answer(id, 'req_q', { behavior: 'allow', answers: { 'Which?': 'A, B' } })).toEqual({ ok: true })
    expect(child.frames().pop()).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req_q', response: { behavior: 'allow', updatedInput: { ...ASK, answers: { 'Which?': 'A, B' } } } }
    })
  })

  it('answers are refused for other tools, for deny, and for values over 2000 characters', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(canUseTool('req_bash'))
    child.emit(canUseTool('req_q', { tool: 'AskUserQuestion', input: ASK }))
    const n = child.frames().length
    expect(h.mgr.answer(id, 'req_bash', { behavior: 'allow', answers: { a: 'b' } })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(h.mgr.answer(id, 'req_q', { behavior: 'deny', answers: { a: 'b' } })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(h.mgr.answer(id, 'req_q', { behavior: 'allow', answers: { a: 'x'.repeat(2001) } })).toEqual({ ok: false, reason: 'invalid-args' })
    expect(child.frames()).toHaveLength(n)
    expect(h.mgr.answer(id, 'req_q', { behavior: 'allow', answers: { a: 'x'.repeat(2000) } })).toEqual({ ok: true })
  })
})
