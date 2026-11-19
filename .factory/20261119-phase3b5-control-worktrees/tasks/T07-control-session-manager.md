# T07 - Controlled session runtime (child process, state machine, permissions, kill tree)

- Wave: 3
- Depends on: T01, T02
- Spec refs: R-03, R-19, spec Phase 3b
- Tests: tests/main/control/controlSession.test.ts, tests/main/control/controlManager.test.ts

## Goal
Run app-controlled Claude Code sessions over stream-json: a draft is created without any process; the user's first
send spawns `claude` with the account env; turns, interrupts, permission prompts, model/mode changes and stop work;
everything is reported as `ControlSessionInfo` and batched `ControlStreamEvent`s.

## Owned files
- create: src/main/control/controlSession.ts
- create: src/main/control/controlManager.ts
- create: src/main/control/processTree.ts
- create: tests/main/control/controlSession.test.ts
- create: tests/main/control/controlManager.test.ts

## Read-only context
- src/main/control/protocol.ts, args.ts (T02)
- src/main/pty/childEnv.ts (`buildChildEnv`), src/main/pty/claudeBinary.ts (`ClaudeCommand`)
- src/shared/types.ts (Control* types from T01)
- plan.md Verified facts 3-7, Decisions D1, D3

## Notes
```ts
export interface ChildLike { pid?: number; stdin: { write(s: string): boolean; end(): void }; stdout: { on(ev: 'data', cb: (b: Buffer) => void): void }; stderr: { on(ev: 'data', cb: (b: Buffer) => void): void }; on(ev: 'exit', cb: (code: number | null) => void): void; on(ev: 'error', cb: (e: Error) => void): void; kill(): void }
export type SpawnFn = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; windowsHide: true }) => ChildLike
export interface ControlManagerDeps { spawn: SpawnFn; resolveClaude: () => ClaudeCommand | null; baseEnv: Readonly<Record<string, string | undefined>>; platform: NodeJS.Platform; killTree: (pid: number) => Promise<void>; now?: () => Date; newId?: () => string; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void }
export interface ControlManager {
  create(o: { cwd: string; accountId: string; configDirAbs: string | null; model?: string; permissionMode: ControlPermissionMode; resume?: ControlResume }): ControlSessionInfo // state 'draft'; NO spawn, NO write
  send(id: string, text: string): Promise<OkResult>              // spawns when draft/exited, then writes encodeUserTurn
  interrupt(id: string): OkResult                                // only when busy; control_request interrupt
  interruptAll(): number                                         // busy sessions interrupted
  answer(id: string, requestId: string, a: PermissionAnswer): OkResult
  setModel(id: string, model: string | null): OkResult           // running: set_model request; draft: stored for args
  setMode(id: string, mode: ControlPermissionMode): OkResult     // running: set_permission_mode; draft: stored
  stop(id: string): Promise<OkResult>                            // interrupt if busy, end stdin, 3 s grace, then killTree(pid); draft -> removed
  remove(id: string): OkResult                                   // only exited/draft
  list(): ControlSessionInfo[]; get(id: string): ControlSessionInfo | undefined; streamState(id: string): ControlStreamState | null
  onChanged(cb: (l: ControlSessionInfo[]) => void): () => void; onStream(cb: (e: ControlStreamEvent[]) => void): () => void
  disposeAll(): void                                             // tree-kill every live child (app quit)
}
export function createControlManager(deps: ControlManagerDeps): ControlManager
```
- Spawn: `resolveClaude()` (null -> `{ok:false, reason:'claude-not-found'}`), file/argsPrefix + `buildControlArgs`,
  env = `buildChildEnv(baseEnv, {configDirAbs, platform})`. After a resume/continue/fork has been used once, a later
  respawn of the same draft uses `{kind:'resume', sessionId}` (the known id) so history continues.
- States: draft -> starting (spawned) -> idle on `init` -> busy on send / `status requesting` -> idle on `result`;
  stopping; exited on exit (exitCode, `error` = last 2 KB of stderr when code != 0, ANSI stripped). `sessionId` from init.
  Sending while busy writes immediately and increments `queuedTurns` (decremented per `result`).
- Stream events: `typing` (accumulate text deltas of the current top-level message; `parentToolUseId !== null`
  ignored), `typing-clear` on assistant/result, `thinking` on thinking block start/stop, `permission` on
  `can-use-tool` (prompt built with `inputPreview`, stored with its input), `permission-resolved` after answer,
  `turn-end` on result (`error_during_execution` right after our interrupt -> 'interrupted'; is_error -> 'error'),
  `notice` for spawn errors/exit. Batch pushes every 50 ms; `onChanged` on state/pending changes.
- Unknown CLI `control-request` -> `encodeUnsupported`. Pending permissions are denied with "Session stopped" on stop.
- Answer allow = `encodeAllow(requestId, storedInput)`; `scope: 'session'` adds
  `sessionScopedSuggestions(storedSuggestions)` (refused with 'no-session-rule' when empty);
  `PermissionPrompt.canAllowSession` = that list is non-empty. Deny message default "Denied in Agent Console".
  Answers work for any controlId regardless of which session the UI is viewing.
- **R-19:** no write happens except from send/answer/interrupt/setModel/setMode/stop and the automatic
  `encodeUnsupported` reply. No retries, no initialize, no keep-alive. Test with a recording fake child: create ->
  zero spawns, zero writes; one send -> exactly one spawn and one user frame.
processTree.ts: `createKillTree(exec, platform)` -> win32 `taskkill /PID <pid> /T /F` (execFile, windowsHide, 5 s,
errors swallowed when the process is already gone); posix `process.kill(pid, 'SIGTERM')` then SIGKILL after 2 s if
alive. Also `createImageName(exec, platform)` -> `(pid) => Promise<string | null>` (win32 `tasklist /FI "PID eq <pid>" /FO CSV /NH`
parsed first CSV field; posix `ps -p <pid> -o comm=`), used by T10. Export a pure `parseTasklistCsv(out)` and test it.
Tests use fake timers, a fake child emitting hand-written lines (shapes from plan facts 3-6, synthetic ids).

## Acceptance commands
- npm test -- tests/main/control
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
