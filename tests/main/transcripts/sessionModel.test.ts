import { describe, expect, it } from 'vitest'
import { createSessionModel, parseSubagentMeta, type SessionModel } from '../../../src/main/transcripts/sessionModel'
import { parseLine } from '../../../src/main/transcripts/parseLine'
import {
  SESSION_ID,
  agentNameLine,
  agentResult,
  agentToolUse,
  aiTitle,
  apiErrorLine,
  assistantBlocks,
  at,
  compactSummaryPrompt,
  customTitle,
  editResult,
  interruptedLine,
  sendMessageUse,
  systemApiError,
  taskNotification,
  textBlock,
  toLine,
  toolResult,
  toolUseBlock,
  usage,
  userPrompt
} from '../../fixtures/transcripts/builders'
import { MSG_USAGE, NESTED, NOMETA, NOW_MS, ORPHAN, S1, SUB1, TEAM, buildTranscriptTree } from '../../fixtures/transcripts/trees'

// Signature assumptions (T05 Notes): createSessionModel({sessionId, accountId, projectCwd?, caps?}),
// model.ingest(source, records), setMeta(agentId, meta), setRegistry(entry|null), reset(source),
// markHistoryTruncated(), isDirty(), snapshot(nowMs). Records come from the real parseLine (T02).
const recs = (objs: unknown[]) => objs.map((o) => parseLine(toLine(o))).filter((r): r is NonNullable<typeof r> => r !== null)
const hms = (ms: number): string => new Date(ms).toTimeString().slice(0, 8)
const hm = (ms: number): string => hms(ms).slice(0, 5)
const T = (sec: number): number => Date.parse(at(sec))

function loadTree(opts: { reverse?: boolean; withMetas?: boolean } = {}) {
  const tree = buildTranscriptTree()
  const m = createSessionModel({ sessionId: S1, accountId: 'acme', projectCwd: 'd:\\work\\demo' })
  const meta = (p: string) => parseSubagentMeta(tree.files[p]!)!
  const sources: [string, Record<string, unknown>[]][] = [
    ['lead', tree.lines.lead],
    [SUB1, tree.lines.sub1],
    [NESTED, tree.lines.nested],
    [TEAM, tree.lines.team],
    [NOMETA, recsToObjs(tree.files[tree.paths.nometa]!)],
    [ORPHAN, recsToObjs(tree.files[tree.paths.orphan]!)]
  ]
  if (opts.reverse) sources.reverse()
  if (opts.withMetas !== false) {
    m.setMeta(SUB1, meta(tree.paths.sub1Meta))
    m.setMeta(NESTED, meta(tree.paths.nestedMeta))
    m.setMeta(TEAM, meta(tree.paths.teamMeta))
    m.setMeta(ORPHAN, meta(tree.paths.orphanMeta))
  }
  for (const [src, lines] of sources) m.ingest(src, recs(lines))
  return { tree, m, snap: m.snapshot(NOW_MS) as any }
}
function recsToObjs(text: string): Record<string, unknown>[] {
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
}
const agentOf = (snap: any, id: string): any => snap.agents.find((a: any) => a.id === id)

function mini(objs: unknown[], opts: Partial<Parameters<typeof createSessionModel>[0]> = {}) {
  const m = createSessionModel({ sessionId: SESSION_ID, accountId: 'acc', ...opts })
  m.ingest('lead', recs(objs))
  return { m, snap: () => m.snapshot(NOW_MS) as any }
}

describe('R-05 parseSubagentMeta', () => {
  it('R-05 copies only the known fields', () => {
    const m = parseSubagentMeta(
      JSON.stringify({ agentType: 'Explore', description: 'd', toolUseId: 'toolu_1', spawnDepth: 2, model: 'm', finished: true, name: 'rev', requestShape: 'background', isBuiltIn: true, extra: 'x' })
    ) as any
    expect(m).toEqual({ agentType: 'Explore', description: 'd', toolUseId: 'toolu_1', spawnDepth: 2, model: 'm', finished: true, name: 'rev', requestShape: 'background' })
  })
  it('R-05 wrong field types are dropped and bad json is null', () => {
    const m = parseSubagentMeta(JSON.stringify({ agentType: 5, toolUseId: {}, spawnDepth: 'x', finished: 'yes', name: 'ok' })) as any
    expect(m).toEqual({ name: 'ok' })
    expect(parseSubagentMeta('{nope')).toBeNull()
    expect(parseSubagentMeta('[1]')).toBeNull()
  })
})

describe('R-05 agent tree', () => {
  const { snap } = loadTree()

  it('R-05 the lead is always first with id lead, kind lead and depth 0', () => {
    const lead = snap.agents[0]
    expect(lead).toMatchObject({ id: 'lead', name: 'lead', depth: 0 })
    expect(lead.runtime.kind).toBe('lead')
    expect(lead.parentId ?? undefined).toBeUndefined()
  })

  it('R-05 agents are ordered depth-first, children by start time', () => {
    expect(snap.agents.map((a: any) => a.id)).toEqual(['lead', SUB1, NESTED, TEAM, NOMETA, ORPHAN])
  })

  it('R-05 parent comes from meta.toolUseId owner: lead, a sibling sub-agent, or the lead as fallback', () => {
    expect(agentOf(snap, SUB1).parentId).toBe('lead')
    expect(agentOf(snap, NESTED).parentId).toBe(SUB1) // spawned by a tool_use inside SUB1's own file
    expect(agentOf(snap, TEAM).parentId).toBe('lead')
    expect(agentOf(snap, NOMETA).parentId).toBe('lead') // no meta file
    expect(agentOf(snap, ORPHAN).parentId).toBe('lead') // meta.toolUseId exists in no file
  })

  it('R-05 depth is parent depth + 1', () => {
    expect(agentOf(snap, SUB1).depth).toBe(1)
    expect(agentOf(snap, NESTED).depth).toBe(2)
    expect(agentOf(snap, NOMETA).depth).toBe(1)
  })

  it('R-05 name, role, task title and model come from meta and lines', () => {
    expect(agentOf(snap, SUB1)).toMatchObject({ name: 'Explore', role: 'Explore', taskTitle: 'Explore repo', model: 'claude-test-haiku' })
    expect(agentOf(snap, NESTED)).toMatchObject({ role: 'general-purpose', taskTitle: 'Nested look' })
    expect(agentOf(snap, NOMETA)).toMatchObject({ name: 'agent', role: '', taskTitle: '' })
    expect(agentOf(snap, ORPHAN).name).toBe('Plan')
  })

  it('R-05 an agent with meta.name is a teammate and is named after it', () => {
    const team = agentOf(snap, TEAM)
    expect(team.name).toBe('reviewer')
    expect(team.runtime.kind).toBe('teammate')
    expect(agentOf(snap, SUB1).runtime.kind).toBe('subagent')
  })

  it('R-05 initials are upper case (max 2 letters) and the lead has the fixed colour', () => {
    expect(agentOf(snap, TEAM).initials).toBe('R')
    expect(agentOf(snap, 'lead').initials).toBe('L')
    expect(agentOf(snap, 'lead').avatarColor).toBe('#7AA7FF')
    for (const a of snap.agents) {
      expect(a.initials.length).toBeLessThanOrEqual(2)
      expect(a.avatarColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('R-05 the model name falls back to meta.model when no assistant line was seen', () => {
    const m = createSessionModel({ sessionId: S1, accountId: 'a' })
    m.setMeta('aaaa', { agentType: 'Plan', model: 'meta-model' })
    expect((agentOf(m.snapshot(NOW_MS), 'aaaa') as any).model).toBe('meta-model')
  })

  it('R-05 the tree is identical when files arrive in the opposite order (parents resolved lazily)', () => {
    const fwd = loadTree().snap
    const rev = loadTree({ reverse: true }).snap
    expect(rev.agents.map((a: any) => [a.id, a.parentId, a.depth])).toEqual(fwd.agents.map((a: any) => [a.id, a.parentId, a.depth]))
  })

  it('R-05 a sub-agent seen before its meta arrives is re-parented when the meta arrives', () => {
    const tree = buildTranscriptTree()
    const m = createSessionModel({ sessionId: S1, accountId: 'acme' })
    m.ingest('lead', recs(tree.lines.lead))
    m.ingest(SUB1, recs(tree.lines.sub1))
    m.ingest(NESTED, recs(tree.lines.nested))
    expect(agentOf(m.snapshot(NOW_MS), NESTED).parentId).toBe('lead')
    m.setMeta(NESTED, parseSubagentMeta(tree.files[tree.paths.nestedMeta]!)!)
    expect(agentOf(m.snapshot(NOW_MS), NESTED).parentId).toBe(SUB1)
  })

  it('R-05 a parent cycle falls back to the lead instead of looping', () => {
    const m = createSessionModel({ sessionId: S1, accountId: 'a' })
    const spawn = (id: string, name: string, sec: number, agent: string) =>
      assistantBlocks([agentToolUse(id, { description: name })], { ts: at(sec), agentId: agent, messageId: `msg_${id}`, stopReason: 'tool_use' })
    m.ingest('aaa', recs([...spawn('toolu_a', 'A', 1, 'aaa')]))
    m.ingest('bbb', recs([...spawn('toolu_b', 'B', 2, 'bbb')]))
    m.setMeta('aaa', { toolUseId: 'toolu_b' })
    m.setMeta('bbb', { toolUseId: 'toolu_a' })
    const snap = m.snapshot(NOW_MS) as any
    expect(snap.agents).toHaveLength(3)
    for (const a of snap.agents) expect(a.depth).toBeLessThan(5)
  })
})

describe('R-06 tokens (deduped by message.id)', () => {
  const { snap, tree } = loadTree()

  it('R-06 per-agent tokens = input + output + cacheCreation of the deduped usage (cacheRead excluded)', () => {
    expect(agentOf(snap, 'lead').tokens).toBe(tree.expect.headline.lead)
    expect(agentOf(snap, SUB1).tokens).toBe(tree.expect.headline.sub1)
    expect(agentOf(snap, NESTED).tokens).toBe(tree.expect.headline.nested)
    expect(agentOf(snap, TEAM).tokens).toBe(tree.expect.headline.team)
  })

  it('R-06 the 3 split lines of msg_L1 count once (msg_L1 = 100+50+1000)', () => {
    const only = mini(assistantBlocks([textBlock('a'), textBlock('b'), textBlock('c')], { ts: at(1), messageId: 'msg_dup', stopReason: 'end_turn', usage: usage(100, 50, 1000, 5000) }))
    expect(agentOf(only.snap(), 'lead').tokens).toBe(1150)
  })

  it('R-06 re-ingesting the same records (same uuids) changes nothing', () => {
    const tree = buildTranscriptTree()
    const m = createSessionModel({ sessionId: S1, accountId: 'acme' })
    const lead = recs(tree.lines.lead)
    m.ingest('lead', lead)
    const first = m.snapshot(NOW_MS) as any
    m.ingest('lead', lead)
    const second = m.snapshot(NOW_MS) as any
    expect(agentOf(second, 'lead').tokens).toBe(agentOf(first, 'lead').tokens)
    expect(second.events.length).toBe(first.events.length)
    expect(agentOf(second, 'lead').activity.length).toBe(agentOf(first, 'lead').activity.length)
    expect(second.console.length).toBe(first.console.length)
  })

  it('R-06 a fork copy (same uuids and message ids) in another file adds no tokens or events twice', () => {
    const tree = buildTranscriptTree()
    const m = createSessionModel({ sessionId: S1, accountId: 'acme' })
    m.ingest('lead', recs(tree.lines.lead))
    const before = m.snapshot(NOW_MS) as any
    const forkLines = recsToObjs(tree.files[tree.paths.s2]!).slice(1, 5) // copied prompt + msg_L1 lines
    m.ingest('lead', recs(forkLines))
    const after = m.snapshot(NOW_MS) as any
    expect(agentOf(after, 'lead').tokens).toBe(agentOf(before, 'lead').tokens)
    expect(after.events.length).toBe(before.events.length)
  })

  it('R-06 same message id on lines with different uuids is still counted once; the last usage replaces earlier ones', () => {
    const a = assistantBlocks([textBlock('x')], { ts: at(1), messageId: 'msg_same', stopReason: 'end_turn', usage: usage(10, 10) })
    const b = assistantBlocks([textBlock('y')], { ts: at(2), messageId: 'msg_same', stopReason: 'end_turn', usage: usage(12, 10) })
    expect(agentOf(mini([...a, ...b]).snap(), 'lead').tokens).toBe(22)
  })

  it('R-06 API error lines add no tokens', () => {
    const t = mini([...assistantBlocks([textBlock('x')], { ts: at(1), messageId: 'msg_ok', stopReason: 'end_turn', usage: usage(5, 5) }), apiErrorLine('rate_limit', { ts: at(2) })])
    expect(agentOf(t.snap(), 'lead').tokens).toBe(10)
  })

  it('R-06 events carry tokens once per message id (sum over events = unique usage of the session)', () => {
    const { snap: s } = loadTree()
    const ids = ['msg_L1', 'msg_S1a', 'msg_S1b', 'msg_N1', 'msg_S1c', 'msg_L2', 'msg_L3', 'msg_L4', 'msg_T1', 'msg_L5', 'msg_L6', 'msg_NM1', 'msg_OR1', 'msg_L7']
    const expectedIn = ids.reduce((n, id) => n + MSG_USAGE[id]!.input, 0)
    const gotIn = s.events.reduce((n: number, e: any) => n + (e.tokens?.input ?? 0), 0)
    expect(gotIn).toBe(expectedIn)
  })
})

describe('R-06 per-agent live fields', () => {
  const { snap, tree } = loadTree()

  it('R-06 toolCalls counts distinct tool_use ids', () => {
    expect(agentOf(snap, 'lead').toolCalls).toBe(tree.expect.leadTools)
    expect(agentOf(snap, SUB1).toolCalls).toBe(tree.expect.sub1Tools)
    expect(agentOf(snap, TEAM).toolCalls).toBe(tree.expect.teamTools)
    expect(agentOf(snap, NOMETA).toolCalls).toBe(0)
  })

  it('R-06 current is the newest open tool; else the last tool; else empty', () => {
    expect(agentOf(snap, 'lead').current).toMatchObject({ tool: 'AskUserQuestion' })
    expect(agentOf(snap, SUB1).current.tool).toBe('Agent')
    expect(agentOf(snap, NOMETA).current).toEqual({ tool: '', target: '' })
  })

  it('R-06 worktree is the last gitBranch and cwd the last cwd', () => {
    expect(agentOf(snap, 'lead')).toMatchObject({ worktree: 'main', cwd: 'd:\\work\\demo' })
  })

  it('R-06 elapsedSec runs to now for a running agent and to the last activity otherwise', () => {
    expect(agentOf(snap, 'lead').elapsedSec).toBe(Math.round((NOW_MS - T(0)) / 1000)) // open tool = running
    expect(agentOf(snap, SUB1).elapsedSec).toBe(7) // t6 -> t13, ended
    expect(agentOf(snap, TEAM).elapsedSec).toBe(Math.round((NOW_MS - T(21)) / 1000)) // last line is a tool_result = running
  })

  it('R-06 timeline is empty until Phase 5', () => {
    for (const a of snap.agents) expect(a.timeline).toEqual([])
  })

  it('R-06 files aggregate +/- per path, most recent change first', () => {
    const files = agentOf(snap, 'lead').files
    expect(files.map((f: any) => f.path)).toEqual(tree.expect.leadFiles.map((f) => f.path).reverse())
    for (const e of tree.expect.leadFiles) expect(files.find((f: any) => f.path === e.path)).toMatchObject({ added: e.added, removed: e.removed })
  })

  it('R-06 two edits to one path are summed into one entry', () => {
    const edit = (id: string, sec: number, lines: string[]) => [
      ...assistantBlocks([toolUseBlock(id, 'Edit', { file_path: 'd:/x/a.ts' })], { ts: at(sec), messageId: `msg_${id}`, stopReason: 'tool_use' }),
      editResult(id, 'd:/x/a.ts', lines, { ts: at(sec + 1) })
    ]
    const t = mini([...edit('toolu_e1', 1, ['-a', '+b', '+c']), ...edit('toolu_e2', 5, ['-d', '+e'])])
    const files = agentOf(t.snap(), 'lead').files
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'd:/x/a.ts', added: 3, removed: 2 })
  })

  it('R-06 files and activity of one agent are not mixed into another', () => {
    expect(agentOf(snap, SUB1).files).toEqual([])
    expect(agentOf(snap, TEAM).activity.map((a: any) => a.tool)).toEqual(['SendMessage'])
  })
})

describe('R-06 activity', () => {
  const { snap } = loadTree()
  const lead = agentOf(snap, 'lead')
  const act = (tool: string) => lead.activity.find((a: any) => a.tool === tool)

  it('R-06 one item per tool_use, oldest first', () => {
    expect(lead.activity.map((a: any) => a.tool)).toEqual(['Agent', 'Edit', 'Write', 'Agent', 'SendMessage', 'Bash', 'AskUserQuestion'])
  })

  it('R-06 time is the local HH:MM:SS of the tool_use timestamp', () => {
    expect(act('Edit').time).toBe(hms(T(15)))
    expect(act('Bash').time).toBe(hms(T(26)))
  })

  it('R-06 an edit result shows +added −removed and the path as target', () => {
    expect(act('Edit')).toMatchObject({ target: 'd:/work/demo/src/a.ts', result: '+3 −2', failed: false })
    expect(act('Write').result).toBe('+3 −0')
  })

  it('R-06 a failed tool is flagged and shows the error summary', () => {
    expect(act('Bash')).toMatchObject({ failed: true, result: 'Error: exit code 1', target: 'npm test' })
  })

  it('R-06 an open tool shows the ellipsis result', () => {
    expect(act('AskUserQuestion').result).toBe('…')
  })

  it('R-06 other results use the first summary line', () => {
    expect(act('SendMessage').result).toBe('sent')
    expect(lead.activity[0].result).toBe('Found 3 files')
  })

  it('R-06 an interrupted tool shows "interrupted"', () => {
    const t = mini([
      ...assistantBlocks([toolUseBlock('toolu_i', 'Bash', { command: 'sleep 99' })], { ts: at(1), messageId: 'msg_i', stopReason: 'tool_use' }),
      toolResult('toolu_i', 'x', { ts: at(2), isError: true, toolDenialKind: 'interrupted', toolUseResult: { stdout: '', stderr: '', interrupted: true } })
    ])
    expect(agentOf(t.snap(), 'lead').activity[0].result).toBe('interrupted')
  })

  it('R-06 a failed result without text falls back to "error"', () => {
    const t = mini([
      ...assistantBlocks([toolUseBlock('toolu_f', 'Bash', { command: 'x' })], { ts: at(1), messageId: 'msg_f', stopReason: 'tool_use' }),
      toolResult('toolu_f', '', { ts: at(2), isError: true })
    ])
    expect(agentOf(t.snap(), 'lead').activity[0]).toMatchObject({ failed: true, result: 'error' })
  })

  it('R-06 activity is capped (default 150) keeping the newest', () => {
    const objs: unknown[] = []
    for (let i = 0; i < 200; i++) objs.push(...assistantBlocks([toolUseBlock(`toolu_c${i}`, 'Read', { file_path: `f${i}.ts` })], { ts: at(i), messageId: `msg_c${i}`, stopReason: 'tool_use' }))
    const a = agentOf(mini(objs).snap(), 'lead').activity
    expect(a.length).toBe(150)
    expect(a[149].target).toBe('f199.ts')
  })

  it('R-06 caps.activity is honoured', () => {
    const objs: unknown[] = []
    for (let i = 0; i < 10; i++) objs.push(...assistantBlocks([toolUseBlock(`toolu_d${i}`, 'Read', { file_path: `f${i}.ts` })], { ts: at(i), messageId: `msg_d${i}`, stopReason: 'tool_use' }))
    expect(agentOf(mini(objs, { caps: { activity: 4 } }).snap(), 'lead').activity.map((a: any) => a.target)).toEqual(['f6.ts', 'f7.ts', 'f8.ts', 'f9.ts'])
  })
})

describe('R-06 messages (Messages tab)', () => {
  const { snap } = loadTree()
  const msgs = (id: string) => agentOf(snap, id).messages as any[]

  it('R-06 a sub-agent first task is an "in" message from its parent', () => {
    expect(msgs(SUB1).find((m) => m.direction === 'in' && m.text === 'List the files')).toMatchObject({ peer: 'lead' })
    expect(msgs(NESTED).find((m) => m.direction === 'in' && m.text.includes('nested thing'))).toMatchObject({ peer: 'Explore' })
  })

  it('R-06 the parent\'s Agent result text is an "out" message on the child', () => {
    expect(msgs(SUB1).find((m) => m.direction === 'out' && m.text.includes('Found 3 files'))).toMatchObject({ peer: 'lead' })
    expect(msgs(NESTED).find((m) => m.direction === 'out' && m.text.includes('nested done'))).toMatchObject({ peer: 'Explore' })
  })

  it('R-06 SendMessage is out on the sender and in on the recipient when it resolves to an agent', () => {
    expect(msgs('lead').find((m) => m.direction === 'out' && m.text.includes('Please check the diff'))).toMatchObject({ peer: 'reviewer' })
    expect(msgs(TEAM).find((m) => m.direction === 'in' && m.text.includes('Please check the diff'))).toMatchObject({ peer: 'lead' })
  })

  it('R-06 a recipient alias for the lead (team-lead) resolves to the lead', () => {
    expect(msgs(TEAM).find((m) => m.direction === 'out' && m.text.includes('LGTM'))).toMatchObject({ peer: 'team-lead' })
    expect(msgs('lead').find((m) => m.direction === 'in' && m.text.includes('LGTM'))).toMatchObject({ peer: 'reviewer' })
  })

  it('R-06 an unresolvable recipient only produces the out message', () => {
    const t = mini(assistantBlocks([sendMessageUse('toolu_x', { to: 'nobody-here', message: 'hello?' })], { ts: at(1), messageId: 'msg_x', stopReason: 'tool_use' }))
    const lead = agentOf(t.snap(), 'lead')
    expect(lead.messages).toHaveLength(1)
    expect(lead.messages[0]).toMatchObject({ direction: 'out', peer: 'nobody-here' })
  })

  it('R-06 message time is local HH:MM', () => {
    expect(msgs(SUB1).find((m) => m.direction === 'in').time).toBe(hm(T(6)))
  })

  it('R-06 messages are capped (default 100) and caps.messages is honoured', () => {
    const objs: unknown[] = []
    for (let i = 0; i < 12; i++) objs.push(...assistantBlocks([sendMessageUse(`toolu_m${i}`, { to: 'x', message: `m${i}` })], { ts: at(i), messageId: `msg_m${i}`, stopReason: 'tool_use' }))
    const m = agentOf(mini(objs, { caps: { messages: 5 } }).snap(), 'lead').messages
    expect(m).toHaveLength(5)
    expect(m[4].text).toContain('m11')
  })
})

describe('R-06 runtime (feeds live status)', () => {
  it('R-06 lead runtime from the fixture tree', () => {
    const { snap } = loadTree()
    const rt = agentOf(snap, 'lead').runtime
    expect(rt).toMatchObject({ kind: 'lead', startedMs: T(0), lastActivityMs: T(40), lastTurn: 'assistant_tool_use' })
    expect(rt.openTools.map((t: any) => t.name)).toEqual(['AskUserQuestion'])
  })

  it('R-06 finished: meta.finished, or the parent got a completed Agent result', () => {
    const { snap } = loadTree()
    expect(agentOf(snap, SUB1).runtime.finished).toBe(true)
    expect(agentOf(snap, NESTED).runtime.finished).toBe(true) // meta has no finished flag, SUB1 got "completed"
    expect(agentOf(snap, TEAM).runtime.finished).toBeFalsy()
    expect(agentOf(snap, ORPHAN).runtime.finished).toBeFalsy()
  })

  it('R-06 background: meta.requestShape background, or an async_launched result', () => {
    const { snap } = loadTree()
    expect(agentOf(snap, TEAM).runtime.background).toBe(true)
    expect(agentOf(snap, SUB1).runtime.background).toBeFalsy()
    const t = createSessionModel({ sessionId: S1, accountId: 'a' })
    t.ingest('lead', recs([
      ...assistantBlocks([agentToolUse('toolu_bg', { description: 'bg' })], { ts: at(1), messageId: 'msg_bg', stopReason: 'tool_use' }),
      agentResult('toolu_bg', { agentId: 'zzz', status: 'async_launched' }, { ts: at(2) })
    ]))
    t.ingest('zzz', recs([userPrompt('go', { ts: at(3), agentId: 'zzz', parentUuid: null })]))
    t.setMeta('zzz', { toolUseId: 'toolu_bg' })
    expect(agentOf(t.snapshot(NOW_MS), 'zzz').runtime.background).toBe(true)
  })

  it('R-06 openTools are matched by tool_use id (not FIFO by name)', () => {
    const t = mini([
      ...assistantBlocks([toolUseBlock('toolu_p1', 'Bash', { command: 'a' }), toolUseBlock('toolu_p2', 'Bash', { command: 'b' })], { ts: at(1), messageId: 'msg_p', stopReason: 'tool_use' }),
      toolResult('toolu_p2', 'done b', { ts: at(2) })
    ])
    const rt = agentOf(t.snap(), 'lead').runtime
    expect(rt.openTools.map((o: any) => o.id)).toEqual(['toolu_p1'])
    expect(rt.lastTurn).toBe('tool_result')
  })

  it('R-06 an interrupt clears open tools and sets lastTurn interrupted', () => {
    const t = mini([
      ...assistantBlocks([toolUseBlock('toolu_q', 'Bash', { command: 'a' })], { ts: at(1), messageId: 'msg_q', stopReason: 'tool_use' }),
      interruptedLine({ ts: at(2) })
    ])
    const rt = agentOf(t.snap(), 'lead').runtime
    expect(rt.openTools).toEqual([])
    expect(rt.lastTurn).toBe('interrupted')
  })

  it('R-06 lastTurn: prompt -> user, end_turn -> assistant_end, tool_use -> assistant_tool_use', () => {
    const last = (objs: unknown[]) => agentOf(mini(objs).snap(), 'lead').runtime.lastTurn
    expect(last([userPrompt('hi', { ts: at(1) })])).toBe('user')
    expect(last(assistantBlocks([textBlock('x')], { ts: at(1), messageId: 'm1', stopReason: 'end_turn' }))).toBe('assistant_end')
    expect(last(assistantBlocks([textBlock('x')], { ts: at(1), messageId: 'm2', stopReason: 'stop_sequence' }))).toBe('assistant_end')
    expect(last(assistantBlocks([toolUseBlock('toolu_z', 'Read', {})], { ts: at(1), messageId: 'm3', stopReason: 'tool_use' }))).toBe('assistant_tool_use')
  })

  it('R-06 task-notification and compact-summary prompts do not change lastTurn', () => {
    const t = mini([
      ...assistantBlocks([textBlock('x')], { ts: at(1), messageId: 'm1', stopReason: 'end_turn' }),
      taskNotification('bg done', { ts: at(2) }),
      compactSummaryPrompt('summary', { ts: at(3) })
    ])
    expect(agentOf(t.snap(), 'lead').runtime.lastTurn).toBe('assistant_end')
  })

  it('R-06 an assistant API-error line sets lastTurn api_error with the error kind', () => {
    const t = mini([userPrompt('hi', { ts: at(1) }), apiErrorLine('rate_limit', { ts: at(2) })])
    expect(agentOf(t.snap(), 'lead').runtime).toMatchObject({ lastTurn: 'api_error', errorKind: 'rate_limit' })
  })

  it('R-06 a fatal system api_error sets lastTurn api_error; a retry does not', () => {
    expect(agentOf(mini([userPrompt('hi', { ts: at(1) }), systemApiError(5, 5, { ts: at(2) })]).snap(), 'lead').runtime.lastTurn).toBe('api_error')
    expect(agentOf(mini([userPrompt('hi', { ts: at(1) }), systemApiError(1, 5, { ts: at(2) })]).snap(), 'lead').runtime.lastTurn).toBe('user')
  })

  it('R-06 the registry entry lands on the lead only and clears with null', () => {
    const { m } = loadTree()
    m.setRegistry({ status: 'waiting', waitingFor: 'dialog open', updatedMs: T(41) })
    let s = m.snapshot(NOW_MS) as any
    expect(agentOf(s, 'lead').runtime.registry).toEqual({ status: 'waiting', waitingFor: 'dialog open', updatedMs: T(41) })
    expect(agentOf(s, SUB1).runtime.registry).toBeUndefined()
    m.setRegistry(null)
    s = m.snapshot(NOW_MS)
    expect(agentOf(s, 'lead').runtime.registry).toBeUndefined()
  })
})

describe('R-06 events and console', () => {
  const { snap } = loadTree()
  const ev = snap.events as any[]

  it('R-06 events are chronological and carry session, account, agent and uuid', () => {
    const ts = ev.map((e) => Date.parse(e.ts))
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
    for (const e of ev) {
      expect(e.sessionId).toBe(S1)
      expect(e.accountId).toBe('acme')
      expect(typeof e.agentId).toBe('string')
    }
  })

  it('R-06 every tool_use emits tool_start with the tool use id; every result emits tool_end', () => {
    const start = ev.find((e) => e.kind === 'tool_start' && e.toolUseId === 'toolu_lead_edit')
    expect(start).toMatchObject({ agentId: 'lead', tool: 'Edit', target: 'd:/work/demo/src/a.ts' })
    expect(ev.find((e) => e.kind === 'tool_end' && e.toolUseId === 'toolu_lead_edit')).toMatchObject({ agentId: 'lead', failed: false })
  })

  it('R-06 a failed tool_end carries failed:true and the result text', () => {
    expect(ev.find((e) => e.kind === 'tool_end' && e.toolUseId === 'toolu_lead_bash')).toMatchObject({ failed: true, result: 'Error: exit code 1' })
  })

  it('R-06 an Agent tool_use also emits a spawn event targeting the agent name', () => {
    const spawns = ev.filter((e) => e.kind === 'spawn')
    expect(spawns.map((e) => e.target)).toEqual(expect.arrayContaining(['Explore', 'reviewer']))
  })

  it('R-06 events of a sub-agent name their parent', () => {
    expect(ev.find((e) => e.agentId === NESTED)?.parentAgentId).toBe(SUB1)
    expect(ev.find((e) => e.agentId === SUB1)?.parentAgentId).toBe('lead')
  })

  it('R-06 the user prompt is a message event of agent lead with result "user"', () => {
    expect(ev.find((e) => e.kind === 'message' && e.agentId === 'lead' && e.result === 'user')).toBeDefined()
  })

  it('R-06 a sub-agent becoming finished emits one stop event', () => {
    expect(ev.filter((e) => e.kind === 'stop' && e.agentId === SUB1)).toHaveLength(1)
  })

  it('R-06 API errors emit an error event and interrupts a status event with result interrupted', () => {
    const e = mini([userPrompt('hi', { ts: at(1) }), apiErrorLine('server_error', { ts: at(2) }), interruptedLine({ ts: at(3) })])
    const events = e.snap().events
    expect(events.find((x: any) => x.kind === 'error')).toBeDefined()
    expect(events.find((x: any) => x.kind === 'status')).toMatchObject({ result: 'interrupted' })
  })

  it('R-06 events are capped (caps.events) keeping the newest', () => {
    const objs: unknown[] = []
    for (let i = 0; i < 20; i++) objs.push(...assistantBlocks([toolUseBlock(`toolu_v${i}`, 'Read', { file_path: `f${i}` })], { ts: at(i), messageId: `msg_v${i}`, stopReason: 'tool_use' }))
    const events = mini(objs, { caps: { events: 6 } }).snap().events
    expect(events).toHaveLength(6)
    expect(events[5].toolUseId).toBe('toolu_v19')
  })

  describe('console', () => {
    const lines = snap.console as any[]
    it('R-06 user prompts are who "you"; time is local HH:MM:SS', () => {
      expect(lines.find((l) => l.who === 'you')).toMatchObject({ text: 'Please refactor the parser', time: hms(T(0)) })
    })
    it('R-06 tool starts read "<tool> <target>" under the agent id', () => {
      expect(lines.find((l) => l.who === SUB1 && l.text === 'Read d:/work/demo/src/a.ts')).toBeDefined()
    })
    it('R-06 failed tools read "✗ <tool>: <summary>"', () => {
      expect(lines.find((l) => l.text === '✗ Bash: Error: exit code 1')).toMatchObject({ who: 'lead' })
    })
    it('R-06 spawn and done lines', () => {
      expect(lines.some((l) => l.text === 'spawned reviewer')).toBe(true)
      expect(lines.some((l) => l.who === SUB1 && l.text === 'done')).toBe(true)
    })
    it('R-06 assistant text is shown (max 200 chars) under the agent id', () => {
      expect(lines.find((l) => l.who === 'lead' && l.text === 'I will explore first.')).toBeDefined()
      const long = mini(assistantBlocks([textBlock('w'.repeat(500))], { ts: at(1), messageId: 'm', stopReason: 'end_turn' })).snap().console
      expect(long[0].text.length).toBeLessThanOrEqual(201)
    })
    it('R-06 API errors read "API error: <kind>"', () => {
      const c = mini([userPrompt('hi', { ts: at(1) }), apiErrorLine('rate_limit', { ts: at(2) })]).snap().console
      expect(c.some((l: any) => l.text === 'API error: rate_limit')).toBe(true)
    })
    it('R-06 console is chronological and capped (caps.console)', () => {
      const objs: unknown[] = []
      for (let i = 0; i < 20; i++) objs.push(userPrompt(`prompt ${i}`, { ts: at(i) }))
      const c = mini(objs, { caps: { console: 7 } }).snap().console
      expect(c).toHaveLength(7)
      expect(c[0].text).toBe('prompt 13')
      expect(c[6].text).toBe('prompt 19')
    })
  })
})

describe('R-06 snapshot envelope', () => {
  it('R-06 fills the live snapshot fields', () => {
    const { snap } = loadTree()
    expect(snap).toMatchObject({
      source: 'live',
      sessionId: S1,
      accountId: 'acme',
      repo: 'demo',
      teamName: 'Renamed demo',
      title: 'Renamed demo',
      now: new Date(NOW_MS).toISOString(),
      worktrees: [],
      tasks: [],
      overlaps: [],
      timelineTicks: []
    })
    expect(snap.cwd).toBe('d:\\work\\demo')
    expect(snap.historyTruncated).toBeFalsy()
  })

  it('R-06 the lead role is the session title (or "Lead" without one)', () => {
    expect(agentOf(loadTree().snap, 'lead').role).toBe('Renamed demo')
    expect(agentOf(mini([userPrompt('hi', { ts: at(1) })]).snap(), 'lead').role).toBe('Lead')
  })

  it('R-06 without a title the team name is the first 8 chars of the session id', () => {
    expect(mini([userPrompt('hi', { ts: at(1) })]).snap().teamName).toBe(SESSION_ID.slice(0, 8))
  })

  it('R-06 title precedence: the last custom title wins over ai titles, which win over agent names', () => {
    const title = (objs: unknown[]) => mini(objs).snap().title
    expect(title([agentNameLine('N')])).toBe('N')
    expect(title([agentNameLine('N'), aiTitle('A')])).toBe('A')
    expect(title([aiTitle('A'), customTitle('C1'), aiTitle('A2'), agentNameLine('N2')])).toBe('C1')
    expect(title([customTitle('C1'), customTitle('C2')])).toBe('C2')
  })

  it('R-06 repo falls back to the lead cwd when projectCwd is not given', () => {
    const t = createSessionModel({ sessionId: S1, accountId: 'a' })
    t.ingest('lead', recs([userPrompt('hi', { ts: at(1), cwd: 'd:\\work\\fallback' })]))
    expect((t.snapshot(NOW_MS) as any).repo).toBe('fallback')
  })

  it('R-06 markHistoryTruncated sets historyTruncated', () => {
    const t = mini([userPrompt('hi', { ts: at(1) })])
    expect(t.snap().historyTruncated).toBeFalsy()
    t.m.markHistoryTruncated()
    expect(t.snap().historyTruncated).toBe(true)
  })

  it('R-06 an empty model still has the lead and does not throw', () => {
    const m = createSessionModel({ sessionId: S1, accountId: 'a' })
    const s = m.snapshot(NOW_MS) as any
    expect(s.agents.map((a: any) => a.id)).toEqual(['lead'])
    expect(s.events).toEqual([])
  })

  it('R-06 snapshot() returns fresh arrays (no shared mutable state)', () => {
    const { m } = loadTree()
    const a = m.snapshot(NOW_MS) as any
    a.agents.length = 0
    a.events.length = 0
    const b = m.snapshot(NOW_MS) as any
    expect(b.agents.length).toBeGreaterThan(0)
    expect(b.events.length).toBeGreaterThan(0)
    expect(b.agents[0].activity).not.toBe(a.agents[0]?.activity)
  })
})

describe('R-06 dirty flag, reset', () => {
  it('R-06 dirty after ingest, setMeta, setRegistry; clean after snapshot', () => {
    const m = createSessionModel({ sessionId: S1, accountId: 'a' })
    m.snapshot(NOW_MS)
    expect(m.isDirty()).toBe(false)
    m.ingest('lead', recs([userPrompt('hi', { ts: at(1) })]))
    expect(m.isDirty()).toBe(true)
    m.snapshot(NOW_MS)
    expect(m.isDirty()).toBe(false)
    m.setMeta('aaa', { agentType: 'x' })
    expect(m.isDirty()).toBe(true)
    m.snapshot(NOW_MS)
    m.setRegistry({ status: 'idle', updatedMs: 1 })
    expect(m.isDirty()).toBe(true)
    m.snapshot(NOW_MS)
    m.markHistoryTruncated()
    expect(m.isDirty()).toBe(true)
  })

  it('R-06 ingesting only duplicates does not make the model dirty', () => {
    const m = createSessionModel({ sessionId: S1, accountId: 'a' })
    const r = recs([userPrompt('hi', { ts: at(1), uuid: 'fixed-uuid' })])
    m.ingest('lead', r)
    m.snapshot(NOW_MS)
    m.ingest('lead', r)
    expect(m.isDirty()).toBe(false)
  })

  function snapshotWithout(model: SessionModel) {
    return model.snapshot(NOW_MS) as any
  }

  it('R-06 reset(source) drops that source\'s derived data and keeps the others', () => {
    const { m, tree } = loadTree()
    m.reset(SUB1)
    const s = snapshotWithout(m)
    expect(agentOf(s, SUB1)?.tokens ?? 0).toBe(0)
    expect(agentOf(s, SUB1)?.activity ?? []).toEqual([])
    expect(agentOf(s, 'lead').tokens).toBe(tree.expect.headline.lead)
    expect(agentOf(s, TEAM).tokens).toBe(tree.expect.headline.team)
  })

  it('R-06 after reset the same records can be ingested again (uuids and message ids were forgotten)', () => {
    const { m, tree } = loadTree()
    m.reset('lead')
    expect(agentOf(snapshotWithout(m), 'lead').tokens).toBe(0)
    m.ingest('lead', recs(tree.lines.lead))
    const s = snapshotWithout(m)
    expect(agentOf(s, 'lead').tokens).toBe(tree.expect.headline.lead)
    expect(agentOf(s, 'lead').toolCalls).toBe(tree.expect.leadTools)
  })
})

describe('R-06 user decisions: tokens headline', () => {
  it('R-06 headline = input + output + cacheCreation; cacheRead is not included', () => {
    const t = mini(assistantBlocks([textBlock('x')], { ts: at(1), messageId: 'msg_h', stopReason: 'end_turn', usage: usage(1, 2, 4, 1_000_000) }))
    expect(agentOf(t.snap(), 'lead').tokens).toBe(7)
  })
})
