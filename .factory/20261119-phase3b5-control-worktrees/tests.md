# Tests (tests-first) - phase 3b/4/5 run

Run all: `npm test`. One file: `npm test -- <file>`. State when written: 1222 tests, 1136 pass (the 1125 pre-existing +
11 new guard cases that already hold), 86 fail, 27 files fail. Every failure is a missing module/export/field
(`Cannot find module`, `X is not a function`, `expected undefined ...`), never a broken test.
Renderer tests are NOT written here (owned by T12, T14-T18, T20, T22). Existing tests were not weakened except two
exact-count cases in `tests/shared/ipcContract.test.ts` (see T01).

## Files by task

| Task | Test file(s) | R-ids |
|---|---|---|
| T01 | tests/shared/ipcContract.test.ts (appended "contract v4" block; two exact-set cases relaxed to "contains" because T01 adds pushes), tests/main/ipcValidatorsV4.test.ts (new: validators + mock stubs) | R-01, R-19 |
| T02 | tests/main/control/protocol.test.ts, args.test.ts, tests/shared/agentMessage.test.ts, tests/shared/displayPath.test.ts | R-02, R-06, R-26 |
| T03 | tests/main/git/gitParse.test.ts, tests/shared/overlap.test.ts | R-08, R-10 |
| T04 | tests/main/hooks/hookPayload.test.ts, hookInstaller.test.ts | R-14, R-17 |
| T05 | tests/main/hooks/hookServer.test.ts (server + endpointFile + hookRuntime), hookScript.test.ts | R-15, R-16, R-21 |
| T06 | tests/main/transcripts/taskTracker.test.ts, activitySpans.test.ts, parseLineTasks.test.ts (task cases in their own file instead of editing parseLine.test.ts) | R-11, R-12 |
| T07 | tests/main/control/controlSession.test.ts (R-19 stdin recorder + lifecycle), controlManager.test.ts, processTree.test.ts; helper tests/main/control/harness.ts (fake child, manual timers) | R-03, R-19, R-07 |
| T08 | tests/main/git/worktreeService.test.ts | R-09 |
| T09 | tests/main/transcripts/sessionModelHooks.test.ts, tests/shared/liveStatusHooks.test.ts (new files; T09 may fold them into sessionModel.test.ts / liveStatus.test.ts) | R-11, R-12, R-18 |
| T10 | tests/main/control/externalKill.test.ts, tests/main/editor/openInEditor.test.ts, tests/main/hooks/hooksService.test.ts | R-07, R-17 |
| T21 | tests/main/attention/statusHub.test.ts, notifier.test.ts, prefs.test.ts | R-22, R-23, R-24, R-26, F1, F2, F3 |

## Manual / not covered here
- T05 hook script vs a REAL Claude process (async hooks deliver stdin): manual step 2 in plan.md.
- OS toast / taskbar flash / overlay rendering (notifier tests use fakes): manual check.
- Packaging, renderer, wiring (T11, T13: handlers/index; T11 service integration) - owned by those tasks.
- `hookScript.test.ts` spawns `process.execPath` on the copied script (plan "Test strategy" explicitly requires it); it never starts claude/git/code.

## Signature assumptions (the Notes did not pin these down; implementers please follow or tell me)
1. **IPC keys** are camelCase of the channel: `controlStart, controlSend, controlInterrupt, controlStop, controlAnswer, controlSetModel, controlSetMode, controlList, controlGetStream, sessionKillExternal, gitWatch, gitCompare, hooksStatus, hooksPreview, hooksApply, attentionGet, attentionGetPrefs, attentionSetPrefs` (invoke); `controlChanged, controlStream, gitChanged, hooksChanged, attentionChanged, attentionFocus` (push). PUSH_CHANNELS total = 14. Preload must mention `IPC.<key>` for each and the names `control, git, hooks, attention, killExternal, start, send, interrupt, stop, answer, setModel, setMode, getStream, watch, compare, status, preview, apply, getPrefs, setPrefs, onStream, onFocus`.
2. **handlers.ts mock stubs** are looked up as `createHandlers()['control:start'](event, ...args)` (same shape as ipcHandlers.test.ts); stubs return `{ok:false}` (bad args -> `reason:'invalid-args'`), `[]`, `null`, empty snapshot per T01.
3. **protocol.ts**: delta `messageId` = `stream_event.api_message_id`; `message-start.messageId` = `event.message.id`; `signature_delta` is not a `delta`; unknown `system` subtypes -> `{t:'other', type:'system', subtype}`; `can_use_tool` without tool_name is not `can-use-tool`; `result.text` = `result` field.
4. **agentMessage**: `routeConsoleInput('@name')` with no text -> `{kind:'error'}` (reason unspecified); `@lead x` -> `{kind:'send', text:'x'}` (no targetAgentId).
5. **displayPath**: `shortenPath` of the root itself is not asserted exactly; temp collapse uses `‹tmp›/<last 2 segments>`.
6. **gitParse**: committed-only entries from `mergeChanged` get a letter in `[MADRU?]` (not asserted further); `pickBase` only tested when `originHead` exists or is null.
7. **overlap.mapAgentsToWorktrees** may omit worktrees without agents (tests use `.get()` only for worktrees that have agents).
8. **hookInstaller**: previews expire via `Date.now()` (test uses fake timers); `apply` of a missing previewId -> `reason:'expired'`; preview refusal reasons contain `invalid-json` / `not-object` / exactly `nothing-to-do`; uninstall of a file we created gives `after: null` and `remove(path)` on the fs.
9. **hookServer**: `onEvent` gets the object returned by `deps.parse`; `stats().rejected` counts every non-204 after the method/path check; oversize body answers 413 or resets the socket.
10. **T07 harness**: manager `send()` may resolve before or after `system/init` (tests emit init right after spawn, so both work); `streamState(id).permissions` are `PermissionPrompt[]`; stop() resolves after the child exit event; `stop` on a busy session writes an interrupt frame then ends stdin; pending permissions on stop are answered with deny "Session stopped".
11. **T08**: `watch()` resolves with the first completed snapshot; identical cycles do not push (`now()` is constant in tests); compare invalid input returns `[]` or rejects (both accepted) and runs no git.
12. **T09**: `hooksActive` on `TeamSnapshot` = a hook event within 10 min of the snapshot clock; `deriveLiveStatus` hook reasons `'hook-permission'`, `'hook-notification'`; `HOOK_STALE_MS = 30 min`; a finished agent beating the hook flag is not asserted.
13. **T10 hooksService**: `status()` reads `eventsReceived` / `lastEventAt` from `server.stats()`; `status()` may call `installScript()` to know the script path (needed to decide `installed` vs `outdated`); the event -> `onHook` forwarding method is NOT tested (the Notes list no method for it) - T10 should expose and test it; the 2 s throttled onChanged after events is likewise not tested.
14. **T21 statusHub**: needs `sessionFile(s)`; item `input` = capped prompt `inputPreview` (string, <= ~4 kB); `needsYou` counts `severity:'blocked'` only; idle count field name is unspecified (not asserted); `hooksActive` tested only through hook events (the "installed" half of F3 has no dep in `StatusHubDeps`, add one and tell me); registry `waiting` -> `input`/blocked, registry `idle` after an assistant end_turn -> `input`/idle; hook `idle_prompt`/`agent_completed` -> idle.
15. **T21 notifier**: clock = `Date.now()`; "+N more" appears in the text of a shown toast; overlay/flash count = blocked items (unmuted for flash); api-error is blocked (counts) but toasts only with `notifyErrors`; no pref name for enabling idle toasts is assumed.
16. **T21 prefs (name guessed, Notes give none)**: `createAttentionPrefs({ filePath, fs:{readText,writeTextAtomic,mkdirp} })` -> `{ load(), save(p) -> {ok,reason?}, get() }`; corrupt/invalid file -> defaults `{mutedProjects:[],dnd:false,notifyErrors:false}`; unknown keys dropped; invalid save refused without writing.
