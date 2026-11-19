# T04 - Live status derivation (shared, pure)

- Wave: 2
- Depends on: T01 (`AgentRuntime`, `AgentStatus` in src/shared/types.ts)
- Spec refs: R-07; spec "Agent status is derived"; plan Verified facts 10, 11
- Tests: tests/shared/liveStatus.test.ts (test-writer)

## Goal
One pure function turns an `AgentRuntime` and `now` into a status plus a short reason. The renderer runs it on a
5 s tick. The thresholds are exported constants, so they are tested and tunable.

## Owned files
- create: src/shared/liveStatus.ts
- create: tests/shared/liveStatus.test.ts (test-writer first; the implementer may add `!` only)

## Read-only context
- src/shared/types.ts (after T01), src/shared/status.ts (do not modify; the mock path still uses it)
- .factory/20261119-phase3-transcripts/plan.md

## Notes
```ts
export const LIVE_THRESHOLDS = {
  modelTurnStaleMs: 5 * 60_000,   // the model's turn (last line user/tool_result) but no write for this long -> waiting 'stale'
  openToolStaleMs: 30 * 60_000,   // an open tool with no write for this long -> waiting 'stale'
  leadDoneMs: 30 * 60_000,        // the lead after end_turn, quiet this long and no live registry -> done 'ended'
} as const
export type LiveReason = 'finished' | 'ended' | 'waiting-for-you' | 'question' | 'api-error' | 'tool' | 'thinking'
  | 'busy' | 'idle' | 'interrupted' | 'stale' | 'no-activity'
export const NEEDS_YOU_TOOLS = ['AskUserQuestion', 'ExitPlanMode'] as const
export function deriveLiveStatus(rt: AgentRuntime, nowMs: number, th = LIVE_THRESHOLDS): { status: AgentStatus; reason: LiveReason; detail?: string }
export function reasonLabel(reason: LiveReason, detail?: string): string   // short English text for tooltips, e.g. "waiting for you: dialog open"
```
Evaluate in this exact order (the first match wins). `quiet = nowMs - rt.lastActivityMs`:
1. `rt.finished` -> done / 'finished'.
2. `rt.registry?.status === 'waiting'` -> needs-you / 'waiting-for-you', detail = waitingFor.
3. Any open tool named in NEEDS_YOU_TOOLS -> needs-you / 'question', detail = the tool name.
4. `rt.lastTurn === 'api_error'` -> needs-you / 'api-error', detail = errorKind.
5. Open tools non-empty: quiet <= openToolStaleMs -> running / 'tool', detail = the newest open tool name. Else waiting / 'stale'.
6. lastTurn 'user' | 'tool_result': quiet <= modelTurnStaleMs -> running / 'thinking'. Else waiting / 'stale'.
7. `rt.registry?.status === 'busy'` -> running / 'busy' (for example a background sub-agent while the lead's turn ended).
8. lastTurn 'assistant_end' | 'assistant_tool_use' (the latter only with no open tool, i.e. results all came back but no newer line):
   - kind !== 'lead' and lastTurn 'assistant_end' -> done / 'finished'.
   - lead: if `!rt.registry` and quiet > leadDoneMs -> done / 'ended'; else waiting / 'idle'.
   - 'assistant_tool_use' with no open tool -> running / 'thinking' if quiet <= modelTurnStaleMs, else waiting / 'stale'.
9. 'interrupted' -> waiting / 'interrupted'.
10. Otherwise ('none') -> waiting / 'no-activity'.
- A clock skew (nowMs < lastActivityMs) is treated as quiet = 0.
- Table-driven tests cover every branch and both sides of each threshold (exactly at the threshold counts as within).

## Acceptance commands
- npm test -- tests/shared/liveStatus.test.ts tests/shared/status.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
