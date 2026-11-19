# T12 - Renderer stores: control and workspace (git + hooks)

- Wave: 4
- Depends on: T01, T02 (agentMessage)
- Spec refs: R-05, R-06, R-09, R-17, R-19
- Tests: tests/renderer/controlStore.test.ts, tests/renderer/workspaceStore.test.ts

## Goal
Two new Zustand stores (separate from `useConsoleStore` to avoid shared-file churn) that mirror main-process control
sessions and the git/hooks state, with actions the UI tasks call.

## Owned files
- create: src/renderer/src/store/useControlStore.ts
- create: src/renderer/src/store/useWorkspaceStore.ts
- create: tests/renderer/controlStore.test.ts
- create: tests/renderer/workspaceStore.test.ts

## Read-only context
- src/renderer/src/store/useConsoleStore.ts (patterns: `window.api?`, callTeamApi, error fields)
- src/shared/ipc.ts, src/shared/types.ts (T01), src/shared/agentMessage.ts (T02), src/shared/overlap.ts (T03)

## Notes
useControlStore:
```ts
interface ControlStoreState {
  sessions: ControlSessionInfo[]; streams: Record<string, ControlStreamState>; error?: string
  init(): () => void                         // subscribe control.onChanged/onStream, load list; returns unsubscribe
  start(req: ControlStartRequest): Promise<ControlStartResult>
  send(controlId: string, text: string): Promise<OkResult>   // the ONLY caller of window.api.control.send
  interrupt(id: string): Promise<OkResult>; stop(id: string): Promise<OkResult>; interruptAll(): Promise<number> // uses team.pauseAll
  answer(id: string, requestId: string, a: PermissionAnswer): Promise<OkResult>
  setModel(id: string, m: string | null): Promise<OkResult>; setMode(id: string, m: ControlPermissionMode): Promise<OkResult>
  applyStream(events: ControlStreamEvent[]): void; applySessions(l: ControlSessionInfo[]): void
  startForm: { open: boolean; cwd?: string; accountId?: string }; openStartForm(p?: { cwd?: string; accountId?: string }): void; closeStartForm(): void  // UI flag only, no IPC
}
export const useControlStore
export const selectControlForSession = (sessionId?: string) => (s) => ControlSessionInfo | undefined   // by sessionId
export const selectDraftControl = (s) => ControlSessionInfo | undefined                               // newest draft without sessionId
export const selectPendingPermissionCount = (s) => number
```
Stream reducer: typing replaces text; typing-clear removes; permission appends (dedupe by requestId);
permission-resolved removes; turn-end clears typing/thinking and appends an info/error notice ("Interrupted" for
interrupted); notices capped at 20. `applySessions` drops streams of removed sessions.
**R-19 test:** no action other than `send` calls `api.control.send`; `init()` never calls send/start.
useWorkspaceStore:
```ts
interface WorkspaceStoreState {
  workspace: WorkspaceSnapshot | null; watchedRoot: string | null; compare: { path: string; diffs: FileDiff[]; loading: boolean; error?: string } | null
  hooks: HooksStatus | null; hooksPreview: HooksPreview | null; hooksError?: string
  init(): () => void                                   // subscribe git.onChanged + hooks.onChanged
  watch(root: string | null): Promise<void>            // no-op when unchanged; also refreshes hooks status for that root
  openCompare(path: string): Promise<void>; closeCompare(): void
  refreshHooks(): Promise<void>; previewHooks(action: 'install' | 'uninstall'): Promise<void>; applyHooks(): Promise<OkResult>; clearPreview(): void
}
export const useWorkspaceStore
export function selectWorktreeViews(ws: WorkspaceSnapshot | null, agents: Agent[], platform: string): { worktrees: Worktree[]; overlaps: FileOverlap[] } // via toWorktreeViews; memo-friendly
```
Ignore pushes for a root other than `watchedRoot`. Preview result `{ok:false, reason}` -> `hooksError`. Platform for
mapping: `navigator.platform` starts with 'Win' -> 'win32' else 'linux'.
Tests mock `window.api` like tests/renderer/store.test.ts.

## Acceptance commands
- npm test -- tests/renderer/controlStore.test.ts tests/renderer/workspaceStore.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
