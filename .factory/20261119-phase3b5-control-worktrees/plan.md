# Plan: Agent Console - Phases 3b + 4 + 5 + 6 and resizable layout (one run, no stops)

## Goal
When this run is done, Agent Console can **drive** a Claude Code session it started (stream-json), answer its
permission prompts, interrupt/stop it, and resume/continue/fork sessions; it shows **worktrees, overlaps, shared
tasks and timeline swimlanes** from git and transcripts; it receives **realtime hook events** through an explicit,
previewed hook install; every column is **vertically resizable**; and Phase 6 polish (empty/error states,
keyboard shortcuts, Windows packaging check, README) is done. There is no plan gate: execute straight away.

Requirements:
- R-01 Contract v4: new IPC channels/types for control, external kill, git workspace, hooks (T01). Contract test updated.
- R-02 Stream-json protocol: pure parser for every verified output line type, encoder for user turns, control
  responses (allow/deny), control requests (interrupt, set_model, set_permission_mode), CLI arg builder. Tests (T02).
- R-03 Controlled session lifecycle: lazy spawn on the first user send, account env (CLAUDE_CONFIG_DIR / unset), queued
  turns, interrupt, stop (tree kill after grace), permission round-trip, exit/crash handling, stderr tail (T07).
- R-04 Launch safety: same folder-rule check, personal-in-company confirmation and account lock as the pty; resuming a
  session that is live elsewhere is refused (fork offered) (T11, T13).
- R-05 Controlled sessions appear in the session picker (badge "controlled"), Auto prefers the newest controlled
  session; the live view stays transcript-based (Phase 3) and the stream only adds a "typing" row + permission cards
  (no duplicated messages) (T11, T15).
- R-06 Lead console control UI: start / resume / continue / fork, model + permission-mode pickers, prompt + slash
  autocomplete (from `system/init.slash_commands`), `@agent` routing, Allow/Deny cards, Interrupt, raw xterm toggle kept (T15).
- R-07 Inspector + header actions: Message agent, Pause, Stop, "Stop process" for external sessions (confirm dialog,
  re-validated pid), Open worktree (`code <path>`), Pause all, + New teammate (T10, T17).
- R-08 Git porcelain parsers, base detection, Windows path normalization (T03).
- R-09 Worktree service: 5 s poll + change triggers, never overlapping runs, timeouts, `--no-optional-locks`,
  Compare diffs (T08).
- R-10 Overlap detection (file changed in >= 2 worktrees) + agent->worktree mapping by cwd. Tests (T03).
- R-11 Shared tasks from TaskCreate/TaskUpdate/TaskList (TodoWrite fallback): done / in progress / pending / blocked by
  #n / failing (T06, T09, T16).
- R-12 Timeline swimlanes per agent, last 20 min, think/read/edit/bash/wait/error + legend (T06, T09, T16).
- R-13 Horizontal splitters: center (grid | timeline | console), left (worktrees | tasks), right (inspector top | tabs);
  same a11y/keyboard/persistence rules as the existing Splitter (T14).
- R-14 Hook payload parser (16 verified events), never throws, truncates, drops tool inputs/outputs (T04).
- R-15 Hook server: 127.0.0.1 only, random port, per-launch random token header (timing-safe), Host check, POST /hook
  only, 1 MiB cap, endpoint handoff file in userData (T05).
- R-16 Hook script `agent-console-hook.cjs`: reads stdin, POSTs, always exits 0 within ~1.5 s, silent when the app is
  closed; installed as an `async` exec-form hook so Claude never waits (T05).
- R-17 Hook installer: explicit button, preview of the exact JSON, Install/Uninstall, merge/unmerge only our entries,
  refuse invalid JSON or a file changed since preview, one-time backup (T04, T10, T17).
- R-18 Realtime merge: hook events update the selected session model (needs-you on PermissionRequest /
  Notification permission_prompt, cleared by the next tool/stop event; SubagentStop finishes; instant tail poke) (T09, T11).
- R-19 **No autonomous token spend.** The app never sends anything to Claude on its own: no warm-up, keep-alive,
  retry, summary or auto-resume. A stream-json process is spawned only by the user's first Send; "+ New teammate",
  "Pause all", resume etc. happen only on explicit clicks; interrupts/mode/model changes are control requests that
  do not create turns. Tests: T07 (stdin recorder: only user-initiated frames; creating a session writes nothing and
  spawns nothing), T12 (store never calls `control.send` except from `send()`), T13 (no handler sends on startup).
- R-20 Phase 6: empty/error states pass, keyboard shortcuts (help overlay + README), Windows packaging config
  (`extraResources` hook script, `publish` so `dist/latest.yml` is produced), README setup steps (T18, T19, T20).
- R-22 (UX M1) Project rail replaces the Project select: per-project worst-state badge (needs-you > running >
  waiting), account stripe (split + warning when live sessions use 2 accounts), pins, idle group, stable order (T21, T22).
- R-23 (UX M2) Global "Needs you" inbox across all projects from a light status model of every live session + hooks +
  controlled prompts; inline Allow / Allow for this session / Deny only for app-controlled sessions, "Go to" + "Open in
  VS Code" for external ones (T21, T22).
- R-24 (UX M3) OS toast for new needs-you items, taskbar flash + overlay count, per-project mute, Do-not-disturb,
  AppUserModelID (T21, T13).
- R-25 (UX M4, M5, S1) Chrome shows the viewed session's account; per-project view state restored on switch; Auto
  never switches while a draft/approval is open; Ctrl+K switcher, Ctrl+1-9 pinned, Ctrl+J next needs-you,
  Ctrl+B / Ctrl+I column collapse (T14, T17, T18, T22).
- R-26 (UX S2-S5) Tokens today across projects (header + per-project), grid sorted by need with finished collapsed and
  compact density, active-only timeline lanes, console filter + project-relative paths, scoped action labels (T02,
  T11, T15, T16, T17, T20).
- R-21 Privacy/tests: synthetic fixtures only ("acme", `C:/Users/u`), hook bodies/tokens never logged, no reads of
  credentials or `.key` files, nothing written under Claude dirs except the user-approved `settings.local.json`.
  Existing tests keep passing or are updated by the owning task.

## Verified facts / spec mismatches
Checked 2026-11-19 on this PC. Only shapes (keys/types/enums) recorded.
1. **Installed CLI is now 2.1.328** (npm global, `bin/claude.exe`; `claudeBinary.ts` resolution unchanged). VS Code
   extension bundles 2.1.326. The request said 2.1.309: reality differs, nothing depends on the exact minor.
2. **Flags (help + binary):** `-p`, `--input-format stream-json`, `--output-format stream-json`, `--verbose`
   (the VS Code extension always passes it with stream-json), `--include-partial-messages`, `--model <alias|name>`
   (aliases in help: fable, opus, sonnet; `haiku` resolved too), `--permission-mode` choices `acceptEdits|auto|
   bypassPermissions|manual|dontAsk|plan` (**`manual` = alias of `default`**; control `set_permission_mode` accepts
   `default|acceptEdits|bypassPermissions|plan|dontAsk|auto`), `-r/--resume <id>`, `-c/--continue`, `--fork-session`,
   `--session-id <uuid>`, `--replay-user-messages`, `--permission-prompts host|none` (new, default host).
   **`--permission-prompt-tool` is hidden from help but present**; the SDK and the VS Code extension pass
   `--permission-prompt-tool=stdio` to receive `can_use_tool` control requests. We pass `--permission-prompt-tool stdio`.
3. **Input (stdin, NDJSON):** user turn `{type:"user", message:{role:"user", content:string}, parent_tool_use_id:null,
   session_id:""}` (worked). Control request `{type:"control_request", request_id, request:{subtype, ...}}`.
   Control response `{type:"control_response", response:{subtype:"success", request_id, response:{...}}}` or
   `{subtype:"error", request_id, error}`.
4. **Permission (verified live):** CLI sends `{type:"control_request", request_id, request:{subtype:"can_use_tool",
   tool_name, display_name, input, tool_use_id, description?, permission_suggestions?, blocked_path?,
   decision_reason?, decision_reason_type?, ...}}`. Answer allow `{behavior:"allow", updatedInput:<input>}` (worked) or
   deny `{behavior:"deny", message, interrupt?}`; optional `updatedPermissions`, `toolUseID`. Auto-allowed tools
   (e.g. a harmless `echo`) do not prompt; `tool_result_meta[].permission_decision` reports the decision.
5. **Output events (verified live):** `system/init` {session_id, cwd, model, permissionMode, tools[], slash_commands[],
   agents, skills, mcp_servers, claude_code_version, ...}; `system/status` {status:"requesting"}; `system/hook_started`,
   `system/hook_response`, `system/thinking_tokens`; `stream_event` {event: message_start | content_block_start
   (text|thinking|tool_use) | content_block_delta (text_delta|thinking_delta|input_json_delta|signature_delta) |
   content_block_stop | message_delta (stop_reason) | message_stop, parent_tool_use_id, api_message_id};
   `assistant` (one per content block, `message.id`, `usage`, `aborted?`), `user` (tool results, `tool_use_result`,
   `tool_result_meta`), `rate_limit_event`, `result` {subtype success|error_during_execution|error_*, is_error,
   result?, session_id, stop_reason, usage, total_cost_usd, num_turns, permission_denials[], errors?[]}.
   Other subtypes exist in the binary (api_retry, compact_boundary, task_started/progress/notification,
   session_state_changed, ...): parser keeps them as `other`.
6. **Interrupt (verified live):** `control_request {subtype:"interrupt"}` -> `control_response success
   {still_queued:[]}`, then an `assistant` with `aborted:true`, then `result/error_during_execution`. A queued turn
   model exists (`queued_turn_count`, `cancel_queued`), so sending while busy queues the turn.
7. **Session id:** in `system/init` and every message. `--resume <id>` appends to the same transcript file with the
   same sessionId (one id in the file). Transcript `entrypoint` = **`sdk-cli`**. Stream-json sessions are not
   `kind: interactive` registry entries (registry writer is interactive-only) - the app knows the pid itself.
8. **Not used:** `initialize` control request (optional; init gives commands/model), `list_models` (needs a process),
   `stop_task {task_id}` (task ids are not mapped to sub-agents; Later).
9. **Task tooling:** `sdk-tools.d.ts`: TodoWrite {todos[{content,status pending|in_progress|completed,activeForm}]}
   -> {oldTodos,newTodos}; TaskCreate {subject,description,activeForm?,metadata?} -> {task:{id,subject}};
   TaskUpdate {taskId,status?(pending|in_progress|completed|deleted),addBlocks?,addBlockedBy?,owner?,subject?,...}
   -> {success,taskId,updatedFields,statusChange?{from,to}}; TaskList -> {tasks[{id,subject,status,owner?,blockedBy[]}]}.
   On disk (all transcripts): TaskCreate 18, TaskUpdate 33 (statuses in_progress/completed), task ids numeric strings,
   TaskStop 99 (background shells, not tasks), **TodoWrite 0**, TaskList 0. `~/.claude/tasks/session-*` dirs empty.
   No "failing" status exists: derived (decision below).
10. **Hooks (binary schemas):** events SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse,
   PostToolUseFailure, PostToolBatch, PermissionRequest, PermissionDenied, Notification, Stop, StopFailure,
   SubagentStart, SubagentStop, PreCompact, PostCompact, TeammateIdle, TaskCreated, TaskCompleted, WorktreeCreate,
   WorktreeRemove, CwdChanged, FileChanged, ConfigChange, ... Base payload {session_id, transcript_path, cwd,
   prompt_id?, permission_mode?, agent_id?, agent_type?, hook_event_name}. Notification {message, title?,
   notification_type: permission_prompt|idle_prompt|agent_needs_input|agent_completed|elicitation_*|auth_*|...}.
   PermissionRequest {tool_name, tool_input} (no tool_use_id). PreToolUse/PostToolUse {tool_name, tool_input,
   tool_use_id, tool_response?}. PostToolUseFailure {error, is_interrupt?}. SubagentStart {agent_id, agent_type};
   SubagentStop {agent_id, agent_type, agent_transcript_path, last_assistant_message?}. TeammateIdle {teammate_name,
   team_name}. TaskCreated/TaskCompleted {task_id, task_subject, teammate_name?}. SessionEnd {reason}.
11. **Hook command form:** `{type:"command", command, args?, async?, timeout?, shell?}`. With `args` the command is
   **spawned directly, no shell** (present in 2.1.328 and the extension's 2.1.326). `async:true` runs it in the
   background without blocking. Without `args`, Windows uses Git Bash or PowerShell - avoided. Matcher is optional.
   HTTP hooks (`type:"http"` + header env interpolation) also exist but the spec asks for a script, and a fixed URL
   cannot follow a random port.
12. **Git 2.53 (windows):** `worktree list --porcelain` blocks `worktree <path>` / `HEAD <sha>` / `branch refs/heads/x`
   | `detached`, plus `bare`, `locked [reason]`, `prunable [reason]`; paths use forward slashes and an **upper-case
   drive** (`D:/...`) while transcript cwds are `d:\...` -> compare with `normalizeForCompare`. `refs/remotes/origin/HEAD`
   is **not set** in this repo (fallback needed). `status --porcelain=v1 -z` renames emit `XY new\0old\0`.
   `diff --numstat -z`: `a\td\tpath\0`, rename `a\td\t\0old\0new\0`, binary `-\t-\t`. `rev-list --left-right --count
   base...head` -> `behind\tahead`. The VS Code extension runs git with `--no-optional-locks` (we do too).
13. **Kill on Windows:** `taskkill /PID <pid> /T /F` kills the tree (claude.exe spawns shells/MCP servers). Registry
   `<configDir>/sessions/<pid>.json` gives pid + sessionId + cwd + startedAt (Phase 3 fact 11). Before killing we
   re-read the entry (same pid + sessionId) and check the image name (`tasklist /FI "PID eq n" /FO CSV /NH` ->
   `claude.exe` or `node.exe`).
14. **`code` on Windows** is `code.cmd` (needs a shell). Its folder holds `..\Code.exe` and
   `..\resources\app\out\cli.js`; we spawn `Code.exe cli.js <path>` with `ELECTRON_RUN_AS_NODE=1`, no shell.
15. **Token use during verification:** two tiny headless runs (model haiku, one short prompt each, ~6 s each, in a
   scratch temp folder, default account) were made **before** the "no token spend" constraint arrived; one observed
   the permission round-trip, the other the interrupt. No further real runs are planned or needed.

## Decisions taken (defaults)
- **D1 Lazy start (R-19).** "Start session" only validates folder/account and creates a draft; the CLI is spawned on
  the user's first Send (with `--resume/--continue/--fork-session` when chosen). Stop ends stdin, waits 3 s, then
  tree-kills. Nothing is ever sent automatically; no retry after a crash (an error notice + a Send starts it again).
- **D2 Message agent.** App-controlled: lead = the text as-is. Sub-agent/teammate = a lead prompt formatted by
  `formatAgentMessage`: `@<name>: <text>` + one line "(Agent Console: forward this to the agent "<name>" with
  SendMessage if it is still running; otherwise handle it yourself.)". External sessions: disabled, tooltip "Runs in
  VS Code / another terminal - Claude Code has no API to send it messages from outside."
- **D3 Pause = interrupt** the controlled session's current turn (a sub-agent's Pause interrupts the whole turn; the
  tooltip says so). Stop = end the controlled session. External: Pause disabled; Stop -> "Stop process..." confirm
  dialog (pid, cwd, entrypoint, warning that the in-flight turn is lost), main re-validates before `taskkill /T /F`.
- **D4 Header (revised after UX S5).** "Pause all in <project>" = interrupt the busy controlled sessions of the viewed
  project only (no cross-project pause in v1). "+ New teammate" becomes "+ New session in <project> as <account>"
  (opens the start form; nothing spawns or sends until the user's first Send). "Ask lead to start a teammate" moves to
  the ControlBar and only prefills the prompt.
- **D5 Picker/transcript.** Controlled sessions are normal transcript sessions (entrypoint sdk-cli) with a
  "controlled" badge; Auto prefers the newest controlled session, then the app pty, then Phase 3 rules. The console
  log is the transcript console; the stream adds only a transient "typing" row (current assistant text, cleared on
  the next `assistant`/`result`) and permission cards.
- **D6 Resume rules.** "Resume here" is enabled for sessions not live in the registry; for live ones only "Fork
  here" (`--resume id --fork-session`). "Continue" = `--continue` in the chosen folder.
- **D7 Permission UI.** Cards pinned above the prompt input (tool, target/command preview, reason, Allow / Deny) and
  the same prompts as rows in the global inbox (answerable without switching project). "Allow for this session" is
  offered only when the CLI sent `permission_suggestions`; we resend them as `updatedPermissions` with
  `destination` forced to `session` (in-memory, never a settings file - hard rule 3). Schema-verified, not live-tested.
- **D8 Models/modes.** Model picker: Account default, opus, sonnet, haiku, fable, Custom (validated
  `^[A-Za-z0-9._\[\]-]{1,64}$`). Modes: default, acceptEdits, plan, auto, dontAsk. `bypassPermissions` not offered.
- **D9 Failing task** = not completed and the owner's newest tool result after the task went in_progress failed
  (failingCount = consecutive failures). Blocked = any `addBlockedBy` task not completed. Owner = `owner` input, else
  the agent that set in_progress, else creator. TodoWrite is used only when no Task* calls exist (ids = 1..n).
- **D10 Git.** Base = `origin/HEAD` target, else first existing of `main`, `master`, `origin/main`, `origin/master`;
  none -> ahead/behind/committed diff skipped. Changed files = committed (`base...HEAD`) union uncommitted (status).
  Only the selected project is watched. Poll 5 s; triggers: gitdir HEAD/index watchers + "file edited" activity from
  the selected session (debounced 500 ms); a run never overlaps (pending flag); 4 s timeout per git call; 3 worktrees
  in parallel; file lists capped at 500 per worktree.
- **D11 Hooks.** Installed into `<projectRoot>/.claude/settings.local.json` for 16 events (SessionStart, SessionEnd,
  UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Notification,
  Stop, StopFailure, SubagentStart, SubagentStop, TeammateIdle, TaskCreated, TaskCompleted), entry
  `{type:"command", command:<absolute node.exe>, args:[<userData>/hook/agent-console-hook.cjs], async:true, timeout:10}`.
  Node is required (resolved on PATH at preview time; missing -> state `unavailable` with a reason). The script is
  copied from app resources to `<userData>/hook/` (stable path across updates). Handoff: `<userData>/hook/endpoint.json`
  `{port, token, pid}` written atomically on server start (mode 0600; per-user `%APPDATA%` ACL on Windows), deleted on
  quit; the script reads it next to itself, so no env is needed. A one-time backup
  `settings.local.json.agent-console.bak` is written before the first change and shown in the preview.
- **D12 Shortcuts (revised).** Ctrl+K project switcher; Ctrl+1..9 pinned projects; Ctrl+J / Ctrl+Shift+J next /
  previous needs-you; Ctrl+L focus prompt; Ctrl+Shift+T / Ctrl+Shift+A Team / Accounts; Ctrl+B / Ctrl+I collapse left /
  right column; Ctrl+` raw terminal; Ctrl+. interrupt the viewed controlled lead; Alt+Up / Alt+Down previous / next
  agent; inbox row A / D / Enter; `?` help; Esc closes dialogs.
- **D13 Light status model.** Main keeps the full model only for the selected session and a light state for every
  tracked session (registry-live, controlled, or hook-active in 10 min; max 20): tail of the main transcript from the
  last 256 KiB, open AskUserQuestion/ExitPlanMode, api error, activity; sub-agent needs-you only via hooks.
- **D14 Notifications.** Toast only for new items (permission, question, plan, input; api-error opt-in); never for
  running/done; max one toast per 3 s; suppressed when the window is focused on that project, when the project is
  muted, or in DND. flashFrame while unanswered and unfocused; overlay icon = red dot + count in its description. No
  tray icon.
- **D15 Never steal the view.** New items never switch project or session; the inbox/toast offers "Go to".
- **D16 "Open in VS Code"** = `code <cwd>`; VS Code focuses the window that already has that folder open, otherwise
  opens one (a session whose cwd is a sub-folder of the open workspace gets a new window - accepted).

## Stack
Unchanged: Electron 45, electron-vite 6, React 18.3, TS strict (`noUncheckedIndexedAccess`; tests may use `!`),
Zustand 5, chokidar 4.0.3, vitest 5. **No new dependencies** (node:http, node:crypto, node:child_process suffice).
Commands: test `npm test` (one file `npm test -- tests/x.test.ts`), lint `npm run typecheck`, build `npm run build`.

## Architecture
- **shared:** contract v4 (T01); `agentMessage.ts` (formatAgentMessage, routeConsoleInput, T02); `overlap.ts`
  (detectOverlaps, mapAgentsToWorktrees, toWorktreeViews, T03); `liveStatus.ts` hook reasons (T09).
- **main/control:** `protocol.ts` parse/encode + `args.ts` (T02) -> `controlSession.ts` + `controlManager.ts` +
  `processTree.ts` (T07) -> `externalKill.ts` (T10). Child stdout -> line splitter -> parseOutputLine -> state
  machine -> `onChanged` (ControlSessionInfo[]) and batched `onStream` (ControlStreamEvent[], 50 ms).
- **main/git:** `gitParse.ts` (T03) -> `worktreeService.ts` (T08): watch(root) -> poll cycle -> WorkspaceSnapshot push.
- **main/hooks:** `hookPayload.ts` + `hookInstaller.ts` (T04); `hookServer.ts` + `endpointFile.ts` + `hookRuntime.ts`
  + `resources/hook/agent-console-hook.cjs` (T05); `hooksService.ts` composes them per project (T10).
  Flow: Claude -> script -> POST 127.0.0.1:port/hook (token) -> parse -> transcriptService.ingestHook -> model.applyHook.
- **main/transcripts:** parseLine task fields + `taskTracker.ts` + `activitySpans.ts` (T06) -> sessionModel (T09) ->
  transcriptService: control hint, controlled flags, ingestHook, activity events (T11). accountsService.launchControlled (T11).
- **main/attention (T21):** `statusHub.ts` (light state per tracked session -> AttentionSnapshot {items, projects}),
  `notifier.ts` (toast/flash/overlay, dedupe, mute/DND), `prefs.ts` (userData JSON). Inputs: session list, registry,
  controlled prompts, hook events, transcript change paths, per-project usage (T11).
- **main wiring:** handlers.ts + index.ts (T13).
- **renderer:** `useControlStore`, `useWorkspaceStore` (T12); layout + Dialog (T14); LeadConsole control UI (T15);
  left/center panels (T16); inspector/header/hooks dialog (T17); App + shortcuts + console store glue (T18);
  error/empty pass + grid density (T20); project rail, inbox, switcher, `useAttentionStore` (T22); column collapse
  `useLayoutStore` (T14); per-project view state (T18). README/packaging (T19).

## File tree
```
src/shared/{types,ipc}.ts, src/preload/index.ts, src/main/ipc/handlers.ts (stubs), src/shared/mock/team.ts,
  src/renderer/src/components/team/SharedTaskList.tsx (compile fix), tests/shared/ipcContract.test.ts        T01
src/main/control/{protocol,args}.ts, src/shared/agentMessage.ts;
  tests/main/control/{protocol,args}.test.ts, tests/shared/agentMessage.test.ts                              T02
src/main/git/gitParse.ts, src/shared/overlap.ts; tests/main/git/gitParse.test.ts, tests/shared/overlap.test.ts T03
src/main/hooks/{hookPayload,hookInstaller}.ts; tests/main/hooks/{hookPayload,hookInstaller}.test.ts          T04
src/main/hooks/{hookServer,endpointFile,hookRuntime}.ts, resources/hook/agent-console-hook.cjs;
  tests/main/hooks/{hookServer,hookScript}.test.ts                                                            T05
src/main/transcripts/{records,parseLine,taskTracker,activitySpans}.ts;
  tests/main/transcripts/{taskTracker,activitySpans}.test.ts, parseLine.test.ts (task cases)                  T06
src/main/control/{controlSession,controlManager,processTree}.ts; tests/main/control/{controlSession,controlManager}.test.ts T07
src/main/git/worktreeService.ts; tests/main/git/worktreeService.test.ts                                      T08
src/main/transcripts/sessionModel.ts, src/shared/liveStatus.ts; tests (sessionModel, liveStatus)            T09
src/main/control/externalKill.ts, src/main/editor/openInEditor.ts, src/main/hooks/hooksService.ts; 3 tests    T10
src/main/accounts/accountsService.ts, src/main/transcripts/{sessionIndex,transcriptService}.ts; 3 tests      T11
src/renderer/src/store/{useControlStore,useWorkspaceStore}.ts; tests/renderer/{controlStore,workspaceStore}.test.ts T12
src/main/ipc/handlers.ts, src/main/index.ts, electron-builder.yml (extraResources); tests/main/ipcHandlers.test.ts T13
src/renderer/src/components/layout/{Splitter.tsx,splitter.css}, hooks/usePanelHeights.ts (new),
  components/ui/Dialog.tsx (new), screens/{TeamView.tsx,TeamView.css}; tests splitter/teamLayout/dialog       T14
src/renderer/src/components/team/{LeadConsole,ControlBar,PermissionCard}.tsx, teamCenter.css; tests/renderer/leadControl.test.tsx T15
src/renderer/src/components/team/{WorktreeList,SharedTaskList,Timeline,OverlapBanner,CompareDiffsDialog}.tsx,
  teamLeft.css; tests/renderer/workspacePanels.test.tsx                                                       T16
src/renderer/src/components/inspector/{Inspector.tsx,inspector.css}, team/{TeamHeader,HooksDialog}.tsx;
  tests/renderer/{inspectorActions,hooksDialog}.test.tsx                                                      T17
src/renderer/src/{App.tsx,store/useConsoleStore.ts,hooks/useShortcuts.ts,components/ui/ShortcutsHelp.tsx};
  tests/renderer/{shortcuts.test.tsx,store.test.ts}                                                            T18
README.md (new), electron-builder.yml (publish), scripts/check-bundle.mjs; tests/bundleCheck.test.ts         T19
src/renderer/src/components/ui/{ErrorBanner.tsx,reasonText.ts} (new) + empty/error pass in AgentGrid (+ S3 sort/
  collapse/density), AgentCard, LeadConsole, WorktreeList, HooksDialog; tests/renderer/emptyStates.test.tsx    T20
src/main/attention/{statusHub,notifier,prefs}.ts; tests/main/attention/*.test.ts                              T21
src/renderer/src/store/useAttentionStore.ts, components/rail/{ProjectRail,NeedsYouInbox,ProjectSwitcher}.tsx,
  rail.css, TeamView.tsx (mount), TeamHeader.tsx (inbox + tokens, select removed); tests projectRail/inbox/attentionStore T22
Additions from the UX debate: src/shared/displayPath.ts (T02), usageToday.ts per-project (T11),
  store/useLayoutStore.ts (T14), inspector/FilesTab.tsx (T17), LeadConsole/AgentGrid scroll memory (T18).
```
Test-file ownership across waves: T14 owns teamView/inspector tests (W5); T15 owns teamCenter/teamLive tests (W5) and
deletes the obsolete Phase 4/5 placeholder cases; in W6 teamLive is frozen, T17 owns teamSections (header cases),
T16 must keep demo worktree/task markup. T14 also adds `topHeight`/`splitter` props to Inspector.tsx (W5), T17 keeps them.
Implementers may use `!` (non-null assertions) in tests.

## Waves
| Wave | Tasks | Why this order |
|---|---|---|
| 1 | T01, T02, T03 | T01 owns every contract file. T02/T03 are pure modules with their own local types. |
| 2 | T04, T05, T06 | Hook parser/installer, hook server/script (parser injected, no T04 import), transcript task/span parsers. Need T01 types only. |
| 3 | T07, T08, T09 | Control runtime needs T02; worktree service needs T03; session model needs T06 + T01 hook types. |
| 4 | T10, T11, T12 | External kill needs T07 processTree; hooksService needs T04/T05; service integration needs T07/T09; stores need T01. |
| 5 | T14, T15, T21 | Layout is independent; lead console needs T12; attention hub needs T07/T11 APIs. |
| 6 | T13, T16, T17 | Wiring needs every main module incl. T21; panels/inspector/header need T12 + T14. |
| 7 | T18, T22 | App glue + per-project state; rail/inbox need T13 channels, T14 rail slot, T17 header. T22 only calls `setProject`/`selectSession`/`selectAgent`, whose restore logic T18 adds. |
| 8 | T19, T20 | Packaging/README and the error/empty + grid pass touch files finished earlier. |

## Acceptance map
| Criterion | Task(s) | Test file |
|---|---|---|
| R-01 | T01, T13 | tests/shared/ipcContract.test.ts, tests/main/ipcHandlers.test.ts |
| R-02 | T02 | tests/main/control/protocol.test.ts, args.test.ts |
| R-03 | T07 | tests/main/control/controlSession.test.ts, controlManager.test.ts |
| R-04 | T11, T13 | tests/main/accounts/accountsService.test.ts, ipcHandlers.test.ts |
| R-05 | T11, T15 | tests/main/transcripts/{sessionIndex,transcriptService}.test.ts, tests/renderer/leadControl.test.tsx |
| R-06 | T02, T15 | agentMessage.test.ts, leadControl.test.tsx |
| R-07 | T10, T17 | tests/main/control/externalKill.test.ts, tests/main/editor/openInEditor.test.ts, inspectorActions.test.tsx |
| R-08, R-10 | T03 | tests/main/git/gitParse.test.ts, tests/shared/overlap.test.ts |
| R-09 | T08 | tests/main/git/worktreeService.test.ts |
| R-11, R-12 | T06, T09, T16 | taskTracker.test.ts, activitySpans.test.ts, sessionModel.test.ts, workspacePanels.test.tsx |
| R-13 | T14 | tests/renderer/{splitter,teamLayout}.test.tsx |
| R-14 | T04 | tests/main/hooks/hookPayload.test.ts |
| R-15, R-16 | T05 | tests/main/hooks/{hookServer,hookScript}.test.ts |
| R-17 | T04, T10, T17 | hookInstaller.test.ts, hooksService.test.ts, hooksDialog.test.tsx |
| R-18 | T09, T11 | sessionModel.test.ts, liveStatus.test.ts, transcriptService.test.ts |
| R-19 | T07, T12, T13 | controlSession.test.ts (stdin recorder), controlStore.test.ts, ipcHandlers.test.ts |
| R-20 | T18, T19, T20 | shortcuts.test.tsx, bundleCheck.test.ts, emptyStates.test.tsx; manual packaging |
| R-21 | all | fixture review; hookServer.test.ts (no body logging); `npm test` |
| R-22, R-23 | T21, T22 | tests/main/attention/statusHub.test.ts, tests/renderer/{projectRail,inbox,attentionStore}.test.* |
| R-24 | T21, T13 | tests/main/attention/{notifier,prefs}.test.ts; manual toast check |
| R-25 | T14, T17, T18, T22 | teamLayout, inspectorActions (account colour), store.test.ts (per-project, autoHeld), shortcuts, projectRail |
| R-26 | T02, T11, T15, T16, T17, T20 | displayPath.test.ts, usageToday.test.ts, leadControl, workspacePanels, emptyStates |

## Test strategy
- Unit tests with injected spawn/exec/fs/clock/watchers; no real `claude` or network beyond 127.0.0.1 in tests.
  `hookScript.test.ts` runs the real script with `process.execPath` against a test server and against a closed port.
- Stream fixtures are hand-written from the shapes in facts 3-6 (no captured content).
- **Manual (orchestrator, after wave 7, on real data; token use only from the user's own clicks):**
  1. `npm run build && npm run preview`. Team view: worktrees of this repo (1 worktree, base fallback `main`), tasks
     and timeline on the current VS Code session, all splitters drag/keyboard/persist across restart.
  2. Hooks: open Hooks, check the preview JSON, Install in a scratch git repo, run one short `claude` there yourself,
     see realtime events (needs-you on a permission prompt), then Uninstall and diff the file. Confirm async hooks
     deliver stdin (else switch D11 to sync `timeout: 5`).
  3. Control (only if the user agrees to spend a few tokens): start a controlled session in a scratch folder, send one
     short prompt that writes a file, Allow it, Interrupt a second turn, Stop. Check picker badge and that nothing was
     sent before the first Send.
  4. External stop: open the dialog on a live VS Code session and **Cancel** (do not kill).
  5. `npm run package:win -- --publish never` -> `dist/*.exe` and `dist/latest.yml` exist.

## Risks
- **Async hooks might not receive stdin or might be dropped on exit.** Early check: manual step 2; fallback D11 sync form.
- **Stream protocol drift** (hidden `--permission-prompt-tool`). Parser keeps unknown types as `other`; if no
  `can_use_tool` arrives and a tool is denied, the UI shows the `permission_denials` from `result`. Check in step 3.
- **Git on big repos** (`--untracked-files=all`, many worktrees) exceeds 5 s. The pending-flag loop never overlaps, per
  call timeout 4 s, error per worktree shown on the card. T08 test with a slow fake exec.
- **Hook `agent_id` vs transcript agentId** assumed equal (ASSUMPTION); unknown ids fall back to the lead.
- **Killing the wrong pid** (pid reuse): re-read registry + image name check + explicit confirm (T10 tests).
- **Vertical layout regressions** (page scroll -> fixed panes). T14 owns all layout tests; narrow windows keep wrapping.
- **Shared-file churn**: one owner per wave for types/ipc/preload/handlers/index/stores/TeamView/package files.

## UX debate (round 1, response to ux-review.md)
**Adopted:** M1 rail (T22, data T21), M2 global inbox (T21/T22), M3 toasts + flashFrame + overlay + mute/DND + AUMID
(T21/T13), M4 viewed-session account (T17, first item, with a test), M5 per-project view state + "Auto never switches
under a draft/approval" (T18). S1 keyboard (Ctrl+K switcher over projects/sessions, Ctrl+1-9, Ctrl+J, inbox A/D/Enter,
Ctrl+B / Ctrl+I collapse; prompt focus moved to Ctrl+L). S2 partly: tokens today across all projects in the header
and per project in the rail (T11/T22). S3 (T20 grid sort/collapse/compact, T16 active-only lanes). S4 (T02 helper,
T15 filter chips, T16/T17/T20 paths). S5 (scoped labels, "+ New session in <project> as <account>", named confirm).
Splitters stay (the user asked for "all components can be resized"), plus collapse.
**Rejected or deferred, with reasons:**
- S2 daily soft budget + runaway-rate alerts: needs a settings UI, thresholds and more inbox noise. The per-project
  totals ship now and the budget goes to Later. Rate needs a rolling window that is not in the usage counter yet.
- Tray icon (M3 optional): close-to-tray changes app lifecycle and quit semantics. Taskbar flash and overlay cover the need.
- Full fuzzy switcher over agents (S1): the switcher covers projects + sessions; agents are one Alt+Up/Down away.
- Sub-agent needs-you for external sessions **before hooks**: the light model tails only main transcripts (cost
  bound), so sub-agent prompts of external sessions appear only with hooks installed. The rail tooltip says so.
- C1-C6: all deferred as the reviewer suggests (C4 tabs rejected outright).
**Answers to the reviewer's questions:**
1. Yes (D13). Cost: at most 20 tracked sessions x one 256 KiB first read, then only appended bytes of the main file,
   parsed with the existing `parseLine`. The full model stays single-session. Before hooks this yields registry
   waiting, open questions/plans and API errors per session. Sub-agent prompts need hooks.
2. Yes. The control manager owns each child process, so prompts are answered by `controlId` from any view (T07,
   inbox rows in T22). "Always" is supported only as **this session** (D7). No settings rules are written.
3. `code <cwd>` focuses the VS Code window that already has that folder open. Otherwise it opens a new window
   (D16). We do not try to find other windows by title (fragile).
4. Yes. T13 calls `app.setAppUserModelId(appId)` and T19 keeps `appId` stable. Dev builds may show "Electron".
**No-token rule unchanged:** the hub, notifier, rail and inbox only read. The only writes to a Claude process stay
Send / Allow / Deny / Interrupt / Stop / model-mode changes clicked by the user.

## Later
- Per-account daily soft budget and runaway-rate inbox items; tray icon; agent-level fuzzy switcher; inbox approval log.
- `stop_task` for background sub-agents; team task files under `<configDir>/tasks|teams` once a real team exists;
  "always allow" with `updatedPermissions`; removing the unused `agent:*` channels; delta pushes; inspector Files tab
  "Open full diff against main" (stays disabled; Compare diffs covers overlaps).

## Final decisions after the UX rebuttal (orchestrator, 2026-11-19) — all four adopted
- **F1 No Allow next to a truncated command.** T01: permission `AttentionItem` gets `toolName?` and `input?` (full tool
  input, display-capped ~4 kB) plus `cwd?`. T22: the inbox row shows the full input (mono) + cwd/worktree; "Allow" and
  "Allow for this session" stay disabled ("Expand to review") until the full input has been shown. Toasts may truncate,
  but a toast never offers Allow. Test: long input → Allow disabled until expanded.
- **F2 Blocked vs Ready.** T01/T21: attention items carry `severity: 'blocked' | 'idle'`. blocked = permission, question,
  plan approval, agent_needs_input, elicitation, API error; idle = idle_prompt, agent_completed, registry idle after a
  turn. Only `blocked` drives the red count, red rail badge, flashFrame, overlay count and default toasts. `idle` →
  inbox group "Ready for you (n)", blue rail badge, toasts off by default (pref to enable). Test: an idle_prompt item
  never raises the red count / never flashes.
- **F3 Show blind spots.** T01/T21: `ProjectStatus.hooksActive` (hooks installed for the project root OR any hook event
  for it in the last 24 h). T22: a project with a live external session and !hooksActive gets a hollow "partial" ring
  on its badge; the inbox footer reads "N projects without hooks — sub-agent prompts not detected · Install hooks…",
  which only opens the existing explicit Hooks dialog (preview + button; nothing installed silently).
- **F4 Jump works from any screen.** T22: `focusItem` calls `navigate('team')` first; Ctrl+J/Ctrl+Shift+J work on every
  screen (global listener). T22 also owns adding the same "● N need you" button to
  src/renderer/src/components/accounts/AccountsHeader.tsx (no other wave-7 task touches it).
