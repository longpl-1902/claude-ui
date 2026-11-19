# T29 - Session controls: model/effort/mode/output-style pickers, context meter, cost, MCP chips, rewind & fork

- Wave: 11
- Depends on: T26, T27
- Spec refs: R-29, R-30, R-32
- Tests: tests/renderer/sessionControls.test.tsx

## Goal
VS Code-level session controls in the ControlBar: model list from the CLI, effort, permission mode, output style,
a context-window meter, last-turn and session cost, live MCP server chips with toggle/reconnect, session rename, and a
checkpoint list to rewind files or fork the conversation from an earlier prompt.

## Owned files
- modify: src/renderer/src/components/team/ControlBar.tsx
- create: src/renderer/src/components/team/ContextMeter.tsx
- create: src/renderer/src/components/team/McpChips.tsx
- create: src/renderer/src/components/team/RewindDialog.tsx
- create: tests/renderer/sessionControls.test.tsx

## Read-only context
- src/renderer/src/store/{useDetailsStore,useControlStore}.ts, src/renderer/src/components/ui/Dialog.tsx, plan.md PD1-PD8

## Notes
- Model select: `details.models` (displayName, description) when present, else the D8 static list; Effort select
  (low/medium/high/xhigh/max; "default"); Output style select from `availableOutputStyles`; on a draft they are stored
  for the launch, on a running session `setModel` / `setEffort` / `setOutputStyle` (hint "applies from the next turn").
- ContextMeter: bar `percentage` of `maxTokens` with label "62% context (124k / 200k)", tooltip with categories,
  refresh button (`refreshContext`); amber >= 75 %, red >= 90 %. Cost: last turn tokens (in/out/cache) and
  `costUsd`, session total; label "API-equivalent cost" (subscriptions are not billed per token).
- McpChips: one chip per `details.mcp` server with status colour; menu: Disable/Enable for this session
  (`mcpToggle`), Reconnect; `needs-auth` shows "Authenticate in the Raw terminal: /mcp" (no OAuth flow in-app, PD6);
  link "Manage servers…" -> navigate('extensions').
- Rename: inline edit of the session title -> `rename`.
- RewindDialog (button "Checkpoints"): lists `details.userTurns` newest first; per row "Rewind files…" ->
  `rewindPreview` -> shows filesChanged/insertions/deletions -> confirm "Restore files" -> `rewind`; and "Fork from
  here" -> `forkAt` (creates a draft; the user sends the next prompt). Disabled while busy with a reason. Explain:
  "Rewind restores files edited by Claude in this app session; the conversation is kept (use Fork to branch it)."
Tests: pickers per state (draft vs running), meter thresholds, MCP toggle call, rewind requires preview + confirm,
fork creates a draft without send.

## Acceptance commands
- npm test -- tests/renderer/sessionControls.test.tsx tests/renderer/leadControl.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.
