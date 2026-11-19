import type {
  ActivityKind,
  Agent,
  AgentEvent,
  ConsoleLine,
  FileOverlap,
  SharedTask,
  TeamSnapshot,
  Worktree
} from '../types'

type SegTuple = [ActivityKind, number, number]
type EventTuple = [string, string, string, string]
type FileTuple = [string, number, number]
type MsgTuple = [string, string, string]

interface AgentSource {
  id: string
  name: string
  initials: string
  avatar: string
  role: string
  model: string
  tool: string
  target: string
  wt: string
  elapsedSec: number
  tokens: number
  calls: number
  task: string
  segs: SegTuple[]
  events: EventTuple[]
  files: FileTuple[]
  msgs: MsgTuple[]
}

const agentSources: AgentSource[] = [
  { id: 'lead', name: 'lead', initials: 'LD', avatar: '#F2A541', role: 'Team lead · orchestrator', model: 'Opus', tool: 'SendMessage', target: '→ test-writer  "Rebase on feat/api-schema"', wt: 'main', elapsedSec: 1122, tokens: 412000, calls: 37, task: 'Coordinate sheet-export feature across 5 teammates',
    segs: [['think',0,8],['bash',8,4],['think',12,10],['read',22,6],['think',28,30],['think',62,20],['think',86,14]],
    events: [['10:43:51','SendMessage','→ test-writer','"Rebase on feat/api-schema before re-running tests"'],['10:43:20','TaskUpdate','#5 → blocked','Integration tests failing (2)'],['10:41:02','Read','docs/PLAN.md','214 lines'],['10:24:10','Spawn','test-writer','worktree feat/tests'],['10:24:02','Spawn','api-designer, backend-impl, ui-builder','3 worktrees created']],
    files: [['docs/PLAN.md',24,3]],
    msgs: [['from api-designer','10:42','SheetDto v2 ready. Breaking change: SheetNumber is now string. Please review.'],['to ui-builder','10:31','Hold the sheet panel until task #2 lands.']] },
  { id: 'api', name: 'api-designer', initials: 'AD', avatar: '#8FB4FF', role: 'API contract', model: 'Sonnet', tool: 'Edit', target: 'src/Api/SheetDto.cs  L120–184', wt: 'feat/api-schema', elapsedSec: 1160, tokens: 186000, calls: 22, task: '#2 Schema v2 for SheetDto',
    segs: [['read',0,10],['think',10,6],['edit',16,12],['think',28,5],['bash',33,6],['edit',39,20],['think',59,8],['edit',67,33]],
    events: [['10:44:02','Edit','src/Api/SheetDto.cs','+38 −12 · in progress'],['10:42:15','SendMessage','→ lead','Schema v2 ready for review'],['10:38:40','Bash','dotnet build','Build succeeded · 0 warnings'],['10:33:12','Edit','src/Api/ViewportDto.cs','+14 −2'],['10:25:00','Grep','"SheetNumber" in src/','17 matches in 6 files']],
    files: [['src/Api/SheetDto.cs',38,12],['src/Api/ViewportDto.cs',14,2],['src/Api/Contracts.md',22,0]],
    msgs: [['to lead','10:42','SheetDto v2 ready. Breaking change: SheetNumber is now string.']] },
  { id: 'be', name: 'backend-impl', initials: 'BE', avatar: '#C49BFF', role: 'Server + Revit export', model: 'Sonnet', tool: 'Bash', target: 'dotnet test --filter "Category=Export"', wt: 'feat/backend-auth', elapsedSec: 1025, tokens: 241000, calls: 31, task: '#3 Export endpoints',
    segs: [['read',4,8],['edit',12,14],['bash',26,6],['edit',32,18],['bash',50,8],['think',58,6],['edit',64,22],['bash',86,14]],
    events: [['10:44:10','Bash','dotnet test --filter "Category=Export"','Running · 31 / 48'],['10:41:30','Edit','src/Services/SheetExportService.cs','+96 −20'],['10:37:05','Bash','dotnet build','Build succeeded'],['10:32:44','Edit','src/Commands/ExportSheetsCommand.cs','+41 −8'],['10:28:01','Read','src/Services/ExcelWriter.cs','310 lines']],
    files: [['src/Services/SheetExportService.cs',96,20],['src/Commands/ExportSheetsCommand.cs',41,8],['tests/ExportTests.cs',60,0]],
    msgs: [['to lead','10:36','Export endpoints compile against SheetDto v1; will switch once #2 lands.']] },
  { id: 'ui', name: 'ui-builder', initials: 'UI', avatar: '#5ED3A8', role: 'WPF sheet panel', model: 'Sonnet', tool: 'Wait', target: 'blocked by task #2 (api-designer)', wt: 'feat/ui-panel', elapsedSec: 372, tokens: 58000, calls: 9, task: '#4 Sheet panel UI',
    segs: [['read',0,8],['think',8,6],['edit',14,10],['wait',24,76]],
    events: [['10:31:20','Wait','task #2','Blocked by lead instruction'],['10:30:02','Edit','src/UI/SheetPanel.xaml','+120 −0'],['10:27:40','Read','src/UI/Styles.xaml','88 lines']],
    files: [['src/UI/SheetPanel.xaml',120,0]],
    msgs: [['from lead','10:31','Hold the sheet panel until task #2 lands.']] },
  { id: 'test', name: 'test-writer', initials: 'TW', avatar: '#FF8A8A', role: 'Integration tests', model: 'Haiku', tool: 'Fail', target: 'dotnet test exited 1 · 2 of 48 failed', wt: 'feat/tests', elapsedSec: 1201, tokens: 97000, calls: 26, task: '#5 Integration tests',
    segs: [['read',0,12],['edit',12,20],['bash',32,8],['edit',40,16],['bash',56,10],['think',66,10],['bash',76,16],['error',92,8]],
    events: [['10:43:18','Bash','dotnet test','FAIL · SheetDto_RoundTrip, Export_ToExcel'],['10:40:55','Edit','src/Api/SheetDto.cs','+4 −1 · overlaps api-designer'],['10:36:30','Edit','tests/SheetDtoTests.cs','+72 −0'],['10:29:10','Bash','dotnet test','46 passed']],
    files: [['tests/SheetDtoTests.cs',72,0],['src/Api/SheetDto.cs',4,1]],
    msgs: [['from lead','10:43','Rebase on feat/api-schema before re-running tests.']] },
  { id: 'rev', name: 'reviewer', initials: 'RV', avatar: '#A9B4C6', role: 'Code review (read-only)', model: 'Opus', tool: 'Done', target: '3 comments on feat/api-schema', wt: 'main', elapsedSec: 520, tokens: 131000, calls: 18, task: '#6 Review API contract',
    segs: [['read',30,24],['think',54,12],['read',66,8]],
    events: [['10:38:55','SendMessage','→ api-designer','3 review comments'],['10:34:10','Read','git diff main...feat/api-schema','5 files'],['10:30:00','Spawn','reviewer','by lead']],
    files: [],
    msgs: [['to api-designer','10:38','SheetNumber as string is fine; add a migration note for existing JSON exports.']] }
]

const agents: Agent[] = agentSources.map((s) => ({
  id: s.id,
  name: s.name,
  initials: s.initials,
  avatarColor: s.avatar,
  role: s.role,
  model: s.model,
  worktree: s.wt,
  taskTitle: s.task,
  current: { tool: s.tool, target: s.target },
  elapsedSec: s.elapsedSec,
  tokens: s.tokens,
  toolCalls: s.calls,
  timeline: s.segs.map(([kind, l, w]) => ({ kind, startPct: l, widthPct: w })),
  activity: s.events.map(([time, tool, target, result]) => {
    const item = { time, tool, target, result }
    return result.startsWith('FAIL') ? { ...item, failed: true } : item
  }),
  files: s.files.map(([path, added, removed]) => ({ path, added, removed })),
  messages: s.msgs.map(([who, time, text]) => {
    const direction: 'in' | 'out' = who.startsWith('from ') ? 'in' : 'out'
    return { direction, peer: who.replace(/^(from|to) /, ''), time, text }
  })
}))

const SESSION_ID = 'sess-sheet-export'
const iso = (hms: string): string => `2026-11-19T${hms}.000Z`

function make(agentId: string, hms: string, kind: AgentEvent['kind'], extra: Partial<AgentEvent> = {}): AgentEvent {
  const src = agentSources.find((s) => s.id === agentId)!
  const teammate = agentId !== 'lead'
  return {
    ts: iso(hms),
    sessionId: SESSION_ID,
    agentId,
    ...(teammate ? { parentAgentId: 'lead', worktree: src.wt } : {}),
    kind,
    accountId: 'company',
    ...extra
  }
}

/** A completed tool call: tool_start at `start`, tool_end at `end`. */
function call(
  agentId: string,
  start: string,
  end: string,
  tool: string,
  target: string,
  result: string,
  tokens?: { input: number; output: number }
): AgentEvent[] {
  return [
    make(agentId, start, 'tool_start', { tool, target }),
    make(agentId, end, 'tool_end', { tool, target, result, ...(tokens ? { tokens } : {}) })
  ]
}

const events: AgentEvent[] = [
  // lead: ends with an open SendMessage
  make('lead', '10:24:02', 'spawn', { target: 'api-designer, backend-impl, ui-builder' }),
  make('lead', '10:24:10', 'spawn', { target: 'test-writer' }),
  ...call('lead', '10:41:01', '10:41:02', 'Read', 'docs/PLAN.md', '214 lines', { input: 5200, output: 300 }),
  ...call('lead', '10:43:19', '10:43:20', 'TaskUpdate', '#5 → blocked', 'Integration tests failing (2)'),
  make('lead', '10:43:51', 'tool_start', { tool: 'SendMessage', target: '→ test-writer' }),
  // api: ends with an open Edit
  make('api', '10:24:20', 'spawn', { target: 'api-designer' }),
  ...call('api', '10:24:58', '10:25:00', 'Grep', '"SheetNumber" in src/', '17 matches in 6 files'),
  ...call('api', '10:33:10', '10:33:12', 'Edit', 'src/Api/ViewportDto.cs', '+14 −2', { input: 3100, output: 900 }),
  ...call('api', '10:38:30', '10:38:40', 'Bash', 'dotnet build', 'Build succeeded · 0 warnings'),
  ...call('api', '10:42:14', '10:42:15', 'SendMessage', '→ lead', 'Schema v2 ready for review'),
  make('api', '10:44:02', 'tool_start', { tool: 'Edit', target: 'src/Api/SheetDto.cs' }),
  // be: ends with an open Bash
  make('be', '10:24:25', 'spawn', { target: 'backend-impl' }),
  ...call('be', '10:27:59', '10:28:01', 'Read', 'src/Services/ExcelWriter.cs', '310 lines'),
  ...call('be', '10:32:40', '10:32:44', 'Edit', 'src/Commands/ExportSheetsCommand.cs', '+41 −8', { input: 4200, output: 1500 }),
  ...call('be', '10:36:50', '10:37:05', 'Bash', 'dotnet build', 'Build succeeded'),
  ...call('be', '10:41:25', '10:41:30', 'Edit', 'src/Services/SheetExportService.cs', '+96 −20', { input: 6000, output: 2400 }),
  make('be', '10:44:10', 'tool_start', { tool: 'Bash', target: 'dotnet test --filter "Category=Export"' }),
  // ui: blocked
  make('ui', '10:25:05', 'spawn', { target: 'ui-builder' }),
  ...call('ui', '10:27:38', '10:27:40', 'Read', 'src/UI/Styles.xaml', '88 lines'),
  ...call('ui', '10:29:55', '10:30:02', 'Edit', 'src/UI/SheetPanel.xaml', '+120 −0', { input: 2800, output: 1100 }),
  make('ui', '10:31:20', 'status', { result: 'blocked', target: 'task #2' }),
  // test: ends with an error
  make('test', '10:25:10', 'spawn', { target: 'test-writer' }),
  ...call('test', '10:29:00', '10:29:10', 'Bash', 'dotnet test', '46 passed'),
  ...call('test', '10:36:25', '10:36:30', 'Edit', 'tests/SheetDtoTests.cs', '+72 −0', { input: 3500, output: 1200 }),
  ...call('test', '10:40:50', '10:40:55', 'Edit', 'src/Api/SheetDto.cs', '+4 −1'),
  make('test', '10:43:05', 'tool_start', { tool: 'Bash', target: 'dotnet test' }),
  make('test', '10:43:17', 'tool_end', { tool: 'Bash', target: 'dotnet test', result: 'FAIL · SheetDto_RoundTrip, Export_ToExcel' }),
  make('test', '10:43:18', 'error', { result: 'dotnet test exited 1 · 2 of 48 failed' }),
  // rev: done
  make('rev', '10:30:00', 'spawn', { target: 'reviewer' }),
  ...call('rev', '10:34:08', '10:34:10', 'Read', 'git diff main...feat/api-schema', '5 files', { input: 7800, output: 600 }),
  ...call('rev', '10:38:54', '10:38:55', 'SendMessage', '→ api-designer', '3 review comments'),
  make('rev', '10:38:56', 'stop')
]

const worktrees: Worktree[] = [
  { branch: 'main', path: '~/repos/sheet-automation', agentIds: ['lead', 'rev'], changedFiles: 0, ahead: 0 },
  { branch: 'feat/api-schema', path: '.worktrees/api-schema', agentIds: ['api'], changedFiles: 3, ahead: 2 },
  { branch: 'feat/backend-auth', path: '.worktrees/backend', agentIds: ['be'], changedFiles: 3, ahead: 4 },
  { branch: 'feat/ui-panel', path: '.worktrees/ui-panel', agentIds: ['ui'], changedFiles: 1, ahead: 1 },
  { branch: 'feat/tests', path: '.worktrees/tests', agentIds: ['test'], changedFiles: 2, ahead: 0, overlapsWith: ['feat/api-schema'] }
]

const tasks: SharedTask[] = [
  { id: 1, title: 'Define API contract', state: 'done', ownerAgentId: 'api' },
  { id: 2, title: 'Schema v2 for SheetDto', state: 'in_progress', ownerAgentId: 'api' },
  { id: 3, title: 'Export endpoints', state: 'in_progress', ownerAgentId: 'be' },
  { id: 4, title: 'Sheet panel UI', state: 'blocked', ownerAgentId: 'ui', blockedBy: 2 },
  { id: 5, title: 'Integration tests', state: 'failing', ownerAgentId: 'test', failingCount: 2 },
  { id: 6, title: 'Review API contract', state: 'done', ownerAgentId: 'rev' }
]

const overlaps: FileOverlap[] = [
  { path: 'src/Api/SheetDto.cs', agentIds: ['api', 'test'], worktrees: ['feat/api-schema', 'feat/tests'] }
]

const consoleLines: ConsoleLine[] = [
  { time: '10:24:00', who: 'you', text: 'Split sheet-export into API, backend, UI, tests + a reviewer. One worktree each.' },
  { time: '10:24:02', who: 'lead', text: 'Created team "sheet-export", 4 worktrees, 6 tasks' },
  { time: '10:38:55', who: 'rev', text: 'Review done → 3 comments for api-designer' },
  { time: '10:42:15', who: 'api', text: 'SheetDto v2 ready (breaking: SheetNumber → string)' },
  { time: '10:43:18', who: 'test', text: 'dotnet test FAILED: SheetDto_RoundTrip, Export_ToExcel' },
  { time: '10:43:51', who: 'lead', text: 'Asked test-writer to rebase on feat/api-schema, task #5 marked blocked' },
  { time: '10:44:10', who: 'be', text: 'Running export tests (31/48)…' }
]

export const mockTeamSnapshot: TeamSnapshot = {
  repo: 'acme/sheet-automation',
  teamName: 'sheet-export',
  accountId: 'company',
  now: '2026-11-19T10:44:20.000Z',
  agents,
  events,
  worktrees,
  tasks,
  overlaps,
  console: consoleLines,
  timelineTicks: ['10:24', '10:29', '10:34', '10:39', 'now']
}
