# T17 - Inspector actions, header buttons, Hooks dialog

- Wave: 6
- Depends on: T12, T14
- Spec refs: R-07, R-17, spec "Right column" actions + header buttons, hard rule 3
- Tests: tests/renderer/inspectorActions.test.tsx, tests/renderer/hooksDialog.test.tsx

## Goal
Make Message agent / Open worktree / Pause / Stop real per D2/D3, add "Stop process..." for external sessions behind
a confirm dialog, make header "Pause all" / "+ New teammate" real per D4, and add a header "Hooks" button with the
preview/install/uninstall dialog.

## Owned files
- modify: src/renderer/src/components/inspector/Inspector.tsx (keep T14's `topHeight` / `splitter` props)
- modify: src/renderer/src/components/inspector/inspector.css
- modify: src/renderer/src/components/inspector/FilesTab.tsx (path shortening only)
- modify: src/renderer/src/components/team/TeamHeader.tsx
- create: src/renderer/src/components/team/HooksDialog.tsx
- create: tests/renderer/inspectorActions.test.tsx
- create: tests/renderer/hooksDialog.test.tsx
- modify (cases broken by the change only): tests/renderer/inspector.test.tsx, tests/renderer/inspectorLive.test.tsx,
  tests/renderer/teamSections.test.tsx (header cases only; worktree/task cases must stay as they are)

## Read-only context
- src/renderer/src/store/{useControlStore,useWorkspaceStore,useConsoleStore}.ts, src/renderer/src/components/ui/Dialog.tsx
- src/shared/agentMessage.ts, plan.md Decisions D2-D4, D11

## Notes
- `control = selectControlForSession(team.sessionId)`; `controlled = !!control && control.state !== 'exited'`;
  external = live team, not controlled. The selected session's summary (`sessions.find(s => s.sessionId ===
  team.sessionId)`) gives `live`, `entrypoint` and `registryPid` (T01 type, filled by T11 from the registry).
- Message agent (Inspector): controlled -> small inline composer (textarea + Send) -> lead: `send(id, text)`;
  sub-agent: `send(id, formatAgentMessage(agent.name, text))`. External: disabled + D2 tooltip.
- Pause: controlled & busy -> `interrupt(id)` (tooltip for sub-agents: "Interrupts the whole current turn");
  otherwise disabled with reason (idle / external / demo).
- Stop: controlled -> `stop(id)` (confirm only when busy). External live with `registryPid` -> "Stop process..."
  opens Dialog: pid, cwd, entrypoint label, "Ends this Claude Code process and its tool processes. The transcript is
  kept; the turn in progress is lost." Buttons Cancel (default focus) / Stop process (danger) ->
  `api.session.killExternal(...)`; show the reason on failure. Never kill without this confirm.
- Open worktree: unchanged behaviour, path = matching worktree from `selectWorktreeViews` for the agent, else `agent.cwd`.
- **UX M4 (bug fix, do first):** the account chip, its colour and the 3 px top edge use the **viewed session's**
  account: `team.accountId` when `team.source === 'live'` (map '' to the default-dir account, else "Default
  account"), otherwise the active/default account as today; demo keeps the mock. Test: a personal-account session
  shows the personal colour while the default account is the company one.
- Stop-process dialog names project, session title, pid, account and entrypoint (UX S5).
- FilesTab: paths via `shortenPath` (root = project root or team.cwd), full path in title.
- **Header, revised by UX S5:** "Pause all" becomes "Pause all in <project>" =
  `interrupt` every busy controlled session of the viewed project (not the global pause-all); disabled title "No
  controlled session is busy in <project>". "+ New teammate" becomes "+ New session in <project> as <account>"
  (account from the folder-rule resolution of the project root) and opens the T15 start form; `start(req)` only after
  the user confirms the form; never sends. The teammate prefill lives in the ControlBar (T15). The existing needs-you
  counter is labelled "in this session".
- Hooks button (header, label "Hooks: on|off|partial|n/a"): opens HooksDialog: status text + reason, project path,
  Install / Uninstall -> `previewHooks(action)` -> shows settings path, backup path, script path, notes and the full
  `after` JSON (mono, scrollable) with a "before" toggle; "Write file" (danger-styled primary) -> `applyHooks()`;
  errors shown; Cancel clears preview. Nothing is written without the explicit "Write file" click (hard rule 3).
If `registryPid` is missing, "Stop process..." stays disabled with tooltip "Process id unknown".
Tests: action enable/disable matrix (demo, external idle, external live, controlled idle/busy), message formatting,
confirm dialog required before killExternal, pause-all, new teammate prefill without send, hooks preview + apply flow.

## Acceptance commands
- npm test -- tests/renderer/inspectorActions.test.tsx tests/renderer/hooksDialog.test.tsx tests/renderer/inspector.test.tsx tests/renderer/inspectorLive.test.tsx tests/renderer/teamSections.test.tsx tests/renderer/teamLive.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
