// T24 / R-27,R-29,R-30,R-31: protocol v2 encoders and parsers.
import { describe, expect, it } from 'vitest'
import {
  commandSource,
  encodeAllowWithAnswers,
  encodeControlRequest,
  encodeRequest,
  encodeUserTurnRich,
  parseContextUsage,
  parseFileSuggestions,
  parseInitializeResponse,
  parseMcpStatus,
  parseOutputLine,
  parsePlan,
  parseRewind,
  type CtlReq
} from '../../../src/main/control/protocol'

const j = (s: string): unknown => {
  expect(s.endsWith('\n')).toBe(true)
  expect(s.slice(0, -1)).not.toContain('\n')
  return JSON.parse(s)
}
const parse = (o: unknown) => parseOutputLine(JSON.stringify(o))

describe('T24 encodeRequest', () => {
  const cases: CtlReq[] = [
    { subtype: 'initialize' },
    { subtype: 'mcp_status' },
    { subtype: 'mcp_toggle', serverName: 'fs', enabled: false },
    { subtype: 'mcp_reconnect', serverName: 'fs' },
    { subtype: 'get_context_usage' },
    { subtype: 'get_context_usage', detail: 'summary' },
    { subtype: 'rewind_files', user_message_id: 'u1', dry_run: true },
    { subtype: 'rewind_files', user_message_id: 'u1' },
    { subtype: 'file_suggestions', query: 'src/ma' },
    { subtype: 'apply_flag_settings', settings: { effortLevel: 'high', outputStyle: 'Explanatory' } },
    { subtype: 'rename_session', title: 'My "title"' },
    { subtype: 'get_plan' },
    { subtype: 'get_session_cost' },
    { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 8000 },
    { subtype: 'interrupt' },
    { subtype: 'set_model', model: null }
  ]
  it.each(cases.map((c) => [c.subtype, c] as const))('wraps %s as a control_request frame', (_n, req) => {
    expect(j(encodeRequest('req_1', req))).toEqual({ type: 'control_request', request_id: 'req_1', request: req })
  })
  it('matches the legacy encodeControlRequest output', () => {
    expect(encodeRequest('r', { subtype: 'interrupt' })).toBe(encodeControlRequest('r', { subtype: 'interrupt' }))
  })
})

describe('T24 rich user turn', () => {
  it('images come first (in order), text last', () => {
    const f = j(encodeUserTurnRich('look', [{ mediaType: 'image/png', dataBase64: 'AAA' }, { mediaType: 'image/jpeg', dataBase64: 'BBB' }])) as {
      message: { content: unknown[] }
    }
    expect(f).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
          { type: 'text', text: 'look' }
        ]
      },
      parent_tool_use_id: null,
      session_id: ''
    })
  })
  it('no images -> only the text block', () => {
    expect((j(encodeUserTurnRich('hi\n"x"', [])) as { message: { content: unknown } }).message.content).toEqual([{ type: 'text', text: 'hi\n"x"' }])
  })
})

describe('T24 encodeAllowWithAnswers', () => {
  it('merges answers into updatedInput and keeps the original input', () => {
    const input = { questions: [{ question: 'Q?' }] }
    expect(j(encodeAllowWithAnswers('r9', input, { 'Q?': 'A, B' }))).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r9', response: { behavior: 'allow', updatedInput: { questions: [{ question: 'Q?' }], answers: { 'Q?': 'A, B' } } } }
    })
    expect(input).toEqual({ questions: [{ question: 'Q?' }] })
  })
})

describe('T24 parsers', () => {
  it('parseInitializeResponse (inner payload and envelope)', () => {
    const body = {
      commands: [
        { name: 'compact', description: 'Compact', argumentHint: '[focus]', aliases: ['c'], builtin: true },
        { name: 'p:do', description: 'Plugin cmd' },
        { description: 'no name' },
        'junk'
      ],
      agents: [{ name: 'explore', description: 'Explore' }, { name: 'x' }, {}],
      models: [{ value: 'opus', displayName: 'Opus', description: 'big' }, { value: 'sonnet' }, { displayName: 'no value' }],
      output_style: 'default',
      available_output_styles: ['default', 'Explanatory', 3]
    }
    const want = {
      commands: [
        { name: 'compact', description: 'Compact', argumentHint: '[focus]', aliases: ['c'], builtin: true },
        { name: 'p:do', description: 'Plugin cmd' }
      ],
      agents: [{ name: 'explore', description: 'Explore' }, { name: 'x' }],
      models: [{ value: 'opus', displayName: 'Opus', description: 'big' }, { value: 'sonnet', displayName: 'sonnet' }],
      outputStyle: 'default',
      availableOutputStyles: ['default', 'Explanatory']
    }
    expect(parseInitializeResponse(body)).toEqual(want)
    expect(parseInitializeResponse({ subtype: 'success', request_id: 'r', response: body })).toEqual(want)
  })
  it('parseInitializeResponse tolerates malformed input', () => {
    const empty = { commands: [], agents: [], models: [], availableOutputStyles: [] }
    for (const bad of [null, undefined, 5, 'x', [], {}, { commands: 'x', agents: 3, models: {} }]) expect(parseInitializeResponse(bad)).toEqual(empty)
  })
  it('parseMcpStatus', () => {
    expect(
      parseMcpStatus({
        mcpServers: [
          { name: 'a', status: 'connected', serverInfo: { name: 'A', version: '1.0' } },
          { name: 'b', status: 'failed', error: 'boom' },
          { name: 'c' },
          { status: 'connected' },
          7
        ]
      })
    ).toEqual([
      { name: 'a', status: 'connected', serverInfo: { name: 'A', version: '1.0' } },
      { name: 'b', status: 'failed', error: 'boom' },
      { name: 'c', status: 'unknown' }
    ])
    for (const bad of [null, 1, {}, { mcpServers: 'x' }]) expect(parseMcpStatus(bad)).toEqual([])
  })
  it('parseContextUsage', () => {
    expect(
      parseContextUsage({ totalTokens: 50, maxTokens: 200, percentage: 25, categories: [{ name: 'System', tokens: 10, percentage: 5 }, { tokens: 1 }, { name: 'Msgs', tokens: 20 }], model: 'opus' })
    ).toEqual({
      totalTokens: 50,
      maxTokens: 200,
      percentage: 25,
      categories: [
        { name: 'System', tokens: 10, percentage: 5 },
        { name: 'Msgs', tokens: 20, percentage: 10 }
      ],
      model: 'opus'
    })
    expect(parseContextUsage({ totalTokens: 50, maxTokens: 200 })).toEqual({ totalTokens: 50, maxTokens: 200, percentage: 25, categories: [] })
    for (const bad of [null, 'x', {}, { totalTokens: 1 }, { totalTokens: 'a', maxTokens: 2 }, { totalTokens: NaN, maxTokens: 2 }]) expect(parseContextUsage(bad)).toBeNull()
  })
  it('parseRewind', () => {
    expect(parseRewind({ canRewind: true, filesChanged: ['a.ts', 3, 'b.ts'], insertions: 4, deletions: 2 })).toEqual({ canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 4, deletions: 2 })
    expect(parseRewind({ canRewind: false, error: 'No checkpoint' })).toEqual({ canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'No checkpoint' })
    expect(parseRewind(null)).toEqual({ canRewind: false, filesChanged: [], insertions: 0, deletions: 0 })
    expect(parseRewind({ canRewind: 'yes' }).canRewind).toBe(false)
  })
  it('parseFileSuggestions', () => {
    expect(parseFileSuggestions({ suggestions: [{ path: 'a.ts', score: 0.5 }, { path: 'b.ts' }, 'c.ts', { score: 1 }, 4, { path: '' }], cwd: '/x' })).toEqual([
      { path: 'a.ts', score: 0.5 },
      { path: 'b.ts' },
      { path: 'c.ts' }
    ])
    for (const bad of [null, 'x', {}, { suggestions: 'x' }]) expect(parseFileSuggestions(bad)).toEqual([])
  })
  it('parsePlan', () => {
    expect(parsePlan({ exists: true, content: '# Plan', path: '/p.md' })).toEqual({ exists: true, content: '# Plan' })
    expect(parsePlan({ exists: false })).toEqual({ exists: false })
    expect(parsePlan(undefined)).toEqual({ exists: false })
    expect(parsePlan({ exists: 'true', content: 5 })).toEqual({ exists: false })
  })
})

describe('T24 commandSource', () => {
  it('infers builtin / plugin / mcp / unknown', () => {
    expect(commandSource({ name: 'compact', builtin: true })).toBe('builtin')
    expect(commandSource({ name: 'plug:cmd' })).toBe('plugin')
    expect(commandSource({ name: 'mcp__srv__prompt' })).toBe('mcp')
    expect(commandSource({ name: 'mcp__srv:x' })).toBe('mcp')
    expect(commandSource({ name: 'mine' })).toBe('unknown')
    expect(commandSource({ name: ':x' })).toBe('unknown')
    expect(commandSource({ name: 'x:' })).toBe('unknown')
  })
})

describe('T24 parseOutputLine additions', () => {
  it('control-response keeps the inner response as body; errors have none', () => {
    expect(parse({ type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: { canRewind: true } } })).toEqual({
      t: 'control-response',
      requestId: 'r1',
      ok: true,
      body: { canRewind: true }
    })
    expect(parse({ type: 'control_response', response: { subtype: 'error', request_id: 'r2', error: 'x' } })).toEqual({ t: 'control-response', requestId: 'r2', ok: false, error: 'x' })
  })
  it('body feeds the parsers end to end', () => {
    const m = parse({ type: 'control_response', response: { subtype: 'success', request_id: 'r3', response: { exists: true, content: 'p' } } })
    expect(m?.t === 'control-response' && parsePlan(m.body)).toEqual({ exists: true, content: 'p' })
  })
  it('system/commands_changed -> commands', () => {
    expect(parse({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'a', description: 'A' }, { x: 1 }] })).toEqual({ t: 'commands', commands: [{ name: 'a', description: 'A' }] })
    expect(parse({ type: 'system', subtype: 'commands_changed' })).toEqual({ t: 'commands', commands: [] })
  })
  it('replayed plain user prompt -> user-echo (string and text blocks)', () => {
    expect(parse({ type: 'user', uuid: 'u-1', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null })).toEqual({ t: 'user-echo', uuid: 'u-1', text: 'hello' })
    expect(
      parse({ type: 'user', uuid: 'u-2', message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } })
    ).toEqual({ t: 'user-echo', uuid: 'u-2', text: 'a\nb' })
  })
  it('user lines with tool_result or without uuid stay plain user', () => {
    expect(parse({ type: 'user', uuid: 'u-3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] }, parent_tool_use_id: 'p' })).toEqual({
      t: 'user',
      parentToolUseId: 'p'
    })
    expect(parse({ type: 'user', message: { role: 'user', content: 'hi' } })).toEqual({ t: 'user', parentToolUseId: null })
    expect(parse({ type: 'user', uuid: 'u-4', message: 'bad' })).toEqual({ t: 'user', parentToolUseId: null })
  })
  it('result gains usage and durationMs', () => {
    expect(
      parse({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 'x' }, permission_denials: [] })
    ).toEqual({
      t: 'result',
      subtype: 'success',
      isError: false,
      denials: 0,
      durationMs: 1234,
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 0 }
    })
    expect(parse({ type: 'result', subtype: 'success', is_error: false })).toEqual({ t: 'result', subtype: 'success', isError: false, denials: 0 })
  })
})
