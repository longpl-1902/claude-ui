# T26 - Control manager v2 (details, MCP, context, rewind/fork, images) + main wiring v5

- Wave: 10
- Depends on: T23, T24, T25
- Spec refs: R-27, R-29, R-30, R-31, R-32, R-19
- Tests: tests/main/control/controlV2.test.ts, tests/main/ipcHandlers.test.ts

## Goal
The control manager correlates control requests with responses, fetches session details with local-only requests,
and exposes MCP toggle/reconnect, context usage, rewind/fork-at, rich turns, effort/output style, rename and plan.
Handlers and app startup wire this plus the T25 catalog/CLI services.

## Owned files
- modify: src/main/control/controlSession.ts
- modify: src/main/control/controlManager.ts
- create: tests/main/control/controlV2.test.ts
- modify: src/main/ipc/handlers.ts
- modify: src/main/index.ts
- modify: tests/main/ipcHandlers.test.ts

## Read-only context
- src/main/control/{protocol,args}.ts (T24), src/main/catalog/* (T25), src/shared/types.ts + ipc.ts (T23)
- plan.md "VS Code parity" decisions PD1-PD8; existing tests/main/control/*.test.ts must stay green

## Notes
- Request correlation: `request(id, req, timeoutMs = 10_000): Promise<unknown>` (request ids `ac-<n>`), resolves on the
  matching `control-response` body, rejects on error/timeout/exit.
- On spawn (still only from the user's first Send, D1): write `initialize` **before** the user turn, then the turn;
  on its response fill `ControlDetails` (commands/agents/models/output styles); after `init` add tools + mcp names;
  call `mcp_status` once after init. These are local requests (no model call) - documented in R-19 as allowed.
  After each `result`: `lastTurn` from result usage/cost, `sessionCostUsd += total_cost_usd`, and `get_context_usage`
  (local). `commands_changed` replaces commands. `user-echo` lines append `userTurns` (max 200). Push
  `control:details` on change (throttled 250 ms). `checkpointing` = true (spawn env sets `CHECKPOINT_ENV=1`).
- New manager methods (T23 channel names): `details`, `sendRich` (spawns like send), `refreshContext`, `mcpToggle`,
  `mcpReconnect` (then `mcp_status`), `fileSuggestions(id, query)` (running only), `rewindPreview` (dry_run) /
  `rewind` (real; refused while busy), `forkAt(id, uuid)` -> creates a **draft** `{resume: {kind:'resume',
  sessionId, fork:true}, resumeAt: uuid}` (nothing spawns), `setEffort`/`setOutputStyle` (running ->
  `apply_flag_settings`; draft -> stored for args), `rename`, `getPlan`. All refuse on draft/exited with 'not-running'
  except where noted.
- Answers with `answers` (AskUserQuestion) -> `encodeAllowWithAnswers`; only when the stored tool_name is
  AskUserQuestion, values strings <= 2000.
- handlers.ts: real handlers for every T23 channel with the T23 validators. `control:file-suggestions` with id null or a
  non-running session -> `git -C cwd ls-files -co --exclude-standard` (cached 30 s, max 20 000 paths) fuzzy-filtered
  in main (subsequence match, top 50). `catalog:list` -> resolve the account's configDir, `claudeCli.pluginList` (cached
  5 min; refreshed by `plugins:list`) for install paths, then `catalog.list`. `catalog:open` -> `openInEditor` for
  files (path must be one returned by the last catalog list - keep a Set). `mcp:*`, `plugins:*`, `cli:apply` ->
  claudeCli with configDir from the account (null for the default dir).
- index.ts: create catalog + claudeCli with real fs/exec; push `control:details`.
- **R-19 test:** a recording fake child shows that `initialize`, `mcp_status`, `get_context_usage` are control
  requests only, and no user frame is written except from send/sendRich.

## Acceptance commands
- npm test -- tests/main/control tests/main/ipcHandlers.test.ts tests/shared/ipcContract.test.ts
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass
- Only owned files changed
