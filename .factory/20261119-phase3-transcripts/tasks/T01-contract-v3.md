# T01 - Contract v3: live team types, transcript/usage IPC, preload, handler stubs

- Wave: 1
- Depends on: none
- Spec refs: R-01; plan Verified facts 8, 11, 15
- Tests: tests/shared/ipcContract.test.ts

## Goal
This task is the single owner of every shared contract file for Phase 3. It adds the live-team types (optional
fields, so the Phase 1 mock and all existing code still compile), the new invoke and push channels, the preload
bridge, and mock-safe handler stubs, so that wave 2-4 tasks can code against a fixed contract.

## Owned files
- modify: src/shared/types.ts
- modify: src/shared/ipc.ts
- create: src/shared/teamDefaults.ts
- modify: src/preload/index.ts
- modify: src/main/ipc/handlers.ts (mock stubs for the new channels only; T08 adds the real wiring later)
- modify: tests/shared/ipcContract.test.ts

## Read-only context
- .factory/20261119-phase3-transcripts/plan.md (Verified facts, Architecture)
- src/shared/mock/team.ts, src/shared/status.ts, src/renderer/src/store/useConsoleStore.ts

## Notes
### types.ts: append and extend exactly (all new fields optional on existing types)
```ts
// AgentEvent: add optional fields (keep the existing ones unchanged)
//   toolUseId?: string; uuid?: string; failed?: boolean
//   tokens?: { input: number; output: number; cacheCreation?: number; cacheRead?: number }
export type TeamSource = 'live' | 'demo' | 'empty'
export type LiveAgentKind = 'lead' | 'subagent' | 'teammate'
export type LastTurn = 'none' | 'user' | 'tool_result' | 'assistant_tool_use' | 'assistant_end' | 'interrupted' | 'api_error'
export interface OpenTool { id: string; name: string; startedMs: number }
export type RegistryStatus = 'busy' | 'idle' | 'waiting'
export interface AgentRuntime {
  kind: LiveAgentKind
  startedMs: number            // first line ts of this agent
  lastActivityMs: number       // newest timestamped line of this agent
  openTools: OpenTool[]        // tool_use without a tool_result yet (matched by id)
  lastTurn: LastTurn
  errorKind?: string           // assistant.error ('rate_limit', ...) when lastTurn === 'api_error'
  finished?: boolean           // sub-agent finished (meta.finished | parent got 'completed' | end_turn w/o open tool)
  background?: boolean         // meta.requestShape === 'background' or Agent result status 'async_launched'
  registry?: { status: RegistryStatus; waitingFor?: string; updatedMs: number } // lead only, live pid
}
// Agent: add optional fields
//   parentId?: string; depth?: number; runtime?: AgentRuntime; cwd?: string
// TeamSnapshot: add optional fields
//   source?: TeamSource; sessionId?: string; cwd?: string; title?: string
//   historyTruncated?: boolean; waitingForSession?: boolean
export interface SessionSummary {
  sessionId: string
  accountId: string           // '' when the config dir is not linked to a profile
  configDir: string           // absolute
  projectDir: string          // encoded folder name under projects/
  cwd?: string                // from the first line carrying cwd (real folder)
  title?: string              // last custom-title ?? ai-title ?? agent-name
  mtimeMs: number
  sizeBytes: number
  live?: boolean              // registry entry with a live pid
  registryStatus?: RegistryStatus
}
export type TeamSelection =
  | { mode: 'auto' }
  | { mode: 'session'; accountId: string; sessionId: string }
export interface TokenTotals { input: number; output: number; cacheCreation: number; cacheRead: number }
export interface UsageToday {
  day: string                                   // local YYYY-MM-DD
  byAccount: Record<string, TokenTotals>        // key '' = unlinked default dir
}
```
### teamDefaults.ts (new)
- `export const LEAD_ID = 'lead'`.
- `export const EMPTY_TEAM_SNAPSHOT: TeamSnapshot`: repo '', teamName '', accountId '', now = `new Date(0).toISOString()`,
  every array empty, `source: 'empty'`.
- `export const PLACEHOLDER_AGENT: Agent`: id '', name '—', initials '', avatarColor '#8E95A0', every other string ''
  and every number 0, current `{tool:'', target:''}`, and the arrays empty. Used by safe selectors.
- `export const tokenHeadline = (t: TokenTotals): number => t.input + t.output + t.cacheCreation` (the decision in plan Assumptions;
  this is the only place that formula lives).

### ipc.ts: add to IPC (names exact)
```ts
transcriptsListSessions: 'transcripts:list-sessions',   // args [] -> SessionSummary[]
transcriptsSelect: 'transcripts:select',                // args [sel: TeamSelection] -> TeamSnapshot
transcriptsGetSelection: 'transcripts:get-selection',   // args [] -> TeamSelection
usageGetToday: 'usage:get-today',                       // args [] -> UsageToday
// pushes
teamChanged: 'team:changed',                            // TeamSnapshot
transcriptsSessionsChanged: 'transcripts:sessions-changed', // SessionSummary[]
usageChanged: 'usage:changed'                           // UsageToday
```
- Add the 4 invokes to `IpcInvokeMap` and `invokeChannelList`. Add the 3 pushes to `PUSH_CHANNELS` (keep `team:event`; it stays unused).
- `ConsoleApi`: `team.onChanged(cb: (s: TeamSnapshot) => void): () => void`. Add the new namespace
  `transcripts: { listSessions(): Promise<SessionSummary[]>; select(sel: TeamSelection): Promise<TeamSnapshot>; getSelection(): Promise<TeamSelection>; onSessionsChanged(cb: (s: SessionSummary[]) => void): () => void }`
  and `usage: { getToday(): Promise<UsageToday>; onChanged(cb: (u: UsageToday) => void): () => void }`.
### preload: wire all of the above with the existing `invoke`/`on` helpers.
### handlers.ts (mock part only)
- In `createMockHandlers`: `'transcripts:list-sessions': () => []`, `'transcripts:select': (sel) =>` the sel is validated
  (`{mode:'auto'}` or `{mode:'session', accountId: string, sessionId: string}`; invalid -> `structuredClone(EMPTY_TEAM_SNAPSHOT)`), and the
  result is `structuredClone(EMPTY_TEAM_SNAPSHOT)`. `'transcripts:get-selection': () => ({ mode: 'auto' })`.
  `'usage:get-today': () => ({ day: '', byAccount: {} })`.
- Do **not** change `'team:get-snapshot'` in the mock handlers (it still returns the mock, which tests rely on), and do not touch the real
  accounts/pty wiring. Export `export function isTeamSelection(v: unknown): v is TeamSelection` from handlers.ts (T08 reuses it).
### tests/shared/ipcContract.test.ts
- Update the PUSH_CHANNELS expectation to include the 3 new pushes. Add cases: every new invoke is in INVOKE_CHANNELS, no push is invokable,
  the preload source references every new channel constant. The existing style is to grep `src/preload/index.ts` text; keep it.
- Tests may use `!` for `noUncheckedIndexedAccess`.

## Acceptance commands
- npm run typecheck
- npm test -- tests/shared/ipcContract.test.ts tests/main/ipcHandlers.test.ts tests/shared/mock.test.ts
- npm test

## Done when
- All acceptance commands pass (the full suite stays green; no other file changed)
- Only owned files changed
