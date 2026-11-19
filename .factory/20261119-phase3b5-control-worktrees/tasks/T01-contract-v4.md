# T01 - Contract v4 (types, IPC channels, preload, handler stubs)

- Wave: 1
- Depends on: none
- Spec refs: R-01, R-19 (plan.md)
- Tests: tests/shared/ipcContract.test.ts

## Goal
Add every shared type and IPC channel this run needs so later tasks never touch `types.ts`, `ipc.ts`, the preload or
handler stubs in the same wave. New channels get mock/stub handlers (`not-implemented` / empty values) in
`createMockHandlers`; T13 replaces them with real ones.

## Owned files
- modify: src/shared/types.ts
- modify: src/shared/ipc.ts
- modify: src/preload/index.ts
- modify: src/main/ipc/handlers.ts (mock stubs + `isControlStartRequest`, `isKillExternalRequest`, `isPermissionAnswer` validators only)
- modify: src/shared/mock/team.ts (only if the type changes require it)
- modify: src/renderer/src/components/team/SharedTaskList.tsx (compile fix for the new `pending` state only)
- modify: tests/shared/ipcContract.test.ts

## Read-only context
- plan.md (Verified facts 2-14, Decisions D1-D12)
- tests/main/ipcHandlers.test.ts (must keep passing)

## Notes
Add to `types.ts` exactly (additive; existing types keep their fields):
```ts
export type ControlPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk'
export type ControlState = 'draft' | 'starting' | 'idle' | 'busy' | 'stopping' | 'exited'
export type ControlResume = { kind: 'resume'; sessionId: string; fork?: boolean } | { kind: 'continue' }
export interface ControlStartRequest { cwd: string; accountId: string; confirmed?: boolean; resume?: ControlResume; model?: string; permissionMode?: ControlPermissionMode }
export interface ControlStartResult { ok: boolean; controlId?: string; reason?: LaunchBlock | 'needs-confirmation' | 'invalid-args' | 'session-live-elsewhere'; warnings?: LaunchWarning[] }
export interface PermissionPrompt { requestId: string; toolName: string; displayName: string; toolUseId?: string; description?: string; inputPreview: string; decisionReason?: string; blockedPath?: string; receivedAt: string }
export interface PermissionAnswer { behavior: 'allow' | 'deny'; message?: string }
export interface ControlSessionInfo { id: string; accountId: string; cwd: string; state: ControlState; permissionMode: ControlPermissionMode; model?: string; resume?: ControlResume; pid?: number; sessionId?: string; startedAt?: string; exitCode?: number; error?: string; slashCommands: string[]; pendingPermissions: number; lastResult?: 'success' | 'interrupted' | 'error'; queuedTurns: number }
export type ControlStreamEvent =
  | { controlId: string; kind: 'typing'; messageId: string; text: string }   // full text so far of the streaming assistant message
  | { controlId: string; kind: 'typing-clear' }
  | { controlId: string; kind: 'thinking'; active: boolean }
  | { controlId: string; kind: 'permission'; prompt: PermissionPrompt }
  | { controlId: string; kind: 'permission-resolved'; requestId: string }
  | { controlId: string; kind: 'turn-end'; result: 'success' | 'interrupted' | 'error'; text?: string; costUsd?: number; denials?: number }
  | { controlId: string; kind: 'notice'; level: 'info' | 'error'; text: string }
export interface ControlStreamState { controlId: string; typing?: { messageId: string; text: string }; thinking: boolean; permissions: PermissionPrompt[]; notices: { level: 'info' | 'error'; text: string; time: string }[] }
export interface KillExternalRequest { accountId: string; sessionId: string; pid: number }
export interface ChangedFileEntry { path: string; status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'; added?: number; removed?: number; committed: boolean; uncommitted: boolean }
export interface WorktreeInfo { path: string; branch?: string; head: string; detached: boolean; isMain: boolean; locked?: boolean; prunable?: boolean; ahead: number | null; behind: number | null; files: ChangedFileEntry[]; changedFiles: number; error?: string }
export interface WorktreeOverlap { path: string; worktrees: string[] } // worktree paths
export interface WorkspaceSnapshot { root: string | null; base: string | null; worktrees: WorktreeInfo[]; overlaps: WorktreeOverlap[]; updatedAt: string; error?: string }
export interface FileDiff { worktreePath: string; branch?: string; diff: string; truncated: boolean }
export type HookEventName = 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'PermissionRequest' | 'PermissionDenied' | 'Notification' | 'Stop' | 'StopFailure' | 'SubagentStart' | 'SubagentStop' | 'TeammateIdle' | 'TaskCreated' | 'TaskCompleted'
export interface HookEvent { event: HookEventName; sessionId: string; receivedMs: number; cwd?: string; agentId?: string; agentType?: string; permissionMode?: string; toolName?: string; toolUseId?: string; notificationType?: string; message?: string; error?: string; isInterrupt?: boolean; taskId?: string; taskSubject?: string; teammateName?: string; source?: string; reason?: string }
export type HooksState = 'not-installed' | 'installed' | 'partial' | 'outdated' | 'unavailable'
export interface HooksStatus { projectRoot: string | null; settingsPath: string | null; state: HooksState; nodePath?: string; reason?: string; server: { listening: boolean; port?: number }; eventsReceived: number; lastEventAt?: string }
export interface HooksPreview { previewId: string; action: 'install' | 'uninstall'; settingsPath: string; before: string | null; after: string | null; backupPath?: string; scriptPath: string; notes: string[] }
export interface ActivitySpan { kind: ActivityKind; startMs: number; endMs: number | null } // null = still open
export type AttentionKind = 'permission' | 'question' | 'plan' | 'api-error' | 'input'
export interface AttentionItem { id: string; kind: AttentionKind; projectKey: string; projectName: string; accountId: string; sessionId: string; agentId: string; agentName: string; detail: string; sinceMs: number; external: boolean; cwd?: string; controlId?: string; requestId?: string; canAllowSession?: boolean }
export interface ProjectStatus { key: string; name: string; root: string; git: boolean; accountIds: string[]; mixedAccounts: boolean; liveSessions: number; running: number; waiting: number; needsYou: number; tokensToday: number; lastActivityMs: number }
export interface AttentionSnapshot { items: AttentionItem[]; projects: ProjectStatus[]; updatedAt: string }
export interface AttentionPrefs { mutedProjects: string[]; dnd: boolean; notifyErrors: boolean; viewedProjectKey?: string }
```
Also: `PermissionAnswer` gains `scope?: 'once' | 'session'`; `PermissionPrompt` gains `canAllowSession?: boolean`.
Extend existing types (all optional, additive): `SharedTaskState` gains `'pending'`; `SharedTask` gains
`blockers?: number[]`, `source?: 'task' | 'todo'`, `description?: string`; `Agent` gains `spans?: ActivitySpan[]`;
`AgentRuntime` gains `hook?: { pendingPermission?: { toolName: string; sinceMs: number }; notification?: { type: string; sinceMs: number }; lastEventMs: number }`;
`SessionSummary` gains `controlled?: boolean; controlId?: string; entrypoint?: string; registryPid?: number`; `Worktree` gains
`behind?: number; files?: string[]; isMain?: boolean; error?: string`; `TeamSnapshot` gains `hooksActive?: boolean`.

Channels (invoke) and `ConsoleApi` methods:
| channel | args | result | api |
|---|---|---|---|
| control:start | req: ControlStartRequest | ControlStartResult | control.start |
| control:send | controlId, text | OkResult | control.send |
| control:interrupt | controlId | OkResult | control.interrupt |
| control:stop | controlId | OkResult | control.stop |
| control:answer | controlId, requestId, answer: PermissionAnswer | OkResult | control.answer |
| control:set-model | controlId, model: string \| null | OkResult | control.setModel |
| control:set-mode | controlId, mode: ControlPermissionMode | OkResult | control.setMode |
| control:list | - | ControlSessionInfo[] | control.list |
| control:get-stream | controlId | ControlStreamState \| null | control.getStream |
| session:kill-external | req: KillExternalRequest | OkResult | session.killExternal |
| git:watch | root: string \| null | WorkspaceSnapshot | git.watch |
| git:compare | root, path | FileDiff[] | git.compare |
| hooks:status | projectRoot: string \| null | HooksStatus | hooks.status |
| hooks:preview | projectRoot, action: 'install' \| 'uninstall' | HooksPreview \| OkResult-with-reason (`{ ok:false, reason }`) | hooks.preview |
| hooks:apply | previewId | OkResult | hooks.apply |
| attention:get | - | AttentionSnapshot | attention.get |
| attention:get-prefs | - | AttentionPrefs | attention.getPrefs |
| attention:set-prefs | p: AttentionPrefs | OkResult | attention.setPrefs |
Pushes (add to PUSH_CHANNELS): `control:changed` (ControlSessionInfo[]) -> `control.onChanged`, `control:stream`
(ControlStreamEvent[]) -> `control.onStream`, `git:changed` (WorkspaceSnapshot) -> `git.onChanged`, `hooks:changed`
(HooksStatus) -> `hooks.onChanged`, `attention:changed` (AttentionSnapshot) -> `attention.onChanged`,
`attention:focus` ({ itemId: string }, sent when an OS notification is clicked) -> `attention.onFocus`.
Type `hooks:preview` result as `HooksPreview | OkResult`. Mock stubs: attention:get -> empty snapshot, get-prefs ->
defaults `{mutedProjects:[], dnd:false, notifyErrors:false}`, set-prefs -> NOT_IMPLEMENTED. Validator
`isAttentionPrefs(v)` (arrays of strings <= 200 items) exported from handlers.ts.
Keep `agent:*`, `team:pause-all`, `worktree:open-in-editor` unchanged (T13 implements pause-all/open-in-editor).
Mock stubs: start -> `{ok:false, reason:'invalid-args'}` for bad args else `{ok:false, reason:'not-implemented'}`-like
(`reason` must be a ControlStartResult reason: use `'invalid-args'` when bad, otherwise return `{ ok: false }`);
list -> []; get-stream -> null; git:watch -> `{root, base:null, worktrees:[], overlaps:[], updatedAt:new Date(0).toISOString()}`;
git:compare -> []; hooks:status -> state 'unavailable', reason 'not-implemented'; preview/apply -> NOT_IMPLEMENTED.
Export validators from handlers.ts for T13: `isControlStartRequest(v)`, `isPermissionAnswer(v)`,
`isKillExternalRequest(v)` (pid positive integer, strings <= 1024 chars, model regex `^[A-Za-z0-9._\[\]-]{1,64}$`,
mode in the 5 values, resume shape checked). Mock handlers never start anything (R-19).
SharedTaskList.tsx: only add the `pending` case to whatever map/switch exists (label "to do", muted); T16 rewrites it later.

## Acceptance commands
- npm test -- tests/shared/ipcContract.test.ts tests/main/ipcHandlers.test.ts tests/shared/mock.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass; contract test covers every new channel (invoke list exhaustive, pushes disjoint, preload exposes each)
- Only owned files changed

## Addendum (final UX decisions)
See plan.md "Final decisions after the UX rebuttal" F1–F4 — items assigned to T01 are part of this task's scope and acceptance.
