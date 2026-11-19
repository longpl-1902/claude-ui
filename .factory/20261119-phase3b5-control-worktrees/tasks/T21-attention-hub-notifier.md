# T21 - Attention hub (light status for every live session) + OS notifications

- Wave: 5
- Depends on: T01, T06, T07, T09 (records/parseLine), T11 (sessionIndex/usage APIs)
- Spec refs: R-22, R-23, R-24 (UX M1 data, M2, M3), S2 (tokens per project)
- Tests: tests/main/attention/statusHub.test.ts, tests/main/attention/notifier.test.ts, tests/main/attention/prefs.test.ts

## Goal
Answer "where am I needed, in any project?" in the main process: a light, bounded status model for every live
session (registry-live, app-controlled, or hook-active in the last 10 min) next to the full model of the selected
session; a deduped list of attention items; per-project status for the rail; OS toasts + taskbar flash/overlay for
**new** needs-you items, with per-project mute and Do-not-disturb.

## Owned files
- create: src/main/attention/statusHub.ts
- create: src/main/attention/notifier.ts
- create: src/main/attention/prefs.ts
- create: tests/main/attention/statusHub.test.ts
- create: tests/main/attention/notifier.test.ts
- create: tests/main/attention/prefs.test.ts

## Read-only context
- src/main/transcripts/{parseLine,records,transcriptFs,sessionIndex,layout,projectResolver}.ts
- src/main/control/controlManager.ts (T07: list(), streamState()), src/shared/types.ts (Attention*, ProjectStatus from T01)
- src/shared/liveStatus.ts (T09 reasons), plan.md "UX debate"

## Notes
statusHub.ts:
```ts
export interface StatusHubDeps {
  fs: ByteReadFs; nowMs: () => number
  listSessions: () => Promise<SessionSummary[]>            // transcriptService.listSessions (has live, registryStatus, project, accountId, controlled)
  controls: () => { info: ControlSessionInfo; permissions: PermissionPrompt[] }[]
  sessionFile: (s: SessionSummary) => string               // <configDir>/projects/<projectDir>/<sessionId>.jsonl
  usageByProject: () => Record<string, TokenTotals>        // transcriptService.usageByProject() (T11), key = SessionProject.key
  setTimer; clearTimer
}
export interface StatusHub {
  refresh(): Promise<void>                    // called (debounced 1 s) on sessions-changed, control-changed, transcript file change of a tracked session
  ingestHook(e: HookEvent): void              // same rules as T09 applyHook, kept per session/agent
  onFileChanged(path: string): void           // tail again if the path belongs to a tracked session
  snapshot(): AttentionSnapshot
  onChanged(cb: (s: AttentionSnapshot) => void): () => void
  dispose(): void
}
```
- Tracked sessions = `live` OR controlled (not draft/exited) OR a hook event in the last 10 min; max 20 (newest).
  For each, keep a **light state**: incremental tail of the main transcript only, starting at `max(0, size - 256 KiB)`
  (no sub-agent files, no backfill beyond that), records via `parseLine`, tracking: open AskUserQuestion /
  ExitPlanMode tool uses (by id until their result), last turn api error, lastActivityMs, running/idle from registry.
  Sub-agent needs-you comes from hooks (agent_id/agent_type) - documented limit before hooks.
- Items (`AttentionItem`, T01): permission (controlled `permissions` -> `controlId`, `requestId`, `canAllowSession`;
  hook PermissionRequest / Notification permission_prompt -> external, no ids), question (open AskUserQuestion),
  plan (open ExitPlanMode), api-error (last turn api error within 30 min), input (registry `waiting` with waitingFor,
  or Notification idle_prompt / agent_needs_input). Id = stable hash of session+kind+tool/request id. Sorted oldest first.
  `external = !controlled`. An item disappears when resolved; no history.
- `projects: ProjectStatus[]` grouped by `SessionSummary.project.key` over ALL sessions of the last 24 h (not only
  tracked): name, root, accountIds (distinct accounts of live sessions; `mixedAccounts` when > 1), liveSessions,
  running (registry busy or controlled busy), needsYou (items count), tokensToday (usageByProject), lastActivityMs.
- Cost bound (answer to the reviewer): 20 sessions x 256 KiB first read, then only appended bytes; no full model.
usageByProject comes from `transcriptService.usageByProject()` (T11).
notifier.ts:
```ts
export function createNotifier(deps: { show: (n: { title: string; body: string; onClick: () => void }) => void; flash: (on: boolean) => void; overlay: (count: number) => void; isFocusedAndVisible: () => boolean; prefs: () => AttentionPrefs; onFocusItem: (id: string) => void }): { update(s: AttentionSnapshot): void }
```
Toast only for item ids never seen before, kind in the toast set (permission, question, plan, input; api-error only
if `prefs.notifyErrors`), project not muted, DND off, and not (window focused AND that project is the viewed one -
`isFocusedAndVisible()` covers "focused"; viewed project is passed in prefs as `viewedProjectKey`). Body:
`<project> - <agent> needs permission: <detail>` (detail max 80). Click -> `onFocusItem(id)`. flash(true) while
unmuted count > 0 and window not focused; overlay(count) always (0 clears). Never more than 1 toast per 3 s (others
summarized "+N more").
prefs.ts: `<userData>/attention-prefs.json` `{ mutedProjects: string[], dnd: boolean, notifyErrors: boolean,
viewedProjectKey?: string }` load/save atomic, schema-validated, corrupt -> defaults.
**R-19:** nothing here writes to Claude processes or files; read-only tails through transcriptFs (allowlist).

## Acceptance commands
- npm test -- tests/main/attention
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum (final UX decisions)
See plan.md "Final decisions after the UX rebuttal" F1–F4 — items assigned to T21 are part of this task's scope and acceptance.

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.
