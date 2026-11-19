# T09 - Session model: tasks, spans, hook overlay; live status from hooks

- Wave: 3
- Depends on: T01, T06
- Spec refs: R-11, R-12, R-18
- Tests: tests/main/transcripts/sessionModel.test.ts, tests/shared/liveStatus.test.ts

## Goal
Feed the T06 trackers from the session model so `TeamSnapshot.tasks` and `Agent.spans` are real, and add
`applyHook(e)` so realtime hook events adjust agent runtime (needs-you, finished, activity) before transcripts arrive.

## Owned files
- modify: src/main/transcripts/sessionModel.ts
- modify: src/shared/liveStatus.ts
- modify: tests/main/transcripts/sessionModel.test.ts
- modify: tests/shared/liveStatus.test.ts

## Read-only context
- src/main/transcripts/taskTracker.ts, activitySpans.ts, records.ts (T06)
- src/shared/types.ts (HookEvent, AgentRuntime.hook, ActivitySpan, SharedTask from T01)
- plan.md Verified fact 10, Decision D9

## Notes
- `SessionModel` gains `applyHook(e: HookEvent): boolean` (true = snapshot changed). Agent resolution: `e.agentId`
  matching a known sub-agent id, else the lead (ASSUMPTION in plan). Rules:
  PermissionRequest -> `runtime.hook.pendingPermission = {toolName, sinceMs}`; Notification with
  `notificationType` permission_prompt / agent_needs_input / elicitation_dialog -> `hook.notification`;
  PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied, UserPromptSubmit, Stop, StopFailure, SessionEnd clear
  both for that agent (Stop/SessionEnd clear all agents); SubagentStop -> that sub-agent `finished = true`;
  every event sets `hook.lastEventMs` and bumps `lastActivityMs` when newer. Hooks for a different sessionId are ignored.
- Snapshot: `tasks` = taskTracker.tasks(); each agent `spans` = spanTracker.spans(agentId, nowMs) (now from the
  snapshot clock); `hooksActive` = any hook event in the last 10 min. Keep existing caps; spans count toward nothing else.
- liveStatus.ts: new reasons `'hook-permission'` and `'hook-notification'` -> status needs-you, checked before the
  existing needs-you rules; a `hook.pendingPermission` older than 30 min is ignored (stale). `reasonLabel` texts:
  "Waiting for permission: <tool>" and "Needs your input". Thresholds stay exported; add `HOOK_STALE_MS`.
- Existing behaviour and tests must stay green; update only expectations that the new fields change (`tasks`, `spans`).
Tests: tasks appear from synthetic TaskCreate/TaskUpdate lines; spans for lead and a sub-agent; applyHook permission
-> needs-you, cleared by PostToolUse; notification; SubagentStop finishes; other session ignored; unknown agent -> lead.

## Acceptance commands
- npm test -- tests/main/transcripts tests/shared/liveStatus.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
