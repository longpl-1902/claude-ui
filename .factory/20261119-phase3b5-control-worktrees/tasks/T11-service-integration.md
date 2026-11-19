# T11 - Accounts launch for controlled sessions; transcript service: control hint, flags, hooks

- Wave: 4
- Depends on: T01, T07, T09
- Spec refs: R-04, R-05, R-18
- Tests: tests/main/accounts/accountsService.test.ts, tests/main/transcripts/sessionIndex.test.ts, tests/main/transcripts/transcriptService.test.ts

## Goal
Controlled sessions use the same launch safety as the pty and count as running for the account lock; the transcript
service auto-selects them, marks them in the session list, ingests hook events and reports file-edit activity.

## Owned files
- modify: src/main/accounts/accountsService.ts
- modify: src/main/transcripts/sessionIndex.ts
- modify: src/main/transcripts/transcriptService.ts
- modify: src/main/transcripts/usageToday.ts
- modify: tests/main/accounts/accountsService.test.ts
- modify: tests/main/transcripts/sessionIndex.test.ts
- modify: tests/main/transcripts/transcriptService.test.ts
- modify: tests/main/transcripts/usageToday.test.ts (new cases only)

## Read-only context
- src/main/control/controlManager.ts (T07 interface), src/main/transcripts/sessionModel.ts (T09 `applyHook`)
- src/shared/types.ts (ControlStartRequest/Result, HookEvent, SessionSummary.controlled)
- plan.md Decisions D1, D5, D6

## Notes
accountsService:
- New optional dep `control?: { create: ControlManager['create']; running: () => { cwd: string; accountId: string }[] }`
  (running = controlled sessions in starting/idle/busy). `claudeSessions()`/lock/`sessions` include them
  (RunningSession with `ptyId` undefined).
- New method `launchControlled(req: ControlStartRequest): Promise<ControlStartResult>`: same validation as
  `launchClaude` (expandHome, absolute, exists, serial block, checkWith, needs-confirmation, profile, configDirAbs
  null for the default dir) then `control.create({...})` -> `{ok:true, controlId}`. It never spawns (D1).
sessionIndex:
- `PtyHint` gains `sessionId?: string`. `pickFromPty`: when `sessionId` is set, `findSession(own, accountId, sessionId)`
  first (null while the file does not exist yet -> waitingForSession).
transcriptService:
- Dep `controlHint?: () => PtyHint | null` (newest controlled session with state != draft/exited; T13 wires it). In
  `applyAuto`, the hint used is `controlHint() ?? ptyHint()`; the stability rule treats a control hint like a pty.
- Dep `controlledSessions?: () => { sessionId: string; controlId: string }[]`; `listSessions` sets `controlled`,
  `controlId`. In sessionIndex `listSessions`, set `registryPid` from the live registry entry (pid) and `entrypoint`
  from the registry entry when present, else from the head line's `entrypoint` field (readMeta already parses the head).
- `ingestHook(e: HookEvent): void`: if `selected` and `e.sessionId === selected.pick.sessionId` -> `model.applyHook(e)`
  -> markDirty + immediate tail of the selected files (same lane as the poll). Events for other sessions: if the
  session is unknown to the index, `scheduleSessions()` (SessionStart) - nothing else.
- `onActivity(cb: (kind: 'file-edit') => void)`: emitted (debounced 500 ms) when ingested records of the selected
  session contain a tool result with `fileChange` or an Edit/Write tool use; T13 wires it to worktreeService.poke().
- `isSessionLive(accountId: string, sessionId: string): Promise<boolean>` via the registry (for D6).
- `onFileChange(cb: (path: string) => void)`: forwards every watched `*.jsonl` change path (all projects) so the
  attention hub (T21, wired in T13) can tail live sessions.
- Per-project tokens today (UX S2): usageToday gains `todayByProject(): Record<string, TokenTotals>` keyed by an
  injected `projectKeyOf(filePath)` (transcriptService passes: resolver-cached `SessionProject.key` of the file's
  session cwd, else the provisional key from the encoded project dir); existing `byAccount`/`UsageToday` unchanged.
  transcriptService exposes `usageByProject()`. Same dedupe by message.id as byAccount.
- `onPtyChanged()` is also called by T13 when control sessions change; no new trigger logic needed.
Tests: launchControlled blocked/locked/needs-confirmation/ok (no spawn), lock includes a running controlled session,
pickAuto with hint sessionId, controlled flag in list, ingestHook changes snapshot only for the selected session,
onActivity debounced, isSessionLive.

## Acceptance commands
- npm test -- tests/main/accounts tests/main/transcripts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
