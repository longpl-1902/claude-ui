// T02 / R-02: stream-json protocol. Shapes are the VERIFIED ones in plan.md facts 3-6 (synthetic ids/text only).
import { describe, expect, it } from 'vitest'
import {
  createLineSplitter,
  encodeAllow,
  encodeControlRequest,
  encodeDeny,
  encodeUnsupported,
  encodeUserTurn,
  inputPreview,
  parseOutputLine,
  sessionScopedSuggestions
} from '../../../src/main/control/protocol'

const SID = '11111111-aaaa-4bbb-8ccc-000000000001'
const line = (o: unknown): string => JSON.stringify(o)
const parse = (o: unknown): any => parseOutputLine(line(o))

describe('R-02 parseOutputLine: system messages', () => {
  it('R-02 system/init -> init with session id, model, mode, cwd, slash commands, version', () => {
    const m = parse({
      type: 'system', subtype: 'init', session_id: SID, cwd: 'C:/Users/u/acme', model: 'claude-test-opus', permissionMode: 'default',
      tools: ['Read', 'Bash'], slash_commands: ['compact', 'review'], agents: ['Explore'], skills: [], mcp_servers: [], claude_code_version: '0.0.0-test'
    })
    expect(m).toEqual({ t: 'init', sessionId: SID, model: 'claude-test-opus', permissionMode: 'default', cwd: 'C:/Users/u/acme', slashCommands: ['compact', 'review'], version: '0.0.0-test' })
  })
  it('R-02 init without slash_commands gives an empty list; non-string commands are dropped', () => {
    expect(parse({ type: 'system', subtype: 'init', session_id: SID }).slashCommands).toEqual([])
    expect(parse({ type: 'system', subtype: 'init', session_id: SID, slash_commands: ['a', 5, null, 'b'] }).slashCommands).toEqual(['a', 'b'])
  })
  it('R-02 system/status -> status', () => {
    expect(parse({ type: 'system', subtype: 'status', status: 'requesting', session_id: SID })).toEqual({ t: 'status', status: 'requesting' })
  })
  it('R-02 hook_started / hook_response / thinking_tokens / unknown subtypes are kept as other', () => {
    for (const subtype of ['hook_started', 'hook_response', 'thinking_tokens', 'api_retry', 'compact_boundary', 'task_started']) {
      expect(parse({ type: 'system', subtype, session_id: SID })).toEqual({ t: 'other', type: 'system', subtype })
    }
  })
})

describe('R-02 parseOutputLine: stream_event', () => {
  const ev = (event: unknown, extra: Record<string, unknown> = {}) => parse({ type: 'stream_event', event, parent_tool_use_id: null, api_message_id: 'msg_1', session_id: SID, ...extra })

  it('R-02 message_start -> message-start with the message id', () => {
    expect(ev({ type: 'message_start', message: { id: 'msg_1', role: 'assistant' } })).toEqual({ t: 'message-start', messageId: 'msg_1', parentToolUseId: null })
  })
  it('R-02 content_block_start text / thinking / tool_use -> block-start', () => {
    expect(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })).toMatchObject({ t: 'block-start', index: 0, blockType: 'text', parentToolUseId: null })
    expect(ev({ type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } })).toMatchObject({ t: 'block-start', index: 1, blockType: 'thinking' })
    expect(ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } })).toMatchObject({
      t: 'block-start', index: 2, blockType: 'tool_use', toolName: 'Bash', toolUseId: 'toolu_1'
    })
  })
  it('R-02 content_block_delta text_delta / thinking_delta / input_json_delta -> delta', () => {
    expect(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } })).toMatchObject({ t: 'delta', index: 0, kind: 'text', text: 'Hel', parentToolUseId: null })
    expect(ev({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'hmm' } })).toMatchObject({ t: 'delta', kind: 'thinking', text: 'hmm' })
    expect(ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a"' } })).toMatchObject({ t: 'delta', kind: 'input_json', text: '{"a"' })
  })
  it('R-02 delta carries the api_message_id and a non-null parent_tool_use_id', () => {
    expect(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }, { parent_tool_use_id: 'toolu_parent' })).toMatchObject({
      t: 'delta', messageId: 'msg_1', parentToolUseId: 'toolu_parent'
    })
  })
  it('R-02 signature_delta is never a text delta', () => {
    const sig = ev({ type: 'content_block_delta', index: 1, delta: { type: 'signature_delta', signature: 'FAKE' } })
    expect(sig === null || sig.t !== 'delta').toBe(true)
  })
  it('R-02 message_stop -> message-stop; message_delta carries the stop reason when mapped', () => {
    expect(ev({ type: 'message_stop' })).toMatchObject({ t: 'message-stop', parentToolUseId: null })
    const md = ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
    expect(md === null || md.t === 'other' || (md.t === 'message-stop' && md.stopReason === 'end_turn')).toBe(true)
  })
})

describe('R-02 parseOutputLine: assistant / user / result', () => {
  it('R-02 assistant (one per content block) -> assistant with id, aborted flag and text', () => {
    const m = parse({ type: 'assistant', message: { id: 'msg_9', role: 'assistant', content: [{ type: 'text', text: 'Hello there' }], usage: {} }, parent_tool_use_id: null, session_id: SID })
    expect(m).toMatchObject({ t: 'assistant', messageId: 'msg_9', aborted: false, parentToolUseId: null, text: 'Hello there' })
  })
  it('R-02 assistant aborted:true is reported', () => {
    expect(parse({ type: 'assistant', aborted: true, message: { id: 'msg_9', content: [] }, parent_tool_use_id: null })).toMatchObject({ t: 'assistant', aborted: true })
  })
  it('R-02 assistant text is truncated at 4000 chars', () => {
    const m = parse({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'x'.repeat(9000) }] }, parent_tool_use_id: null })
    expect(m.text.length).toBeLessThanOrEqual(4001)
    expect(m.text.length).toBeGreaterThan(3000)
  })
  it('R-02 user (tool results) -> user', () => {
    expect(parse({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] }, parent_tool_use_id: null, tool_use_result: {} })).toEqual({ t: 'user', parentToolUseId: null })
  })
  it('R-02 result success -> result with cost, stop reason and denial count', () => {
    const m = parse({
      type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: SID, stop_reason: 'end_turn', total_cost_usd: 0.0123,
      usage: {}, num_turns: 1, permission_denials: [{ tool_name: 'Bash' }, { tool_name: 'Write' }]
    })
    expect(m).toMatchObject({ t: 'result', subtype: 'success', isError: false, sessionId: SID, text: 'Done.', costUsd: 0.0123, denials: 2, stopReason: 'end_turn' })
  })
  it('R-02 result error_during_execution is_error true, no denials -> 0', () => {
    expect(parse({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: SID })).toMatchObject({ t: 'result', subtype: 'error_during_execution', isError: true, denials: 0 })
  })
  it('R-02 result text is truncated at 4000 chars', () => {
    expect(parse({ type: 'result', subtype: 'success', is_error: false, result: 'y'.repeat(9000) }).text.length).toBeLessThanOrEqual(4001)
  })
  it('R-02 rate_limit_event and unknown types -> other', () => {
    expect(parse({ type: 'rate_limit_event', rate_limit_info: {} })).toEqual({ t: 'other', type: 'rate_limit_event' })
    expect(parse({ type: 'brand_new_thing', x: 1 })).toEqual({ t: 'other', type: 'brand_new_thing' })
  })
})

describe('R-02 parseOutputLine: control messages', () => {
  const canUse = (over: Record<string, unknown> = {}) => ({
    type: 'control_request', request_id: 'req_1',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'npm test' }, tool_use_id: 'toolu_1', description: 'Run tests', ...over }
  })
  it('R-02 can_use_tool -> can-use-tool with input, ids and description', () => {
    expect(parse(canUse())).toEqual({
      t: 'can-use-tool', requestId: 'req_1', toolName: 'Bash', displayName: 'Bash', input: { command: 'npm test' }, toolUseId: 'toolu_1', description: 'Run tests', suggestions: []
    })
  })
  it('R-02 can_use_tool keeps decision_reason (ANSI stripped), blocked_path and permission_suggestions', () => {
    const m = parse(canUse({ decision_reason: '\u001b[31mOutside project\u001b[0m', blocked_path: 'C:/Users/u/other/a.txt', permission_suggestions: [{ type: 'addRules', rules: [], behavior: 'allow', destination: 'localSettings' }] }))
    expect(m.decisionReason).toBe('Outside project')
    expect(m.blockedPath).toBe('C:/Users/u/other/a.txt')
    expect(m.suggestions).toHaveLength(1)
  })
  it('R-02 description / decision_reason are truncated at 500 chars', () => {
    const m = parse(canUse({ description: 'd'.repeat(2000), decision_reason: 'r'.repeat(2000) }))
    expect(m.description.length).toBeLessThanOrEqual(501)
    expect(m.decisionReason.length).toBeLessThanOrEqual(501)
  })
  it('R-02 display_name falls back to the tool name', () => {
    expect(parse(canUse({ display_name: undefined })).displayName).toBe('Bash')
  })
  it('R-02 other control requests -> control-request (to be answered unsupported)', () => {
    expect(parse({ type: 'control_request', request_id: 'req_2', request: { subtype: 'hook_callback' } })).toEqual({ t: 'control-request', requestId: 'req_2', subtype: 'hook_callback' })
  })
  it('R-02 can_use_tool without a tool name is not a can-use-tool', () => {
    const m = parse({ type: 'control_request', request_id: 'req_3', request: { subtype: 'can_use_tool', input: {} } })
    expect(m === null || m.t !== 'can-use-tool').toBe(true)
  })
  it('R-02 control_response success / error -> control-response', () => {
    expect(parse({ type: 'control_response', response: { subtype: 'success', request_id: 'req_7', response: { still_queued: [] } } })).toEqual({ t: 'control-response', requestId: 'req_7', ok: true, body: { still_queued: [] } })
    expect(parse({ type: 'control_response', response: { subtype: 'error', request_id: 'req_8', error: 'nope' } })).toEqual({ t: 'control-response', requestId: 'req_8', ok: false, error: 'nope' })
  })
})

describe('R-02 parseOutputLine: robustness (never throws)', () => {
  it('R-02 blank, whitespace and invalid JSON -> null', () => {
    for (const l of ['', '   ', '\r', '{not json', 'null', '[]', '"str"', '42']) expect(parseOutputLine(l)).toBeNull()
  })
  it('R-02 objects without a string type never throw', () => {
    for (const o of [{}, { type: 5 }, { type: null }]) expect(() => parseOutputLine(line(o))).not.toThrow()
  })
  it('R-02 wrong field types never throw', () => {
    const bad = [
      { type: 'system', subtype: 'init', session_id: 5, slash_commands: 'x' },
      { type: 'stream_event', event: 'nope' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: null } },
      { type: 'assistant', message: 'x' },
      { type: 'result', permission_denials: 'x', total_cost_usd: 'x' },
      { type: 'control_request', request: null },
      { type: 'control_response', response: 3 }
    ]
    for (const o of bad) expect(() => parseOutputLine(line(o))).not.toThrow()
  })
  it('R-02 tolerates CRLF at the end of a line', () => {
    expect(parseOutputLine(line({ type: 'system', subtype: 'status', status: 'requesting' }) + '\r')).toEqual({ t: 'status', status: 'requesting' })
  })
})

describe('R-02 inputPreview', () => {
  it('R-02 uses command, file_path, url, pattern first', () => {
    expect(inputPreview('Bash', { command: 'npm test', description: 'x' })).toBe('npm test')
    expect(inputPreview('Edit', { file_path: 'C:/Users/u/acme/a.ts', old_string: 'a' })).toBe('C:/Users/u/acme/a.ts')
    expect(inputPreview('WebFetch', { url: 'https://example.com/x', prompt: 'p' })).toBe('https://example.com/x')
    expect(inputPreview('Grep', { pattern: 'TODO', path: '.' })).toBe('TODO')
  })
  it('R-02 falls back to compact JSON and is capped at 2000 chars', () => {
    expect(inputPreview('Custom', { a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}')
    expect(inputPreview('Bash', { command: 'c'.repeat(5000) }).length).toBeLessThanOrEqual(2000)
    expect(inputPreview('Custom', { a: 'z'.repeat(5000) }).length).toBeLessThanOrEqual(2000)
  })
  it('R-02 empty input gives a string and never throws', () => {
    expect(() => inputPreview('X', {})).not.toThrow()
    expect(typeof inputPreview('X', {})).toBe('string')
  })
})

describe('R-02 encoders round-trip through JSON.parse with the exact keys', () => {
  const j = (s: string): any => {
    expect(s.endsWith('\n')).toBe(true)
    expect(s.slice(0, -1)).not.toContain('\n')
    return JSON.parse(s)
  }
  it('R-02 encodeUserTurn', () => {
    expect(j(encodeUserTurn('hello\nworld "q"'))).toEqual({ type: 'user', message: { role: 'user', content: 'hello\nworld "q"' }, parent_tool_use_id: null, session_id: '' })
  })
  it('R-02 encodeAllow echoes the input as updatedInput', () => {
    expect(j(encodeAllow('req_1', { command: 'ls' }))).toEqual({
      type: 'control_response', response: { subtype: 'success', request_id: 'req_1', response: { behavior: 'allow', updatedInput: { command: 'ls' } } }
    })
  })
  it('R-02 encodeAllow with session rules adds updatedPermissions', () => {
    const rules = [{ type: 'addRules', destination: 'session' }]
    expect(j(encodeAllow('req_1', {}, rules)).response.response.updatedPermissions).toEqual(rules)
  })
  it('R-02 encodeAllow without rules omits updatedPermissions', () => {
    expect('updatedPermissions' in j(encodeAllow('r', {})).response.response).toBe(false)
  })
  it('R-02 encodeDeny', () => {
    expect(j(encodeDeny('req_2', 'Denied in Agent Console'))).toEqual({
      type: 'control_response', response: { subtype: 'success', request_id: 'req_2', response: { behavior: 'deny', message: 'Denied in Agent Console' } }
    })
  })
  it('R-02 encodeUnsupported answers with an error response', () => {
    expect(j(encodeUnsupported('req_3', 'hook_callback'))).toEqual({
      type: 'control_response', response: { subtype: 'error', request_id: 'req_3', error: 'unsupported: hook_callback' }
    })
  })
  it('R-02 encodeControlRequest interrupt / set_model / set_permission_mode', () => {
    expect(j(encodeControlRequest('r1', { subtype: 'interrupt' }))).toEqual({ type: 'control_request', request_id: 'r1', request: { subtype: 'interrupt' } })
    expect(j(encodeControlRequest('r2', { subtype: 'set_model', model: 'opus' }))).toEqual({ type: 'control_request', request_id: 'r2', request: { subtype: 'set_model', model: 'opus' } })
    expect(j(encodeControlRequest('r3', { subtype: 'set_model', model: null })).request).toEqual({ subtype: 'set_model', model: null })
    expect(j(encodeControlRequest('r4', { subtype: 'set_permission_mode', mode: 'plan' }))).toEqual({ type: 'control_request', request_id: 'r4', request: { subtype: 'set_permission_mode', mode: 'plan' } })
  })
})

describe('R-02 sessionScopedSuggestions (hard rule 3: never a settings file)', () => {
  it('R-02 keeps only allowed types and forces destination to session', () => {
    const out = sessionScopedSuggestions([
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' },
      { type: 'setMode', mode: 'acceptEdits', destination: 'userSettings' },
      { type: 'addDirectories', directories: ['C:/Users/u/acme'], destination: 'projectSettings' },
      { type: 'replaceRules', rules: [], behavior: 'allow', destination: 'session' },
      { type: 'removeRules', rules: [], destination: 'userSettings' },
      'junk',
      null,
      { destination: 'userSettings' }
    ]) as any[]
    expect(out.map((o) => o.type)).toEqual(['addRules', 'setMode', 'addDirectories', 'replaceRules'])
    for (const o of out) expect(o.destination).toBe('session')
  })
  it('R-02 does not mutate the input objects', () => {
    const src = { type: 'addRules', destination: 'localSettings' }
    sessionScopedSuggestions([src])
    expect(src.destination).toBe('localSettings')
  })
  it('R-02 non-arrays give []', () => {
    for (const v of [undefined, null, 'x', 5, {}]) expect(sessionScopedSuggestions(v)).toEqual([])
  })
})

describe('R-02 createLineSplitter', () => {
  const collect = (max?: number) => {
    const lines: string[] = []
    const s = createLineSplitter((l) => lines.push(l), max)
    return { lines, s }
  }
  it('R-02 splits on LF and keeps the tail until end()', () => {
    const { lines, s } = collect()
    s.push('a\nb\nc')
    expect(lines).toEqual(['a', 'b'])
    s.end()
    expect(lines).toEqual(['a', 'b', 'c'])
  })
  it('R-02 accepts CRLF', () => {
    const { lines, s } = collect()
    s.push('a\r\nb\r\n')
    expect(lines.map((l) => l.replace(/\r$/, ''))).toEqual(['a', 'b'])
  })
  it('R-02 lines split across chunks are joined', () => {
    const { lines, s } = collect()
    s.push('{"a":')
    s.push('1}\n')
    expect(lines).toEqual(['{"a":1}'])
  })
  it('R-02 a multibyte character split across Buffer chunks survives', () => {
    const { lines, s } = collect()
    const b = Buffer.from('héllo — 日本\n', 'utf8')
    const cut = b.indexOf(0xc3) + 1 // inside "é"
    s.push(b.subarray(0, cut))
    s.push(b.subarray(cut, b.length - 3))
    s.push(b.subarray(b.length - 3))
    expect(lines).toEqual(['héllo — 日本'])
  })
  it('R-02 blank lines carry no content', () => {
    const { lines, s } = collect()
    s.push('a\n\nb\n')
    expect(lines.filter((l) => l.trim() !== '')).toEqual(['a', 'b'])
  })
  it('R-02 an over-long line is dropped and counted, the stream continues', () => {
    const { lines, s } = collect(100)
    s.push('x'.repeat(150) + '\nok\n')
    expect(lines).toEqual(['ok'])
    expect(s.dropped()).toBe(1)
  })
  it('R-02 an over-long line arriving in several chunks is dropped once', () => {
    const { lines, s } = collect(100)
    s.push('y'.repeat(60))
    s.push('y'.repeat(60))
    s.push('y'.repeat(60) + '\nnext\n')
    expect(lines).toEqual(['next'])
    expect(s.dropped()).toBe(1)
  })
  it('R-02 end() on an empty buffer delivers nothing', () => {
    const { lines, s } = collect()
    s.end()
    expect(lines).toEqual([])
  })
})
