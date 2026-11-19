# T06 - Transcript task fields, shared-task tracker, activity spans

- Wave: 2
- Depends on: T01
- Spec refs: R-11, R-12, hard rule 5
- Tests: tests/main/transcripts/taskTracker.test.ts, tests/main/transcripts/activitySpans.test.ts, tests/main/transcripts/parseLine.test.ts

## Goal
Carry the task-tool inputs/results through the line parser, then derive the shared task list and per-agent activity
spans with two pure, incremental modules. Session-model integration is T09.

## Owned files
- modify: src/main/transcripts/records.ts
- modify: src/main/transcripts/parseLine.ts
- create: src/main/transcripts/taskTracker.ts
- create: src/main/transcripts/activitySpans.ts
- create: tests/main/transcripts/taskTracker.test.ts
- create: tests/main/transcripts/activitySpans.test.ts
- modify: tests/main/transcripts/parseLine.test.ts (add task cases only)

## Read-only context
- plan.md Verified fact 9, Decision D9
- src/main/transcripts/sessionModel.ts (how records are consumed; do not edit)
- tests/fixtures/transcripts/builders.ts (reuse builders; add new builders inside your test files, not in fixtures)

## Notes
records.ts additions (optional fields, nothing removed):
- `ToolUseRec.task?: { op: 'create'; subject: string; description?: string } | { op: 'update'; taskId: string; status?: string; subject?: string; owner?: string; addBlockedBy?: string[] } | { op: 'list' } | { op: 'todo'; todos: { content: string; status: string }[] }` (TaskCreate / TaskUpdate / TaskList / TodoWrite; strings max 200, arrays max 100).
- `ToolResultRec.task?: { createdId?: string; list?: { id: string; subject: string; status: string; owner?: string; blockedBy: string[] }[] }` from `toolUseResult.task.id` (TaskCreate) and `toolUseResult.tasks` (TaskList).
parseLine.ts: fill those fields; everything else unchanged (existing tests must stay green).

taskTracker.ts:
```ts
export interface TaskTracker {
  onToolUse(agentId: string, u: ToolUseRec, tsMs: number): void
  onToolResult(agentId: string, r: ToolResultRec, tsMs: number): void
  tasks(): SharedTask[]   // sorted by numeric id; TodoWrite list only when no Task* op was ever seen (ids 1..n, source 'todo')
}
export function createTaskTracker(): TaskTracker
```
Create is pending until its result gives the id (match by toolUseId; a create whose result never arrives is not
shown). Status map: completed -> done; deleted -> removed; in_progress -> in_progress; pending -> pending. Then
blocked overrides pending/in_progress when any blocker is not done (`blockedBy` = first open blocker, `blockers` =
all). Failing (D9): for in_progress/blocked tasks, consecutive failed results (`isError`) of the owner agent after the
task went in_progress >= 1 -> state 'failing', `failingCount`; a successful result resets. Owner = update.owner (if it
matches an agent name/id, else kept as text), else agent that set in_progress, else creator. TaskList result
replaces statuses/owners/blockers of known ids and adds unknown ones. `ownerAgentId` holds the agent id ('lead' or
sub-agent id) or the owner text.

activitySpans.ts:
```ts
export const SPAN_WINDOW_MS = 20 * 60_000
export function kindForTool(name: string): ActivityKind // Read/Grep/Glob/LS/WebFetch/WebSearch/NotebookRead -> read; Edit/Write/MultiEdit/NotebookEdit -> edit; Bash/PowerShell/BashOutput/Monitor -> bash; AskUserQuestion/ExitPlanMode -> wait; else think
export interface SpanTracker { onAssistant(agentId: string, tsMs: number, toolUses: { id: string; name: string }[]): void; onToolResult(agentId: string, toolUseId: string, tsMs: number, failed: boolean): void; onPrompt(agentId: string, tsMs: number): void; onInterrupted(agentId: string, tsMs: number): void; spans(agentId: string, nowMs: number): ActivitySpan[] }
export function createSpanTracker(o?: { maxPerAgent?: number }): SpanTracker // default 200
```
Tool span = tool_use ts -> matching result ts (kind 'error' if failed); open spans have endMs null. Think span = from
the previous prompt/tool_result ts of that agent to the next assistant ts, only when the gap is <= 120 s. `spans()`
returns spans overlapping [now - 20 min, now], merged when adjacent same-kind gaps < 1 s, oldest dropped beyond max.
Tests: create->id->update in_progress->completed; blocked by open task then unblocked; failing after failed Bash and
reset; deleted; TaskList overwrite; TodoWrite fallback ignored once TaskCreate seen; spans for read/edit/bash/error/
think/open tool; window cut; cap.

## Acceptance commands
- npm test -- tests/main/transcripts
- npm run typecheck

## Done when
- All acceptance commands pass (including the existing transcript tests)
- Only owned files changed
