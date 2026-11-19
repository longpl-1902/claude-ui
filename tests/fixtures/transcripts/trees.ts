// A whole synthetic `.claude`-style file tree ({path: content}) built from builders.ts.
// Everything is invented. Paths use forward slashes (`C:/Users/u/...`); memoryByteFs normalises `\`.
//
// Accounts / config dirs
//   acme   -> C:/Users/u/.claude-acme   (projects/d--work-demo: main session S1, fork copy S2; sessions/ registry)
//   ''     -> C:/Users/u/.claude        (projects/C--Users-u-other: S3 two local days + malformed + multibyte, S4 CRLF)
//
// Session S1 (lead + sub-agents), timeline in seconds after T0 (see `at`):
//   lead:      t0 prompt, t5 Agent#1 spawn, t14 result(completed), t15 Edit, t17 Write(create), t19 Agent#3 (named teammate,
//              background), t24 SendMessage to 'reviewer', t26 Bash that FAILS, t40 AskUserQuestion (left open)
//   SUB1:      Explore agent, parent = lead (meta.toolUseId in the lead file), spawns NESTED at t9, finishes t13
//   NESTED:    parent = SUB1 (meta.toolUseId lives in a SIBLING sub-agent file), spawnDepth 2
//   TEAM:      meta.name 'reviewer' (teammate), async_launched, sends SendMessage to 'team-lead' at t22
//   NOMETA:    sub file WITHOUT a meta file (parent falls back to lead)
//   ORPHAN:    meta.toolUseId that exists nowhere (parent falls back to lead)
import {
  FAKE_CREDENTIALS_CONTENT,
  agentNameLine,
  agentResult,
  agentToolUse,
  aiTitle,
  apiErrorLine,
  askUserQuestionUse,
  assistantBlocks,
  at,
  bashResult,
  bookkeepingLine,
  customTitle,
  editResult,
  errorResult,
  fakeKeyFile,
  jsonl,
  registryEntry,
  resetBuilderIds,
  sendMessageUse,
  subMeta,
  T0_MS,
  textBlock,
  thinkingBlock,
  toolResult,
  toolUseBlock,
  usage,
  userPrompt,
  writeCreateResult,
  type UsageSpec
} from './builders'

export const HOME = 'C:/Users/u'
export const ACME_DIR = `${HOME}/.claude-acme`
export const DEFAULT_DIR = `${HOME}/.claude`
export const ROOTS = [
  { accountId: 'acme', configDirAbs: ACME_DIR },
  { accountId: '', configDirAbs: DEFAULT_DIR }
]
/** "Now" for tests: one hour after T0 (2026-11-18T11:00:00Z). */
export const NOW_MS = T0_MS + 3_600_000
/** Timezone-independent day bucketer for injection (`localDay`): UTC date. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
/** Built from parts so a grep for the credentials file name stays confined to safeFs.ts. */
export const CREDENTIALS_BASENAME = ['.credentials', 'json'].join('.')

export const S1 = '11111111-aaaa-4bbb-8ccc-000000000001'
export const S2 = '22222222-aaaa-4bbb-8ccc-000000000002'
export const S3 = '33333333-aaaa-4bbb-8ccc-000000000003'
export const S4 = '44444444-aaaa-4bbb-8ccc-000000000004'
export const SUB1 = 'a1b2c3d4e5f6a7b81'
export const NESTED = 'c3d4e5f6a7b8c9d02'
export const TEAM = 'e5f6a7b8c9d0e1f23'
export const NOMETA = 'f6a7b8c9d0e1f2a34'
export const ORPHAN = '0a1b2c3d4e5f6a7b5'
export const PID_LIVE = 4242
export const PID_DEAD = 9999
export const CWD_DEMO = 'd:\\work\\demo'
export const CWD_OTHER = 'C:\\Users\\u\\other'
export const PROJ_DEMO = 'd--work-demo'
export const PROJ_OTHER = 'C--Users-u-other'

/** Single source of truth for per-message usage (deduped by message id). */
export const MSG_USAGE: Record<string, UsageSpec> = {
  msg_L1: usage(100, 50, 1000, 5000),
  msg_S1a: usage(10, 5),
  msg_S1b: usage(20, 10, 100, 200),
  msg_N1: usage(5, 5),
  msg_S1c: usage(30, 15),
  msg_L2: usage(200, 80, 0, 6000),
  msg_L3: usage(50, 20),
  msg_L4: usage(40, 10),
  msg_T1: usage(5, 5),
  msg_L5: usage(10, 5),
  msg_L6: usage(10, 5),
  msg_NM1: usage(1, 1),
  msg_OR1: usage(2, 2),
  msg_L7: usage(5, 5),
  msg_F1: usage(7, 3),
  msg_Y1: usage(1000, 1000), // yesterday (S3) - must not count today
  msg_D1: usage(11, 22, 33, 44),
  msg_C1: usage(3, 4)
}
const sum = (ids: string[]): UsageSpec =>
  ids.reduce<UsageSpec>(
    (a, id) => {
      const u = MSG_USAGE[id]!
      return { input: a.input + u.input, output: a.output + u.output, cacheCreation: a.cacheCreation + u.cacheCreation, cacheRead: a.cacheRead + u.cacheRead }
    },
    { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
  )
/** Headline = input + output + cacheCreation (user decision); cacheRead is separate. */
export const headline = (u: UsageSpec): number => u.input + u.output + u.cacheCreation

const LEAD_MSGS = ['msg_L1', 'msg_L2', 'msg_L3', 'msg_L4', 'msg_L5', 'msg_L6', 'msg_L7']
const SUB1_MSGS = ['msg_S1a', 'msg_S1b', 'msg_S1c']

export interface TranscriptTree {
  files: Record<string, string>
  /** Suggested mtimes: S1 newest, S2 30 min, S4 10 h, S3 3 days old (relative to NOW_MS). */
  mtimes: Record<string, number>
  paths: {
    s1: string; s2: string; s3: string; s4: string
    sub1: string; nested: string; team: string; nometa: string; orphan: string
    sub1Meta: string; nestedMeta: string; teamMeta: string; orphanMeta: string
    registryLive: string; registryDead: string; registryKey: string; acmeCredentials: string; defaultCredentials: string
    toolResults: string; prefix: string; memoryMd: string
    acmeProjects: string; defaultProjects: string; acmeSessions: string; defaultSessions: string
  }
  /** Parsed-object versions of each file, for tests that need single lines. */
  lines: { lead: Record<string, unknown>[]; sub1: Record<string, unknown>[]; nested: Record<string, unknown>[]; team: Record<string, unknown>[]; s3: Record<string, unknown>[] }
  expect: {
    parents: Record<string, string>              // agentId -> parentId (lead is 'lead')
    order: string[]                              // depth-first agent order
    leadTools: number; sub1Tools: number; teamTools: number
    tokens: { lead: UsageSpec; sub1: UsageSpec; nested: UsageSpec; team: UsageSpec }
    headline: { lead: number; sub1: number; nested: number; team: number }
    acmeTotals: UsageSpec                        // unique message ids across S1 + subs + S2 (fork)
    defaultTodayTotals: UsageSpec                // S3 (today only) + S4
    leadFiles: { path: string; added: number; removed: number; kind: 'create' | 'update' }[]
    sessionTitle: string
    s1Ids: string[]
  }
}

export function buildTranscriptTree(): TranscriptTree {
  resetBuilderIds()
  const o = (sec: number, extra: Record<string, unknown> = {}) => ({ ts: at(sec), ...extra })
  const sub = (id: string, sec: number, extra: Record<string, unknown> = {}) => ({ ts: at(sec), agentId: id, ...extra })
  const lu = (id: string) => MSG_USAGE[id]!

  // ---------- lead (S1 main file) ----------
  const lead: Record<string, unknown>[] = [
    aiTitle('Demo refactor'),
    userPrompt('Please refactor the parser', o(0, { parentUuid: null })),
    ...assistantBlocks(
      [
        thinkingBlock('plan the work'),
        textBlock('I will explore first.'),
        agentToolUse('toolu_lead_agent1', { description: 'Explore repo', prompt: 'List the files', subagent_type: 'Explore' })
      ],
      { ...o(5), messageId: 'msg_L1', stopReason: 'tool_use', usage: lu('msg_L1') }
    ),
    agentResult('toolu_lead_agent1', { agentId: SUB1, status: 'completed', text: 'Found 3 files', totalTokens: 300 }, o(14)),
    ...assistantBlocks(
      [toolUseBlock('toolu_lead_edit', 'Edit', { file_path: 'd:/work/demo/src/a.ts', old_string: 'a', new_string: 'b' })],
      { ...o(15), messageId: 'msg_L2', stopReason: 'tool_use', usage: lu('msg_L2') }
    ),
    editResult('toolu_lead_edit', 'd:/work/demo/src/a.ts', [' keep', '-old one', '-old two', '+new one', '+new two', '+new three'], o(16)),
    ...assistantBlocks(
      [toolUseBlock('toolu_lead_write', 'Write', { file_path: 'd:/work/demo/src/new.ts', content: 'a\nb\nc' })],
      { ...o(17), messageId: 'msg_L3', stopReason: 'tool_use', usage: lu('msg_L3') }
    ),
    writeCreateResult('toolu_lead_write', 'd:/work/demo/src/new.ts', 'a\nb\nc', o(18)),
    ...assistantBlocks(
      [agentToolUse('toolu_lead_agent3', { description: 'Review', name: 'reviewer', subagent_type: 'reviewer-type', run_in_background: true })],
      { ...o(19), messageId: 'msg_L4', stopReason: 'tool_use', usage: lu('msg_L4') }
    ),
    agentResult('toolu_lead_agent3', { agentId: TEAM, status: 'async_launched' }, o(20)),
    ...assistantBlocks(
      [sendMessageUse('toolu_lead_send', { to: 'reviewer', message: 'Please check the diff', summary: 'check diff' })],
      { ...o(24), messageId: 'msg_L5', stopReason: 'tool_use', usage: lu('msg_L5') }
    ),
    toolResult('toolu_lead_send', 'sent', { ...o(25), toolUseResult: { success: true, message: 'sent' } }),
    ...assistantBlocks(
      [toolUseBlock('toolu_lead_bash', 'Bash', { command: 'npm test\nsecond line' })],
      { ...o(26), messageId: 'msg_L6', stopReason: 'tool_use', usage: lu('msg_L6') }
    ),
    errorResult('toolu_lead_bash', 'Error: exit code 1\nmore detail', o(27)),
    bookkeepingLine('queue-operation'),
    customTitle('Renamed demo'),
    ...assistantBlocks([askUserQuestionUse('toolu_lead_ask', 'Which option?')], {
      ...o(40),
      messageId: 'msg_L7',
      stopReason: 'tool_use',
      usage: lu('msg_L7')
    })
  ]

  // ---------- SUB1 ----------
  const sub1: Record<string, unknown>[] = [
    userPrompt('List the files', sub(SUB1, 6, { parentUuid: null })),
    ...assistantBlocks([toolUseBlock('toolu_s1_read', 'Read', { file_path: 'd:/work/demo/src/a.ts' })], {
      ...sub(SUB1, 7), messageId: 'msg_S1a', model: 'claude-test-haiku', stopReason: 'tool_use', usage: lu('msg_S1a')
    }),
    toolResult('toolu_s1_read', 'file body', sub(SUB1, 8)),
    ...assistantBlocks([agentToolUse('toolu_s1_agent2', { description: 'Nested look' })], {
      ...sub(SUB1, 9), messageId: 'msg_S1b', model: 'claude-test-haiku', stopReason: 'tool_use', usage: lu('msg_S1b')
    }),
    agentResult('toolu_s1_agent2', { agentId: NESTED, status: 'completed', text: 'nested done' }, sub(SUB1, 12)),
    ...assistantBlocks([textBlock('Found 3 files')], {
      ...sub(SUB1, 13), messageId: 'msg_S1c', model: 'claude-test-haiku', stopReason: 'end_turn', usage: lu('msg_S1c')
    })
  ]
  const nested: Record<string, unknown>[] = [
    userPrompt('Look at the nested thing', sub(NESTED, 10, { parentUuid: null })),
    ...assistantBlocks([textBlock('nested done')], { ...sub(NESTED, 11), messageId: 'msg_N1', stopReason: 'end_turn', usage: lu('msg_N1') })
  ]
  const team: Record<string, unknown>[] = [
    userPrompt('Review the diff', sub(TEAM, 21, { parentUuid: null })),
    ...assistantBlocks(
      [sendMessageUse('toolu_t_send', { to: 'team-lead', message: 'LGTM', summary: 'ok' })],
      { ...sub(TEAM, 22), messageId: 'msg_T1', stopReason: 'tool_use', usage: lu('msg_T1') }
    ),
    toolResult('toolu_t_send', 'sent', { ...sub(TEAM, 23), toolUseResult: { success: true, message: 'sent' } })
  ]
  const nometa: Record<string, unknown>[] = [
    userPrompt('No meta task', sub(NOMETA, 28, { parentUuid: null })),
    ...assistantBlocks([textBlock('done without meta')], { ...sub(NOMETA, 29), messageId: 'msg_NM1', stopReason: 'end_turn', usage: lu('msg_NM1') })
  ]
  const orphan: Record<string, unknown>[] = [
    userPrompt('Orphan task', sub(ORPHAN, 30, { parentUuid: null })),
    ...assistantBlocks([textBlock('orphan done')], { ...sub(ORPHAN, 31), messageId: 'msg_OR1', stopReason: 'end_turn', usage: lu('msg_OR1') })
  ]

  // ---------- S2: fork copy of S1's first lines (SAME uuids and message ids) + one new message ----------
  const forkCopy = lead.slice(1, 5) // prompt + the 3 blocks of msg_L1 (index 0 is the ai-title)
  const s2Lines: Record<string, unknown>[] = [
    aiTitle('Forked demo', S2),
    ...forkCopy,
    ...assistantBlocks([textBlock('fork continues')], { ...o(50), sessionId: S2, messageId: 'msg_F1', stopReason: 'end_turn', usage: lu('msg_F1') })
  ]

  // ---------- S3: default account; two local (UTC) days, malformed, multibyte, API error ----------
  const YDAY = '2026-11-17T23:30:00.000Z'
  const TODAY = '2026-11-18T00:30:00.000Z'
  const s3: Record<string, unknown>[] = [
    userPrompt('héllo 日本語 😀', { ts: YDAY, sessionId: S3, cwd: CWD_OTHER, parentUuid: null }),
    ...assistantBlocks([textBlock('yesterday answer')], { ts: YDAY, sessionId: S3, cwd: CWD_OTHER, messageId: 'msg_Y1', stopReason: 'end_turn', usage: lu('msg_Y1') }),
    userPrompt('second day', { ts: TODAY, sessionId: S3, cwd: CWD_OTHER }),
    ...assistantBlocks([thinkingBlock('hm'), textBlock('multibyte ✓ 日本語 answer')], {
      ts: '2026-11-18T00:31:00.000Z', sessionId: S3, cwd: CWD_OTHER, messageId: 'msg_D1', stopReason: 'end_turn', usage: lu('msg_D1')
    }),
    apiErrorLine('rate_limit', { ts: '2026-11-18T00:32:00.000Z', sessionId: S3, cwd: CWD_OTHER })
  ]
  const s3Text = jsonl([s3[0], s3[1], '{"type":"assistant","uuid":"cut-off-line', 'this is not json at all', ...s3.slice(2)])

  // ---------- S4: CRLF line endings ----------
  const s4: Record<string, unknown>[] = [
    userPrompt('crlf prompt', { ts: at(0), sessionId: S4, cwd: CWD_OTHER, parentUuid: null }),
    ...assistantBlocks([textBlock('crlf answer')], { ts: at(1), sessionId: S4, cwd: CWD_OTHER, messageId: 'msg_C1', stopReason: 'end_turn', usage: lu('msg_C1') })
  ]

  // ---------- paths ----------
  const acmeProjects = `${ACME_DIR}/projects`
  const defaultProjects = `${DEFAULT_DIR}/projects`
  const dir1 = `${acmeProjects}/${PROJ_DEMO}`
  const subDir = `${dir1}/${S1}/subagents`
  const paths = {
    s1: `${dir1}/${S1}.jsonl`,
    s2: `${dir1}/${S2}.jsonl`,
    s3: `${defaultProjects}/${PROJ_OTHER}/${S3}.jsonl`,
    s4: `${defaultProjects}/${PROJ_OTHER}/${S4}.jsonl`,
    sub1: `${subDir}/agent-${SUB1}.jsonl`,
    nested: `${subDir}/agent-${NESTED}.jsonl`,
    team: `${subDir}/agent-${TEAM}.jsonl`,
    nometa: `${subDir}/agent-${NOMETA}.jsonl`,
    orphan: `${subDir}/agent-${ORPHAN}.jsonl`,
    sub1Meta: `${subDir}/agent-${SUB1}.meta.json`,
    nestedMeta: `${subDir}/agent-${NESTED}.meta.json`,
    teamMeta: `${subDir}/agent-${TEAM}.meta.json`,
    orphanMeta: `${subDir}/agent-${ORPHAN}.meta.json`,
    registryLive: `${ACME_DIR}/sessions/${PID_LIVE}.json`,
    registryDead: `${ACME_DIR}/sessions/${PID_DEAD}.json`,
    registryKey: `${ACME_DIR}/sessions/${PID_LIVE}.deadbeef.key`,
    acmeCredentials: `${ACME_DIR}/${CREDENTIALS_BASENAME}`,
    defaultCredentials: `${DEFAULT_DIR}/${CREDENTIALS_BASENAME}`,
    toolResults: `${dir1}/${S1}/tool-results/out-1.txt`,
    prefix: `${subDir}/agent-${SUB1}.prefix.json`,
    memoryMd: `${dir1}/memory/MEMORY.md`,
    acmeProjects,
    defaultProjects,
    acmeSessions: `${ACME_DIR}/sessions`,
    defaultSessions: `${DEFAULT_DIR}/sessions`
  }

  const files: Record<string, string> = {
    [paths.s1]: jsonl(lead),
    [paths.s2]: jsonl(s2Lines),
    [paths.s3]: s3Text,
    [paths.s4]: jsonl(s4, { eol: '\r\n' }),
    [paths.sub1]: jsonl(sub1),
    [paths.nested]: jsonl(nested),
    [paths.team]: jsonl(team),
    [paths.nometa]: jsonl(nometa),
    [paths.orphan]: jsonl(orphan),
    [paths.sub1Meta]: JSON.stringify(subMeta({ model: 'claude-test-haiku', finished: true })),
    [paths.nestedMeta]: JSON.stringify(subMeta({ agentType: 'general-purpose', description: 'Nested look', toolUseId: 'toolu_s1_agent2', spawnDepth: 2 })),
    [paths.teamMeta]: JSON.stringify(
      subMeta({ agentType: 'reviewer-type', description: 'Review', toolUseId: 'toolu_lead_agent3', name: 'reviewer', requestShape: 'background' })
    ),
    [paths.orphanMeta]: JSON.stringify(subMeta({ agentType: 'Plan', description: 'Orphan', toolUseId: 'toolu_missing_xyz' })),
    [paths.prefix]: '{"note":"ignored prefix"}',
    [paths.toolResults]: 'ignored tool output',
    [paths.memoryMd]: '# fake memory\n',
    [paths.registryLive]: JSON.stringify(
      registryEntry({ status: 'waiting', waitingFor: 'dialog open', statusUpdatedAt: T0_MS + 40_000 })
    ),
    [paths.registryDead]: JSON.stringify(registryEntry({ pid: PID_DEAD, sessionId: S2, status: 'busy' })),
    [paths.registryKey]: fakeKeyFile(),
    [paths.acmeCredentials]: FAKE_CREDENTIALS_CONTENT,
    [paths.defaultCredentials]: FAKE_CREDENTIALS_CONTENT
  }
  void agentNameLine // exported by builders; used in unit tests, not needed in the tree

  const mtimes: Record<string, number> = {}
  for (const p of [paths.s1, paths.sub1, paths.nested, paths.team, paths.nometa, paths.orphan, paths.sub1Meta, paths.nestedMeta, paths.teamMeta, paths.orphanMeta])
    mtimes[p] = NOW_MS - 60_000
  mtimes[paths.s2] = NOW_MS - 30 * 60_000
  mtimes[paths.s4] = NOW_MS - 10 * 3_600_000
  mtimes[paths.s3] = NOW_MS - 3 * 86_400_000

  return {
    files,
    mtimes,
    paths,
    lines: { lead, sub1, nested, team, s3: s3 },
    expect: {
      parents: { [SUB1]: 'lead', [NESTED]: SUB1, [TEAM]: 'lead', [NOMETA]: 'lead', [ORPHAN]: 'lead' },
      order: ['lead', SUB1, NESTED, TEAM, NOMETA, ORPHAN],
      leadTools: 7,
      sub1Tools: 2,
      teamTools: 1,
      tokens: { lead: sum(LEAD_MSGS), sub1: sum(SUB1_MSGS), nested: sum(['msg_N1']), team: sum(['msg_T1']) },
      headline: {
        lead: headline(sum(LEAD_MSGS)),
        sub1: headline(sum(SUB1_MSGS)),
        nested: headline(sum(['msg_N1'])),
        team: headline(sum(['msg_T1']))
      },
      acmeTotals: sum([...LEAD_MSGS, ...SUB1_MSGS, 'msg_N1', 'msg_T1', 'msg_NM1', 'msg_OR1', 'msg_F1']),
      defaultTodayTotals: sum(['msg_D1', 'msg_C1']),
      leadFiles: [
        { path: 'd:/work/demo/src/a.ts', added: 3, removed: 2, kind: 'update' },
        { path: 'd:/work/demo/src/new.ts', added: 3, removed: 0, kind: 'create' }
      ],
      sessionTitle: 'Renamed demo',
      s1Ids: [S1]
    }
  }
}

/** Convenience: the "ok" mini result used by a few tests that only need a bash call/result pair. */
export const bashPair = (id: string, cmd: string, out: string, sec: number): Record<string, unknown>[] => [
  ...assistantBlocks([toolUseBlock(id, 'Bash', { command: cmd })], { ts: at(sec), messageId: `msg_${id}`, stopReason: 'tool_use', usage: usage(1, 1) }),
  bashResult(id, out, { ts: at(sec + 1) })
]
