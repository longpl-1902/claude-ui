# T05 - Session model: records + sub-agent metas + registry -> agent tree and TeamSnapshot

- Wave: 2
- Depends on: T01 (types, teamDefaults), T02 (records.ts types; it consumes records, it does not parse)
- Spec refs: R-05, R-06; spec "Normalized event", Screen 1 cards, inspector, lead console; plan Verified facts 3-5, 8, 10, 13, 15
- Tests: tests/main/transcripts/sessionModel.test.ts (test-writer)

## Goal
An in-memory, incremental model of one session. Feed it parsed records per source file (the lead or a sub-agent) plus
sub-agent meta files and the lead's registry entry. It builds the lead -> sub-agent tree from the real linking fields
and produces a capped `TeamSnapshot` with live data for cards, inspector tabs, the console and `AgentRuntime`.

## Owned files
- create: src/main/transcripts/sessionModel.ts
- create: tests/main/transcripts/sessionModel.test.ts (test-writer first; the implementer may add `!` only)

## Read-only context
- src/main/transcripts/records.ts (T02), src/shared/types.ts and src/shared/teamDefaults.ts (T01)
- src/shared/mock/team.ts (the shape of a fully populated Agent), src/shared/format.ts
- .factory/20261119-phase3-transcripts/plan.md

## Notes
### API (exact)
```ts
export interface SubagentMeta { agentType?: string; description?: string; toolUseId?: string; spawnDepth?: number
  model?: string; finished?: boolean; name?: string; requestShape?: string }
export function parseSubagentMeta(text: string): SubagentMeta | null    // copies only these fields, typeof-checked
export interface SessionModelOptions { sessionId: string; accountId: string; projectCwd?: string
  caps?: { activity?: number /*150*/; events?: number /*500*/; console?: number /*300*/; messages?: number /*100*/ } }
export interface SessionModel {
  ingest(source: 'lead' | string /* sub agentId */, records: TranscriptRecord[]): void
  setMeta(agentId: string, meta: SubagentMeta): void
  setRegistry(entry: { status?: RegistryStatus; waitingFor?: string; updatedMs: number } | null): void
  reset(source: 'lead' | string): void        // the tailer reported a reset: drop this source's derived data, keep the others
  markHistoryTruncated(): void
  isDirty(): boolean
  snapshot(nowMs: number): TeamSnapshot       // clears the dirty flag; returns a fresh object (no shared mutable arrays)
}
export function createSessionModel(opts: SessionModelOptions): SessionModel
```
### Rules
- **Dedupe:** records with a `uuid` already seen (per model, across sources) are ignored. Usage is counted once per `messageId`, and
  the last usage seen for an id replaces the earlier one (all copies are identical, fact 8).
- **Agents:** the lead (id `LEAD_ID`, kind 'lead', name 'lead', role = the session title or 'Lead', depth 0) always exists. A sub-agent is
  created on its first record or meta. kind = 'teammate' if `meta.name`, else 'subagent'. name = `meta.name ?? meta.agentType ?? 'agent'`.
  role = `meta.agentType ?? ''`. taskTitle = `meta.description ?? ''`. model = the last assistant `model` (not '<synthetic>') ?? `meta.model ?? ''`.
- **Parent:** build `toolUseOwner: Map<toolUseId, agentId>` from every source's assistant toolUses. parentId = `toolUseOwner.get(meta.toolUseId) ?? LEAD_ID`.
  It is recomputed lazily in snapshot(), because the parent's file may arrive after the child's. depth = the parent's depth + 1. A cycle guard falls back to the lead.
- **Agent order:** depth-first from the lead, children by startedMs.
- **Per agent fields:** initials (the first letters of up to 2 words of the name, upper case), avatarColor from a fixed 8-colour palette by
  creation index (the lead always gets `#7AA7FF`), worktree = the last `gitBranch` ?? '', cwd = the last `cwd`.
  current = the newest open tool `{tool: name, target}`. Else the last tool `{tool, target}` with tool '' when the agent never used a tool.
  elapsedSec = `round(((running ? nowMs : lastActivityMs) - startedMs) / 1000)`, where running = it has an open tool or lastTurn in user/tool_result.
  tokens = `tokenHeadline` of the deduped usage sum. toolCalls = the count of distinct tool_use ids. timeline = [] (Phase 5).
- **Activity** (newest last, cap): one item per tool_use: `{ time: local HH:MM:SS of the tool_use ts, tool, target, result, failed }`.
  The result is filled when the tool_result arrives: `interrupted ? 'interrupted' : isError ? summary || 'error' : fileChange ? `+${a} −${r}` : summary || 'ok'`.
  It is `'…'` while open. failed = isError.
- **Files:** aggregate fileChange by `path` (sum added/removed, keep the last kind). Sort by the most recent change.
- **Messages** (cap, chronological): a sub-agent 'first-task' prompt -> `{direction:'in', peer: parent name, text}`. The parent's agentResult text for
  that agent's toolUseId -> `{direction:'out', peer: parent name}` on the child. SendMessage use -> 'out' on the sender with peer = `to`. If `to`
  resolves (case-insensitive) to an agent name or id in the tree (or 'lead'/'team-lead'/'main' -> the lead), add 'in' on that agent with peer = the
  sender's name. time = local HH:MM.
- **Runtime** (`AgentRuntime`): startedMs/lastActivityMs from record tsMs. openTools: add on tool_use and remove on a tool_result with the same id
  (no FIFO by name). lastTurn: assistant with stopReason 'end_turn'/'stop_sequence' -> 'assistant_end'; assistant with toolUses -> 'assistant_tool_use';
  tool_results -> 'tool_result'; prompt (user/command/first-task) -> 'user'; interrupted -> 'interrupted' (and clear openTools); assistant isApiError
  -> 'api_error' + errorKind; system fatal -> 'api_error'. Prompts of kind 'task-notification' and 'compact-summary' do not change lastTurn.
  finished (sub only): `meta.finished === true`, or the parent's agentResult for its toolUseId has status 'completed'. background: `meta.requestShape === 'background'`,
  or the agentResult status 'async_launched'. registry: set only on the lead.
- **Events** (`AgentEvent[]`, cap, chronological): tool_use -> 'tool_start' (Agent tool -> also 'spawn' with target = the agent name). tool_result -> 'tool_end'
  (failed, result). Assistant text -> 'message'. User prompt -> 'message' with agentId lead and result 'user'. api_error -> 'error'. interrupted -> 'status'
  with result 'interrupted'. A sub becoming finished -> 'stop'. Fields: sessionId, accountId, agentId, parentAgentId, toolUseId, uuid, tokens (on assistant
  events, once per messageId), worktree = gitBranch.
- **Console** (cap, chronological; `ConsoleLine {time HH:MM:SS, who, text}`): user prompts (who 'you'), assistant text (who = agentId, the first 200 chars),
  `${tool} ${target}` on tool_start (who = agentId), `✗ ${tool}: ${summary}` on a failed tool_end, `spawned ${name}` on spawn, `done` on stop, `API error: ${errorKind}`.
- **Snapshot:** `{ source:'live', sessionId, accountId, repo: basename(projectCwd ?? lead cwd ?? ''), teamName: title ?? sessionId.slice(0,8), now: ISO(nowMs),
  agents, events, console, worktrees: [], tasks: [], overlaps: [], timelineTicks: [], cwd, title, historyTruncated }`. title = the last custom > ai > agent-name record.
- Local time formatting uses `new Date(ms)` getters (tests pin TZ via `process.env.TZ` or compare with the same helper).

## Acceptance commands
- npm test -- tests/main/transcripts/sessionModel.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
