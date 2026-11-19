# T02 - Shared domain: mock data, derived status, formatting

- Wave: 2
- Depends on: T01
- Spec refs: R-04, R-05, R-17
- Tests: tests/shared/status.test.ts, tests/shared/format.test.ts, tests/shared/mock.test.ts

## Goal
Pure-TypeScript shared modules used by both main and renderer:
- `deriveAgentStatus()`, which implements the spec's derived-status rules.
- Formatting helpers for tokens and elapsed time.
- The Phase 1 mock data, a TeamSnapshot and an AccountsSnapshot that reproduce both mockups exactly.

## Owned files
- create: src/shared/status.ts
- create: src/shared/format.ts
- create: src/shared/mock/team.ts
- create: src/shared/mock/accounts.ts
- create: src/shared/mock/index.ts
- create: tests/shared/status.test.ts, tests/shared/format.test.ts, tests/shared/mock.test.ts

## Read-only context
- src/shared/types.ts (from T01; do not modify)
- docs/spec.md, sections "Normalized event (shared type)" and "Accounts"
- docs/design/team-view.mockup.html lines 618-717 (all team mock data: ST, TOOL, SEG, agents, worktrees, tasks, log)
- docs/design/accounts.mockup.html lines 589-664 (detected logins, steps, accounts, limit options, rules, sessions)

## Notes
No DOM, Node or Electron imports. Import types from `@shared/types` (or relative paths).

### status.ts
```ts
export const RECENT_ACTIVITY_MS = 60_000;
export const WAITING_SIGNALS = ['blocked', 'idle', 'waiting'] as const;
export const NEEDS_YOU_SIGNALS = ['permission', 'notification'] as const;
export function eventsForAgent(events: AgentEvent[], agentId: string): AgentEvent[];  // sorted by ts asc
export function hasOpenTool(events: AgentEvent[]): boolean;   // a tool_start without a later tool_end of the same tool
export function deriveAgentStatus(events: AgentEvent[], agentId: string, now: Date | number | string, opts?: { recentMs?: number }): AgentStatus;
export function deriveAllStatuses(snapshot: TeamSnapshot): Record<string, AgentStatus>;  // uses snapshot.now
```
Rules, applied in this order to the agent's events sorted by `ts` (ASSUMPTION, recorded in plan.md):
1. No events: `waiting`.
2. Last event kind `stop`: `done`.
3. Last event kind `error`, or kind `status` with `result` in NEEDS_YOU_SIGNALS: `needs-you`.
4. `hasOpenTool`: `running`. Match tool_start and tool_end FIFO by `tool` name.
5. Last event kind `status` with `result` in WAITING_SIGNALS: `waiting`.
6. `now - last.ts <= recentMs`: `running`.
7. Otherwise: `waiting`.

Accept unsorted input and do not mutate it.

### format.ts
```ts
export function formatTokens(n: number): string;      // 412000 -> '412k', 58000 -> '58k', 1125000 -> '1.12M', 950 -> '950'
export function formatElapsed(sec: number): string;   // 1122 -> '18m 42s', 1160 -> '19m 20s', 372 -> '6m 12s', 3725 -> '1h 02m'
export function sumTokens(agents: Agent[]): number;
export function teamCounters(snapshot: TeamSnapshot): { agents: number; running: number; needsYou: number; tokens: number };
```
- For values of 1e6 and above, use 2 decimals with trailing zeros trimmed. For values of 1e3 and above, round to an integer k.
- `teamCounters` uses `deriveAllStatuses`.

### mock/team.ts: `export const mockTeamSnapshot: TeamSnapshot`
- repo `hicas/sheet-automation`, teamName `sheet-export`, accountId `company`, now `2026-11-19T10:44:20.000Z`.
- `timelineTicks`: ['10:24', '10:29', '10:34', '10:39', 'now'].
- agents: the 6 agents from mockup lines 629-658, in that order, with ids lead, api, be, ui, test, rev. Copy name, initials, avatar color (as avatarColor), role, model, `wt` (as worktree), task (as taskTitle), tool and target (as current), segs, events, files and msgs verbatim.
  - Elapsed in seconds: '18m 42s' is 1122.
  - Tokens: '412k' is 412000.
  - segs `[kind, l, w]` become `{kind, startPct: l, widthPct: w}`.
  - events `[t, tool, target, result]` become ActivityItem. Set `failed: true` when the result starts with 'FAIL'.
  - files `[p, a, d]` become ChangedFile.
  - msgs `['from X' | 'to X', t, text]` become `{direction: 'in' | 'out', peer: 'X', time, text}`.
  - The reviewer's current tool is `Done`.
- events (AgentEvent[], accountId 'company', sessionId 'sess-sheet-export'). Each agent gets a spawn event, a few tool events matching its activity, and a final state such that `deriveAllStatuses` yields exactly:
  - lead running: open `tool_start` SendMessage at 10:43:51.
  - api running: open `tool_start` Edit `src/Api/SheetDto.cs` at 10:44:02.
  - be running: open `tool_start` Bash at 10:44:10.
  - ui waiting: last event `status` with result 'blocked' at 10:31:20.
  - test needs-you: `tool_end` Bash then `error` at 10:43:18, with result 'dotnet test exited 1 · 2 of 48 failed'.
  - rev done: `stop` at 10:38:56.
  - Set `parentAgentId: 'lead'` for teammates and `worktree` to the branch.
  - Include `tokens` on some tool_end events. They do not need to sum to the card values.
- worktrees (mockup 693-699):
  - main `~/repos/sheet-automation`, [lead, rev], 0 files, ahead 0.
  - feat/api-schema `.worktrees/api-schema`, [api], 3 files, ahead 2.
  - feat/backend-auth `.worktrees/backend`, [be], 3 files, ahead 4.
  - feat/ui-panel `.worktrees/ui-panel`, [ui], 1 file, ahead 1.
  - feat/tests `.worktrees/tests`, [test], 2 files, ahead 0, overlapsWith ['feat/api-schema'].
- tasks (700-707):
  - 1 'Define API contract', done, api.
  - 2 'Schema v2 for SheetDto', in_progress, api.
  - 3 'Export endpoints', in_progress, be.
  - 4 'Sheet panel UI', blocked, ui, blockedBy 2.
  - 5 'Integration tests', failing, test, failingCount 2.
  - 6 'Review API contract', done, rev.
  - Titles do NOT include '#n'. The UI prefixes `#${id}`.
- overlaps: `[{ path: 'src/Api/SheetDto.cs', agentIds: ['api', 'test'], worktrees: ['feat/api-schema', 'feat/tests'] }]`.
- console: the 7 lines from mockup 709-715. `who` is 'you' or an agent id (lead, rev, api, test, lead, be), and the text is verbatim.

### mock/accounts.ts: `export const mockAccountsSnapshot: AccountsSnapshot`
- accounts:
  - company: name 'Company', color '#6E9BF0', configDir '~/.claude', email 'you@company.com', plan undefined, signedIn false, tokensToday 1125000, folderRules [rule 1].
  - personal: name 'Personal', color '#F2A541', configDir '~/.claude-personal', email 'you@gmail.com', plan undefined, signedIn false, tokensToday undefined, folderRules [rule 2].
  - SPEC GAP: the mockup's usage % bars are intentionally not mocked.
- defaultAccountId 'company'. activeAccountId 'company'.
- detected:
  - `{configDir: '~/.claude', email: 'you@company.com', org: '[COMPANY ORG]', sources: ['VS Code extension', 'Claude Code CLI (default folder)'], signedIn: true, suggestedAccountId: 'company'}`. Not linked yet, so the UI shows "Use this".
  - `{configDir: '~/.claude-personal', sources: ['.vscode/settings.json in ~/code/personal/revit-playground'], signedIn: false, suggestedAccountId: 'personal'}`.
- rules:
  - `~/work/hicas/**` maps to company, note 'All company repos'.
  - `~/code/personal/**` maps to personal, note 'Side projects'.
  - `anything else` maps to 'ask', note 'Prompt when opening a new folder'.
- safety: all true. limitPolicy 'pause'.
- sessions:
  - sheet-export, `~/work/hicas/sheet-automation`, company, 6.
  - scratch, `~/code/personal/revit-playground`, personal, 1.

### mock/index.ts
Re-export `mockTeamSnapshot`, `mockAccountsSnapshot`, and `MOCK_SIGNED_IN_EMAIL = 'you@gmail.com'` (shown after the mock sign-in completes).

### Tests
- status.test.ts: one test per rule (1-7). Also test ordering: an error followed by a new tool_start means running; a stop beats an open tool. Check that unsorted input works and that input is not mutated.
- format.test.ts: the examples above.
- mock.test.ts:
  - Agent ids are unique.
  - Every worktree agentId exists.
  - Every task ownerAgentId exists.
  - Every overlap agentId exists.
  - Every event agentId exists.
  - `deriveAllStatuses(mockTeamSnapshot)` equals `{lead: running, api: running, be: running, ui: waiting, test: needs-you, rev: done}`.
  - `teamCounters` gives `{agents: 6, running: 3, needsYou: 1}`, and `formatTokens(tokens) === '1.12M'`.
  - Timeline segments are within 0-100.
  - Accounts: the default account exists and every rule accountId is an account id or 'ask'.

## Acceptance commands
- npm test -- tests/shared
- npm run typecheck

## Done when
- All acceptance commands pass.
- Only owned files changed.
