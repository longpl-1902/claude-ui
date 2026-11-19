import { describe, expect, it } from 'vitest'
import { parseLine, parseRecord, shouldSkipRaw, targetFor } from '../../../src/main/transcripts/parseLine'
import {
  IGNORABLE_TYPES,
  SESSION_ID,
  agentNameLine,
  agentResult,
  agentToolUse,
  aiTitle,
  apiErrorLine,
  askUserQuestionUse,
  assistantBlocks,
  assistantLine,
  at,
  attachmentLine,
  bashResult,
  bookkeepingLine,
  commandPrompt,
  compactSummaryPrompt,
  customTitle,
  editResult,
  errorResult,
  interruptedLine,
  interruptedToolResult,
  metaPrompt,
  rejectedResult,
  relocatedLine,
  sendMessageUse,
  systemApiError,
  systemLine,
  systemReminderPrompt,
  taskNotification,
  textBlock,
  thinkingBlock,
  toLine,
  toolResult,
  toolUseBlock,
  usage,
  userPrompt,
  userPromptArray,
  writeCreateResult
} from '../../fixtures/transcripts/builders'

// Signature assumptions (T02 Notes): parseLine(string) -> TranscriptRecord | null, parseRecord(unknown),
// shouldSkipRaw(string) -> boolean, targetFor(name, input) -> string. Records use the shapes in records.ts.
const parse = (o: unknown) => parseLine(toLine(o)) as any

describe('R-04 parseLine: assistant', () => {
  it('R-04 maps a text block line with message id, model, stop reason and usage', () => {
    const r = parse(assistantLine(textBlock('Hello there'), { messageId: 'msg_a1', stopReason: 'end_turn', usage: usage(10, 20, 30, 40), ts: at(3) }))
    expect(r.t).toBe('assistant')
    expect(r.messageId).toBe('msg_a1')
    expect(r.model).toBe('claude-test-opus')
    expect(r.stopReason).toBe('end_turn')
    expect(r.usage).toEqual({ input: 10, output: 20, cacheCreation: 30, cacheRead: 40 })
    expect(r.text).toBe('Hello there')
    expect(r.toolUses).toEqual([])
    expect(r.isApiError).toBe(false)
    expect(r.ts).toBe(at(3))
    expect(r.tsMs).toBe(Date.parse(at(3)))
    expect(r.sessionId).toBe(SESSION_ID)
    expect(r.cwd).toBe('d:\\work\\demo')
    expect(r.gitBranch).toBe('main')
  })

  it('R-04 every split line of one API message carries the same message id and usage (dedupe happens downstream)', () => {
    const lines = assistantBlocks([thinkingBlock('t'), textBlock('x'), toolUseBlock('toolu_1', 'Read', { file_path: 'a.ts' })], {
      messageId: 'msg_split', stopReason: 'tool_use', usage: usage(5, 6)
    })
    const recs = lines.map(parse)
    expect(recs).toHaveLength(3)
    for (const r of recs) {
      expect(r.messageId).toBe('msg_split')
      expect(r.usage).toEqual({ input: 5, output: 6, cacheCreation: 0, cacheRead: 0 })
    }
    expect(new Set(recs.map((r) => r.uuid)).size).toBe(3)
  })

  it('R-04 never includes thinking text', () => {
    const r = parse(assistantLine(thinkingBlock('SECRET-THOUGHT'), { messageId: 'msg_t' }))
    expect(JSON.stringify(r)).not.toContain('SECRET-THOUGHT')
    expect(r.text ?? '').toBe('')
  })

  it('R-04 joins text blocks and truncates to 300 chars with an ellipsis', () => {
    const r = parse(assistantLine(textBlock('y'.repeat(1000)), { messageId: 'msg_long' }))
    expect(r.text.length).toBeLessThanOrEqual(301)
    expect(r.text.endsWith('…')).toBe(true)
  })

  it('R-04 truncation never splits a surrogate pair', () => {
    const r = parse(assistantLine(textBlock('😀'.repeat(400)), { messageId: 'msg_emoji' }))
    expect(r.text.endsWith('…')).toBe(true)
    expect(r.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(r.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })

  it('R-04 a tool_use block becomes a ToolUseRec with the target', () => {
    const r = parse(assistantLine(toolUseBlock('toolu_r', 'Read', { file_path: 'd:/work/demo/src/a.ts' }), { messageId: 'msg_r', stopReason: 'tool_use' }))
    expect(r.toolUses).toHaveLength(1)
    expect(r.toolUses[0]).toMatchObject({ id: 'toolu_r', name: 'Read', target: 'd:/work/demo/src/a.ts', filePath: 'd:/work/demo/src/a.ts' })
  })

  it('R-04 Bash tool_use keeps command and uses the first line (max 120) as target', () => {
    const r = parse(assistantLine(toolUseBlock('toolu_b', 'Bash', { command: 'npm test\nsecond line' }), { messageId: 'msg_b' }))
    expect(r.toolUses[0].command).toBe('npm test\nsecond line')
    expect(r.toolUses[0].target).toBe('npm test')
  })

  it('R-04 Agent tool_use fills the agent info (name, subagent type, background)', () => {
    const r = parse(
      assistantLine(agentToolUse('toolu_ag', { description: 'Review', name: 'reviewer', subagent_type: 'reviewer-type', run_in_background: true }), { messageId: 'msg_ag' })
    )
    expect(r.toolUses[0].name).toBe('Agent')
    expect(r.toolUses[0].agent).toMatchObject({ description: 'Review', subagentType: 'reviewer-type', name: 'reviewer', background: true })
    expect(r.toolUses[0].target).toBe('reviewer')
  })

  it('R-04 SendMessage tool_use fills send {to, text, summary}', () => {
    const r = parse(assistantLine(sendMessageUse('toolu_sm', { to: 'reviewer', message: 'Please check', summary: 'check' }), { messageId: 'msg_sm' }))
    expect(r.toolUses[0].send).toMatchObject({ to: 'reviewer', text: 'Please check', summary: 'check' })
    expect(r.toolUses[0].target).toBe('→ reviewer')
  })

  it('R-04 SendMessage falls back to input.recipient when input.to is missing', () => {
    const r = parse(assistantLine(toolUseBlock('toolu_sm2', 'SendMessage', { recipient: 'bob', message: 'hi' }), { messageId: 'msg_sm2' }))
    expect(r.toolUses[0].send.to).toBe('bob')
  })

  it('R-04 AskUserQuestion is kept as a tool use by name', () => {
    const r = parse(assistantLine(askUserQuestionUse('toolu_q', 'Which?'), { messageId: 'msg_q', stopReason: 'tool_use' }))
    expect(r.toolUses[0].name).toBe('AskUserQuestion')
  })

  it('R-04 usage is omitted for API-error lines and the <synthetic> model', () => {
    const r = parse(apiErrorLine('rate_limit'))
    expect(r.t).toBe('assistant')
    expect(r.isApiError).toBe(true)
    expect(r.errorKind).toBe('rate_limit')
    expect(r.usage).toBeUndefined()
    const synth = parse({ ...assistantLine(textBlock('x'), { messageId: 'm' }), message: { id: 'm', role: 'assistant', model: '<synthetic>', content: [textBlock('x')], usage: { input_tokens: 5, output_tokens: 5 } } })
    expect(synth.usage).toBeUndefined()
  })

  it('R-04 missing usage numbers count as 0', () => {
    const line = { ...assistantLine(textBlock('x'), { messageId: 'msg_m' }), message: { id: 'msg_m', model: 'm', role: 'assistant', content: [textBlock('x')], usage: { input_tokens: 4 } } }
    expect(parse(line).usage).toEqual({ input: 4, output: 0, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-04 rejects an assistant line without message.id, uuid or a parseable timestamp', () => {
    const base = assistantLine(textBlock('x'), { messageId: 'msg_ok' }) as any
    expect(parse({ ...base, message: { ...base.message, id: undefined } })).toBeNull()
    expect(parse({ ...base, uuid: undefined })).toBeNull()
    expect(parse({ ...base, timestamp: undefined })).toBeNull()
    expect(parse({ ...base, timestamp: 'not-a-date' })).toBeNull()
  })

  it('R-04 sub-agent lines carry agentId', () => {
    const r = parse(assistantLine(textBlock('x'), { messageId: 'msg_s', agentId: 'a1b2c3d4e5f6a7b81' }))
    expect(r.agentId).toBe('a1b2c3d4e5f6a7b81')
  })
})

describe('R-04 parseLine: user and tool results', () => {
  it('R-04 a plain user line is a prompt of kind user', () => {
    const r = parse(userPrompt('Please refactor the parser'))
    expect(r).toMatchObject({ t: 'prompt', kind: 'user', text: 'Please refactor the parser' })
  })

  it('R-04 array text content is read as the prompt text', () => {
    expect(parse(userPromptArray('from array'))).toMatchObject({ t: 'prompt', kind: 'user', text: 'from array' })
  })

  it('R-04 prompt text is truncated to 300 chars', () => {
    const r = parse(userPrompt('p'.repeat(900)))
    expect(r.text.length).toBeLessThanOrEqual(301)
    expect(r.text.endsWith('…')).toBe(true)
  })

  it('R-04 a sub-agent first line (agentId + parentUuid null) is kind first-task', () => {
    const r = parse(userPrompt('Do the thing', { agentId: 'a1b2c3d4e5f6a7b81', parentUuid: null }))
    expect(r).toMatchObject({ t: 'prompt', kind: 'first-task', agentId: 'a1b2c3d4e5f6a7b81' })
  })

  it('R-04 a main-file user line with parentUuid null is still kind user', () => {
    expect(parse(userPrompt('first', { parentUuid: null })).kind).toBe('user')
  })

  it('R-04 command prompts are kind command with tags stripped to "/name args"', () => {
    const r = parse(commandPrompt('review', 'src/a.ts'))
    expect(r.kind).toBe('command')
    expect(r.text).toContain('/review')
    expect(r.text).toContain('src/a.ts')
    expect(r.text).not.toMatch(/<\/?command/)
  })

  it('R-04 task-notification prompts get their own kind', () => {
    expect(parse(taskNotification('all done')).kind).toBe('task-notification')
  })

  it('R-04 isCompactSummary prompts are kind compact-summary', () => {
    expect(parse(compactSummaryPrompt('summary of earlier work')).kind).toBe('compact-summary')
  })

  it('R-04 isMeta lines and system-reminder-only prompts are null', () => {
    expect(parse(metaPrompt('meta stuff'))).toBeNull()
    expect(parse(systemReminderPrompt())).toBeNull()
  })

  it('R-04 "[Request interrupted" user text becomes an interrupted record', () => {
    expect(parse(interruptedLine())).toMatchObject({ t: 'interrupted' })
  })

  it('R-04 a tool_result line becomes tool_results with the tool_use id and summary', () => {
    const r = parse(bashResult('toolu_x', 'first line\nsecond line'))
    expect(r.t).toBe('tool_results')
    expect(r.results).toHaveLength(1)
    expect(r.results[0]).toMatchObject({ toolUseId: 'toolu_x', isError: false, interrupted: false, summary: 'first line' })
  })

  it('R-04 summary skips blank leading lines, is capped at 200 chars and is empty when there is no text', () => {
    expect(parse(toolResult('t1', '\n\n  \nreal line\nmore')).results[0].summary).toBe('real line')
    const long = parse(toolResult('t2', 'z'.repeat(500))).results[0].summary
    expect(long.length).toBeLessThanOrEqual(201)
    expect(parse(toolResult('t3', [])).results[0].summary).toBe('')
  })

  it('R-04 array tool_result content uses its text items', () => {
    expect(parse(toolResult('t4', [textBlock('from array content')])).results[0].summary).toBe('from array content')
  })

  it('R-04 is_error:true marks the result failed', () => {
    const r = parse(errorResult('toolu_e', 'Error: exit code 1\ndetail'))
    expect(r.results[0]).toMatchObject({ isError: true, summary: 'Error: exit code 1' })
  })

  it('R-04 a string toolUseResult starting with "Error" marks the result failed even without is_error', () => {
    const r = parse(toolResult('toolu_e2', 'boom', { toolUseResult: 'Error: boom' }))
    expect(r.results[0].isError).toBe(true)
  })

  it('R-04 a user-rejected denial is a failure carrying the denial kind', () => {
    const r = parse(rejectedResult('toolu_rej'))
    expect(r.results[0]).toMatchObject({ isError: true, denial: 'user-rejected' })
  })

  it('R-04 interrupted denials and toolUseResult.interrupted set interrupted', () => {
    const r = parse(interruptedToolResult('toolu_int'))
    expect(r.results[0].interrupted).toBe(true)
    expect(r.results[0].denial).toBe('interrupted')
    expect(parse(toolResult('toolu_c', 'x', { toolDenialKind: 'cancelled' })).results[0].interrupted).toBe(true)
  })

  it('R-04 Edit results count + and - hunk lines (context and backslash lines ignored)', () => {
    const r = parse(editResult('toolu_ed', 'd:/work/demo/src/a.ts', [' ctx', '-old1', '-old2', '+new1', '+new2', '+new3', '\\ No newline at end of file']))
    expect(r.results[0].fileChange).toEqual({ path: 'd:/work/demo/src/a.ts', kind: 'update', added: 3, removed: 2 })
  })

  it('R-04 Write create with an empty patch counts the content lines as added', () => {
    const r = parse(writeCreateResult('toolu_w', 'd:/work/demo/src/new.ts', 'a\nb\nc'))
    expect(r.results[0].fileChange).toEqual({ path: 'd:/work/demo/src/new.ts', kind: 'create', added: 3, removed: 0 })
  })

  it('R-04 kind defaults to update when toolUseResult.type is absent', () => {
    const line = toolResult('toolu_k', 'ok', { toolUseResult: { filePath: 'd:/x.ts', structuredPatch: [{ lines: ['+a'] }] } })
    expect(parse(line).results[0].fileChange).toMatchObject({ kind: 'update', added: 1, removed: 0 })
  })

  it('R-04 Bash results have no fileChange', () => {
    expect(parse(bashResult('toolu_nb', 'out')).results[0].fileChange).toBeUndefined()
  })

  it('R-04 Agent results expose agentId, status, totalTokens and text (max 500)', () => {
    const r = parse(agentResult('toolu_ag', { agentId: 'a1b2c3d4e5f6a7b81', status: 'completed', text: 'T'.repeat(900), totalTokens: 321 }))
    const ar = r.results[0].agentResult
    expect(ar).toMatchObject({ agentId: 'a1b2c3d4e5f6a7b81', status: 'completed', totalTokens: 321 })
    expect(ar.text.length).toBeLessThanOrEqual(501)
  })

  it('R-04 async_launched Agent results have no text', () => {
    const ar = parse(agentResult('toolu_ag2', { agentId: 'e5f6a7b8c9d0e1f23', status: 'async_launched' })).results[0].agentResult
    expect(ar.status).toBe('async_launched')
    expect(ar.text ?? '').toBe('')
  })

  it('R-04 SendMessage results expose sendOk', () => {
    expect(parse(toolResult('toolu_s', 'sent', { toolUseResult: { success: true, message: 'sent' } })).results[0].sendOk).toBe(true)
    expect(parse(toolResult('toolu_s2', 'no', { toolUseResult: { success: false } })).results[0].sendOk).toBe(false)
  })

  it('R-04 top-level toolUseResult applies to the FIRST tool_result block only', () => {
    const line = {
      ...toolResult('toolu_first', 'one', { toolUseResult: 'Error: first only' }),
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_first', content: 'one' },
        { type: 'tool_result', tool_use_id: 'toolu_second', content: 'two' }
      ] }
    }
    const r = parse(line)
    expect(r.results).toHaveLength(2)
    expect(r.results[0].isError).toBe(true)
    expect(r.results[1].isError).toBe(false)
  })
})

describe('R-04 parseLine: system, titles and ignored types', () => {
  it('R-04 api_error with retries left is not fatal; the last retry is fatal', () => {
    expect(parse(systemApiError(1, 5))).toMatchObject({ t: 'system', subtype: 'api_error', fatal: false })
    expect(parse(systemApiError(5, 5))).toMatchObject({ t: 'system', subtype: 'api_error', fatal: true })
  })

  it('R-04 a level:error non-api_error system line is fatal', () => {
    expect(parse(systemLine('informational', { level: 'error' })).fatal).toBe(true)
    expect(parse(systemLine('informational', { level: 'info' })).fatal).toBe(false)
  })

  it('R-04 compact_boundary, local_command and informational produce records; turn_duration and others do not', () => {
    for (const s of ['compact_boundary', 'local_command', 'informational']) expect(parse(systemLine(s))).toMatchObject({ t: 'system', subtype: s })
    expect(parse(systemLine('turn_duration'))).toBeNull()
    expect(parse(systemLine('stop_hook_summary'))).toBeNull()
  })

  it('R-04 title lines map to title records without a timestamp', () => {
    expect(parse(aiTitle('AI name'))).toEqual({ t: 'title', sessionId: SESSION_ID, kind: 'ai', value: 'AI name' })
    expect(parse(customTitle('Mine'))).toEqual({ t: 'title', sessionId: SESSION_ID, kind: 'custom', value: 'Mine' })
    expect(parse(agentNameLine('worker-1'))).toEqual({ t: 'title', sessionId: SESSION_ID, kind: 'agent-name', value: 'worker-1' })
  })

  it.each([...IGNORABLE_TYPES])('R-04 ignorable type %s -> null', (type) => {
    expect(parse(bookkeepingLine(type))).toBeNull()
  })

  it('R-04 attachment and relocated lines -> null', () => {
    expect(parse(attachmentLine())).toBeNull()
    expect(parse(relocatedLine('d:/moved'))).toBeNull()
  })

  it('R-04 unknown extra fields on known types are ignored', () => {
    const line = { ...(userPrompt('hi') as object), brandNewField: { deep: 1 } }
    expect(parse(line)).toMatchObject({ t: 'prompt', text: 'hi' })
  })
})

describe('R-04 parseLine: totality (never throws)', () => {
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['not json', 'this is not json'],
    ['truncated json', '{"type":"assistant","uuid":"cut'],
    ['number', '42'],
    ['null', 'null'],
    ['array', '[1,2,3]'],
    ['string', '"just a string"'],
    ['object without type', '{"a":1}'],
    ['wrong field types', '{"type":"assistant","uuid":5,"timestamp":{},"message":"x"}'],
    ['message is an array', '{"type":"user","uuid":"u","timestamp":"2026-11-18T10:00:00.000Z","message":[1,2]}'],
    ['content is a number', '{"type":"user","uuid":"u","timestamp":"2026-11-18T10:00:00.000Z","message":{"content":7}}'],
    ['tool_result with null parts', '{"type":"user","uuid":"u","timestamp":"2026-11-18T10:00:00.000Z","message":{"content":[null,{"type":"tool_result"},{"type":"tool_result","tool_use_id":3}]},"toolUseResult":[1]}']
  ])('R-04 %s -> no throw', (_name, line) => {
    expect(() => parseLine(line)).not.toThrow()
    const r = parseLine(line)
    expect(r === null || typeof r === 'object').toBe(true)
  })

  it('R-04 parseRecord accepts any value without throwing', () => {
    for (const v of [undefined, null, 1, 'x', [], {}, { type: 5 }, { type: 'user', message: null }]) {
      expect(() => parseRecord(v)).not.toThrow()
    }
    expect(parseRecord(undefined)).toBeNull()
    expect(parseRecord({ type: 'ai-title', aiTitle: 'Via parseRecord', sessionId: 's' })).toMatchObject({ t: 'title', value: 'Via parseRecord' })
  })

  it('R-04 a multibyte line round-trips intact', () => {
    const r = parse(assistantLine(textBlock('héllo 日本語 ✓ 😀'), { messageId: 'msg_mb' }))
    expect(r.text).toBe('héllo 日本語 ✓ 😀')
  })
})

describe('R-04 shouldSkipRaw prefilter', () => {
  it.each(['api-request', 'api-request-shape', 'api-request-blob', 'file-history-snapshot', 'file-history-delta', 'queue-operation', 'atis-latch', 'session-owner', 'tools-used'])(
    'R-04 skips %s lines',
    (type) => {
      expect(shouldSkipRaw(toLine(bookkeepingLine(type)))).toBe(true)
    }
  )

  it('R-04 does not skip conversation, title or system lines', () => {
    expect(shouldSkipRaw(toLine(userPrompt('x')))).toBe(false)
    expect(shouldSkipRaw(toLine(assistantLine(textBlock('x'), { messageId: 'm' })))).toBe(false)
    expect(shouldSkipRaw(toLine(aiTitle('t')))).toBe(false)
    expect(shouldSkipRaw(toLine(systemApiError(1, 3)))).toBe(false)
  })

  it('R-04 is only a prefilter: types it misses still parse to null', () => {
    expect(parse(bookkeepingLine('cost-state'))).toBeNull()
    expect(parse(bookkeepingLine('mode'))).toBeNull()
  })
})

describe('R-04 targetFor', () => {
  it('R-04 file tools use the path', () => {
    expect(targetFor('Read', { file_path: 'a/b.ts' })).toBe('a/b.ts')
    expect(targetFor('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('n.ipynb')
  })
  it('R-04 Bash/PowerShell use the first command line, max 120 chars', () => {
    expect(targetFor('Bash', { command: 'ls -la\nrm x' })).toBe('ls -la')
    expect(targetFor('PowerShell', { command: 'Get-ChildItem' })).toBe('Get-ChildItem')
    expect(targetFor('Bash', { command: 'c'.repeat(300) }).length).toBeLessThanOrEqual(121)
  })
  it('R-04 Grep/Glob use the pattern, with " in <path>" when a path is given', () => {
    expect(targetFor('Grep', { pattern: 'foo' })).toBe('foo')
    expect(targetFor('Grep', { pattern: 'foo', path: 'src' })).toBe('foo in src')
    expect(targetFor('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })
  it('R-04 web tools use url / query', () => {
    expect(targetFor('WebFetch', { url: 'https://example.com/a' })).toBe('https://example.com/a')
    expect(targetFor('WebSearch', { query: 'vitest docs' })).toBe('vitest docs')
  })
  it('R-04 Agent prefers name, then subagent_type, then description', () => {
    expect(targetFor('Agent', { name: 'n', subagent_type: 's', description: 'd' })).toBe('n')
    expect(targetFor('Agent', { subagent_type: 's', description: 'd' })).toBe('s')
    expect(targetFor('Agent', { description: 'd' })).toBe('d')
  })
  it('R-04 SendMessage, Skill and mcp tools', () => {
    expect(targetFor('SendMessage', { to: 'bob' })).toBe('→ bob')
    expect(targetFor('Skill', { skill: 'my-skill' })).toBe('my-skill')
    expect(targetFor('mcp__server__do_thing', { a: 1 })).toBe('do_thing')
  })
  it('R-04 unknown tools and bad inputs give an empty string; total length is capped at 160', () => {
    expect(targetFor('Mystery', { x: 1 })).toBe('')
    expect(targetFor('Read', null as unknown as Record<string, unknown>)).toBe('')
    expect(targetFor('Read', { file_path: 'f'.repeat(500) }).length).toBeLessThanOrEqual(161)
  })
})
