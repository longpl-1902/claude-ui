# Plan: Agent Console - Phase 3 (Transcript watcher + parser -> live team view)

## Goal
When this run is done, the Team view shows a real Claude Code session. The main process watches
`<configDir>/projects` for every account profile, plus the default `~/.claude`. It tails the selected
session's main transcript and its sub-agent transcripts incrementally, parses each line into typed records,
and builds the agent tree: lead -> sub-agents, including nested ones and named "teammate" agents. It derives
cards, inspector data, the lead-console stream and live status, then pushes a throttled snapshot to the
renderer. Session selection is automatic by default: the folder of the running pty, then a live CLI session,
then the newest session. The user can also pick a session. When no session exists, an empty state appears,
with an explicit "Show demo data" button that loads the Phase 1 mock under a DEMO badge. The Accounts cards
show real "Tokens used today", summed from transcripts per account. Worktrees, overlap and timeline swimlanes
stay out of scope until Phase 5: placeholders in live mode, mock in demo. The prompt input stays non-functional
until Phase 3b. Nothing is written to any Claude dir.

Requirements:
- R-01 IPC contract v3: `transcripts:list-sessions`, `transcripts:select`, `transcripts:get-selection`, `usage:get-today`, plus the pushes `team:changed`, `transcripts:sessions-changed` and `usage:changed`. The preload exposes all of them. The contract test is updated. `team:get-snapshot` returns the live (or empty) snapshot when the service is wired.
- R-02 Layout and privacy: project dir encoding, the main/sub-agent/meta/registry path classifier, and a transcript fs allowlist. Only `*.jsonl`, `*.meta.json` and `sessions/<digits>.json` may be read. `*.key` and `.credentials.json` are never opened.
- R-03 Tailer: byte offset per file and a partial last line kept as bytes (UTF-8 safe), CRLF handled. A shrink or replace (truncate/rotate) resets the file. First open backfills a bounded tail window. Reads are chunked. Over-long lines are dropped and counted.
- R-04 Line parser: every verified line type maps to a typed record or `null`. It never throws. Text is truncated. Unknown types and fields are ignored.
- R-05 Tree: lead = main file. Each sub-agent's parent is whoever made the `tool_use` named in `meta.toolUseId` (the lead or a sibling sub-agent), falling back to the lead. Name, role and model come from the meta file. An agent is a "teammate" when it has `meta.name`.
- R-06 Session model -> `TeamSnapshot`: per-agent current tool, elapsed, tokens (deduped by `message.id`), tool calls, activity, changed files (+/- from `structuredPatch`) and messages. `AgentEvent`s and console lines. Dedupe by `uuid`. Caps.
- R-07 Live status: running / waiting / needs-you / done from `AgentRuntime` plus `now`, with exported thresholds and table tests.
- R-08 Session index: list recent sessions (title, cwd, mtime, account, live flag). Read the live-session registry with a pid-alive check. Auto-selection rules (see Architecture). Explicit pick.
- R-09 Tokens today per account: assistant `message.usage`, deduped by `message.id` per account per day, bucketed by local day, incremental, main + sub-agent files.
- R-10 Service: chokidar watch (dirs, filtered) plus a 1 s stat poll of the selected session's files. Snapshot pushes are throttled (max 4/s, only when dirty). It re-watches when accounts change, re-selects on pty spawn/exit and registry changes (auto mode), and is disposed on quit.
- R-11 Renderer store: no fake team at first paint (empty snapshot). Hydrates from IPC and pushes. A demo toggle. Statuses use a ticking `now` (5 s). A usage map. Selectors are safe on an empty team.
- R-12 Team UI: header session picker plus LIVE/DEMO badge. Empty and waiting states with "Show demo data". Live cards in tree order. A live console stream. A Phase 3b note on the prompt. Phase 5 placeholders for worktrees, tasks and timeline in live mode.
- R-13 Inspector live: Activity (failures red), Files (+/-), Messages (task prompt in, result out, SendMessage in/out), empty states. The Accounts card shows real tokens today.
- R-14 Privacy: fixtures are synthetic only. No real transcript content in the repo. No writes under any config dir (a recording fs test). The registry `.key` files and credentials are never read (test).
- R-15 Every parser, the tailer, the tree builder, status derivation and token summing have vitest tests. The existing 601 tests keep passing, or are updated by the task that owns the changed behaviour.

## Verified facts / spec mismatches
Checked on this PC on 2026-11-19. Installed CLI 2.1.309 (npm `bin/claude.exe`, grepped). Transcripts on disk from 2.1.219-2.1.326
(entrypoints `cli`, `claude-vscode`, `claude-desktop`). 307 sessions and 260 sub-agent files were scanned. Only structure was printed (keys, types, enum values).
1. **Location.** The main transcript is `<configDir>/projects/<enc(cwd)>/<sessionId>.jsonl`, and the default account uses `~/.claude/projects` (not home). Per-session side data lives in `<sessionId>/tool-results/*` (ignored) and `<sessionId>/subagents/`.
2. **Encoding (CLI code).** `enc = cwd.replace(/[^a-zA-Z0-9]/g, '-')`. When longer than 200 chars, it becomes `enc.slice(0,200) + '-' + base36(hash)`, and that hash cannot be reproduced. **Case is preserved**: `d:\personal\claude-ui` -> `d--personal-claude-ui`, and `D--personal` is a different folder on disk. On win32 we match case-insensitively. For names over 200 chars we match through the `cwd` field of the lines. `CLAUDE_CODE_PROJECT_DIR_NAME` can override the name. The encoding is lossy (`.`, `\`, `:` and spaces all become `-`), so the real folder always comes from the `cwd` field.
3. **Sub-agents (MISMATCH: no `parent_tool_use_id`).** Sub-agents live in separate files: `<sessionId>/subagents/agent-<agentId>.jsonl` plus `agent-<agentId>.meta.json`, and sometimes `.prefix.json` (ignored). The CLI also supports nested subdirs under `subagents/` (`agentRelPath`), so we scan recursively. agentId is 17 hex chars today, but we accept `agent-(.+)\.jsonl`. Every sub line has `isSidechain:true`, `agentId` (= the filename id), and `sessionId` = the parent session. The first line has `parentUuid:null`. Main lines have `isSidechain:false` and no `agentId`. Nested agents (spawnDepth 2) are stored **flat** in the same dir.
4. **Linking.** meta = `{agentType, description, toolUseId, spawnDepth, model?, finished?, name?, isBuiltIn, requestShape: foreground|background, ...}`. `meta.toolUseId` = the id of the `Agent` tool_use that spawned it. That tool_use is in the main file in 246/260 cases, in a sibling sub file in 12, and missing in 2, so we fall back to the lead. The parent's `tool_result.toolUseResult` for the Agent call has `agentId` and `status` (`completed` | `async_launched`), plus totalTokens, totalDurationMs, toolStats, usage and content[text].
5. **The spawning tool is `Agent`, not `Task`.** Input keys are description, prompt, subagent_type, name, model, run_in_background and isolation.
6. **No `progress` and no `summary` line types** exist in this version. The types seen: user, assistant, attachment, system (subtypes turn_duration, api_error, compact_boundary, informational, local_command, stop_hook_summary), and the ignorable types queue-operation, api-request, api-request-shape, api-request-blob, file-history-snapshot, file-history-delta, session-owner, atis-latch, last-prompt, cost-state, mode, tools-used, frame-link, pr-link, bridge-session, isolation-latch and artifact-*. The title types are `ai-title{aiTitle}`, `custom-title{customTitle}` and `agent-name{agentName}`. `relocated{relocatedCwd}` also appears. Unknown types must be ignored.
7. **Conversation lines.** They carry `uuid`, `parentUuid`, `timestamp` (ISO UTC with ms), `sessionId`, `cwd`, `gitBranch`, `version`, `entrypoint`, `isSidechain` and `userType`. Title and bookkeeping lines have **no timestamp**. The assistant line has `message{id(msg_…), model, content[], stop_reason (tool_use|end_turn|stop_sequence|null), usage}`, `requestId` and `apiBlockIndex`. Content block types are `thinking`, `text` and `tool_use{id(toolu_…), name, input, caller}`. A user line holds either `message.content` as a string or an array of `text`/`image`/`tool_result{tool_use_id, content (string|array), is_error?}`, plus top-level `toolUseResult` (object|string|array). It may also carry `permissionDecision{decision: accept|reject, source, …}`, `toolDenialKind` (user-rejected|permission-rule|automode-blocked|automode-unavailable|cancelled|interrupted), `isMeta` and `isCompactSummary`.
8. **One API message is split over several lines** (one per content block, `apiBlockIndex`), and **each line repeats the same full `usage`**. 3349 of 6248 assistant lines are repeats, and none of them has a different usage. So **usage is deduped by `message.id`**, never summed per line. One file had 876 repeated `uuid`s, and one file holds 2 sessionIds (forks/resume copy history), so lines are deduped by uuid and usage by message.id across files.
9. **Usage keys.** `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation{ephemeral_5m/1h}`, `output_tokens_details.thinking_tokens`, `server_tool_use`, `service_tier` and `speed`. API errors are written as assistant lines with `isApiErrorMessage:true`, model `<synthetic>`, `error` (rate_limit|authentication_failed|server_error|unknown) and zero usage, and they are excluded from tokens. `system/api_error` carries `retryAttempt` and `maxRetries` (a retry, not fatal).
10. **Tool results.** For Edit and Write the result is `{type: create|update, filePath, structuredPatch: [{oldStart, oldLines, newStart, newLines, lines[]}], originalFile, …}`, where the first char of each line is ` `, `+`, `-` or `\`. A create has an empty patch, so we count `content` lines as added. Bash and PowerShell give `{stdout, stderr, interrupted, isImage, noOutputExpected}`. A failure is `is_error:true` and/or a string `toolUseResult` starting "Error" or containing "rejected". An interrupt is the user text `[Request interrupted…` or `toolDenialKind: interrupted|cancelled`.
11. **Live session registry (NEW, not in spec).** `<configDir>/sessions/<pid>.json` holds `{pid, sessionId, cwd, startedAt, updatedAt, statusUpdatedAt, status: busy|idle|waiting, waitingFor?, kind: interactive, entrypoint, version, name, messagingSocketPath, …}`. It is written by interactive sessions (CLI and VS Code). `status:"waiting"` + `waitingFor` (e.g. "dialog open", "input needed", "sandbox request") is the **only on-disk permission/prompt signal**. Files of dead processes can linger, so we check that the pid is alive. **`sessions/<pid>.<hex>.key` files sit next to them and are secrets: never open them** (allowlist `^\d+\.json$`). We keep only pid, sessionId, cwd, status, waitingFor, startedAt, updatedAt, statusUpdatedAt and name.
12. **Agent teams.** The CLI stores teams in `<configDir>/teams/<sanitized-name>/config.json` (leadAgentId, members) and the mailbox in `teams/<team>/inboxes/<agent>.json`. `~/.claude/teams` is **empty** on this PC and `~/.claude/tasks/session-*` dirs are empty, so the schema **cannot be verified**, and Phase 3 does not read them (see Later). The named in-process agents (`Agent` with `name`, 31 metas carry `name`) are what we show as teammates.
13. **Messages tab (MISMATCH: no mailbox in transcripts).** It shows (a) the Agent task prompt as "in" from the parent, (b) the final result text as "out" to the parent, and (c) `SendMessage` tool calls (input `{to, recipient, recipient_kind: agent|name, message, content, summary, type: message}`, result `{success, message, resumedAgentId?}`), shown out for the sender and in for the recipient when `to`/`recipient` resolves to an agent in the tree.
14. **Sizes.** The main files are p50 1.4 MB, p90 9.3 MB, p99 25 MB, max 66 MB. Sub files are up to 13 MB. The longest line is 1.4 MB (`api-request-blob`/`user`). 1882 lines are over 100 kB.
15. **Spec field mapping.** `ts`=`timestamp`. `sessionId`=`sessionId`. `agentId`='lead' or sub `agentId`. `parentAgentId` comes from meta.toolUseId, not from line fields. `tool`/`target` come from tool_use name/input. `result` comes from the tool_result. `tokens` comes from message.usage (extended with cacheCreation/cacheRead). `worktree`=`gitBranch` (the real worktree comes in Phase 5). `accountId` comes from which config dir the file is under. New fields: `toolUseId`, `uuid`, `failed`.
16. **CLI vs VS Code.** Both write the same dirs and schema. Interactive CLI and VS Code sessions both appear, and `entrypoint` tells them apart.

## Stack
Unchanged: Electron 45, electron-vite 6, React 18.3, TS strict (`noUncheckedIndexedAccess`; tests may use `!`), Zustand 5, chokidar 4.0.3, vitest 5.
**No new dependencies.** Commands: test `npm test` (one file: `npm test -- tests/x.test.ts`), lint `npm run typecheck`, build `npm run build`.

## Architecture
- **shared (T01):** new types in `types.ts`, contract v3 in `ipc.ts`, `teamDefaults.ts` (EMPTY_TEAM_SNAPSHOT, PLACEHOLDER_AGENT, LEAD_ID='lead').
  **shared (T04):** `liveStatus.ts`, a pure `deriveLiveStatus(runtime, nowMs)` plus thresholds.
- **main/transcripts:**
  - `transcriptFs.ts` (allowlisted byte reader), `layout.ts` (encoding plus path classifier) and `tailer.ts` (T03).
  - `records.ts` and `parseLine.ts` (pure line -> `TranscriptRecord`, T02).
  - `sessionModel.ts` (records + metas + registry -> TeamSnapshot, T05).
  - `sessionIndex.ts` (session listing, registry, auto-pick) and `usageToday.ts` (T06).
  - `transcriptService.ts` (T08) composes them: watchers, the selected-session tail loop, the throttled push, usage feeding.
- **Data flow:** chokidar/poll -> tailer.read(file) -> lines -> parseLine -> model.ingest(source, records) -> dirty -> throttle 250 ms -> `team:changed` (full capped snapshot). Every changed jsonl, not only the selected one, also feeds usageToday (its own offsets) -> `usage:changed` (debounced 2 s). Registry and new main files -> sessionIndex -> `transcripts:sessions-changed`, plus auto re-pick.
- **Auto-selection (decision):** (1) A running `claude` pty from the app (newest): pick the registry entry with `pid === pty.pid`, else the newest session in that account's projects dir whose cwd matches the pty cwd (encoded-name match, case-insensitive on win32, or the head line's `cwd`) and whose mtime is at least `pty.startedAt - 5 s`. If none exists yet, use state "waiting-for-session" (the CLI writes the file only after the first prompt). (2) Else, the live registry entries (pid alive) across accounts, ordered by newest `statusUpdatedAt ?? updatedAt`. (3) Else, the newest session by mtime within 24 h. (4) Else empty. An explicit pick pins a session until the user chooses "Auto" again.
- **Empty vs demo (decision):** first paint and "no session" show an **empty state**, never mock data. The Phase 1 mock is reachable only through "Show demo data" and is shown under a DEMO badge, with "Back to live". Reason: fake agents styled like real ones would mislead about what is running.
- **Snapshot push (decision):** a full `TeamSnapshot`, capped (activity 150 per agent, events 500, console 300, messages 100 per agent), throttled to 4 Hz, sent only when dirty. That is simpler and safer than deltas at this size (about 10 agents, under 300 kB). The renderer recomputes status every 5 s from `Agent.runtime`.
- **Backfill (decision):** the selected session's files are read from `max(0, size - 16 MiB)`, aligned to the next newline, and `historyTruncated` is set when bytes were skipped. Sub-agent files get the same treatment. usageToday reads whole files whose mtime is today or later, skipping lines by a raw prefilter before `JSON.parse`, in 4 MiB chunks, yielding between chunks.
- **Status thresholds (T04):** see T04 Notes. needs-you means the registry says `waiting`, or `AskUserQuestion`/`ExitPlanMode` is open, or the last line is an API error. Permission prompts for non-interactive or unregistered sessions are not knowable from transcripts, so Phase 4 hooks add them.
- Data rule: Phase 3 only **reads** under config dirs, through `transcriptFs` (allowlist). No Claude dir is ever written.

## File tree
```
src/shared/types.ts, src/shared/ipc.ts, src/shared/teamDefaults.ts (new)                      T01
src/preload/index.ts                                                                        T01
src/main/ipc/handlers.ts (stubs for new channels)                                           T01 -> T08
tests/shared/ipcContract.test.ts                                                            T01
src/main/transcripts/records.ts, parseLine.ts; tests/main/transcripts/parseLine.test.ts     T02
src/main/transcripts/transcriptFs.ts, layout.ts, tailer.ts;
tests/main/transcripts/{transcriptFs,layout,tailer}.test.ts                                  T03
src/shared/liveStatus.ts; tests/shared/liveStatus.test.ts                                   T04
src/main/transcripts/sessionModel.ts; tests/main/transcripts/sessionModel.test.ts           T05
src/main/transcripts/sessionIndex.ts, usageToday.ts;
tests/main/transcripts/{sessionIndex,usageToday}.test.ts                                     T06
src/renderer/src/store/useConsoleStore.ts, src/renderer/src/App.tsx;
tests/renderer/seedTeam.ts (new), tests/renderer/store.test.ts, tests/renderer/app.test.tsx;
tests/renderer/{teamView,teamCenter,inspector,teamSections}.test.tsx (seed lines only)       T07
src/main/transcripts/transcriptService.ts, src/main/ipc/handlers.ts, src/main/index.ts;
tests/main/transcripts/transcriptService.test.ts, tests/main/ipcHandlers.test.ts             T08
src/renderer/src/components/team/{TeamHeader,AgentGrid,LeadConsole,WorktreeList,
SharedTaskList,Timeline}.tsx, teamCenter.css; tests/renderer/teamLive.test.tsx,
tests/renderer/teamSections.test.tsx (header cases)                                          T09
src/renderer/src/components/inspector/{Inspector,ActivityTab,FilesTab,MessagesTab}.tsx,
src/renderer/src/components/accounts/AccountCards.tsx; tests/renderer/inspectorLive.test.tsx,
tests/renderer/inspector.test.tsx (cases broken by the change only)                          T10
tests/fixtures/transcripts/** (builders + static tree), tests/main/transcripts/memoryByteFs.ts  test-writer (read-only for implementers)
```

## Waves
| Wave | Tasks | Why this order |
|---|---|---|
| 1 | T01, T02, T03 | T01 is the single owner of every shared/contract file. T02 (line parser) and T03 (fs/layout/tailer) are pure main modules that import only their own files plus existing Phase 2 code (`src/main/contracts.ts` `DirEntry`, `src/main/accounts/safeFs.ts` `isDeniedPath`). T03 defines `ByteReadFs` in its own `transcriptFs.ts`, and T02 defines its own record types, so neither depends on T01. |
| 2 | T04, T05, T06 | Status derivation needs the T01 `AgentRuntime`. The session model needs the T02 records and the T01 types. The index and usage need the T02/T03 modules. All files are disjoint. |
| 3 | T07, T08 | The store needs the T01 api and `liveStatus` (T04). The service needs T03, T05 and T06, and it owns handlers.ts and index.ts. |
| 4 | T09, T10 | The UI needs the T07 store (selectors, demo toggle, sessions, usage). Header/grid/console and the inspector/accounts card own disjoint files. |

## Acceptance map
| Criterion | Task(s) | Test file |
|---|---|---|
| R-01 | T01, T08 | tests/shared/ipcContract.test.ts, tests/main/ipcHandlers.test.ts |
| R-02 | T03 | tests/main/transcripts/layout.test.ts, transcriptFs.test.ts |
| R-03 | T03 | tests/main/transcripts/tailer.test.ts |
| R-04 | T02 | tests/main/transcripts/parseLine.test.ts |
| R-05, R-06 | T05 | tests/main/transcripts/sessionModel.test.ts |
| R-07 | T04, T07 | tests/shared/liveStatus.test.ts, tests/renderer/store.test.ts |
| R-08 | T06, T08 | tests/main/transcripts/sessionIndex.test.ts, transcriptService.test.ts |
| R-09 | T06, T08, T10 | tests/main/transcripts/usageToday.test.ts, transcriptService.test.ts, inspectorLive.test.tsx |
| R-10 | T08 | tests/main/transcripts/transcriptService.test.ts; manual |
| R-11 | T07 | tests/renderer/store.test.ts, app.test.tsx |
| R-12 | T09 | tests/renderer/teamLive.test.tsx, teamSections.test.tsx |
| R-13 | T10 | tests/renderer/inspectorLive.test.tsx |
| R-14 | T03, T06, T08 | transcriptFs.test.ts (.key/.credentials refused), transcriptService.test.ts (recording fs: zero writes); fixture review |
| R-15 | all | `npm test` |

## Test strategy
- **Fixtures (test-writer, synthetic only).** `tests/fixtures/transcripts/builders.ts` exports line builders that follow facts 6-11 exactly: `userPrompt`, `assistantBlocks` (one line per block, same `message.id`, same usage), `toolResult`, `editResult`, `writeCreateResult`, `agentToolUse`, `agentResult`, `subMeta`, `apiErrorLine`, `systemApiError`, `interruptedLine`, `sendMessageUse`, `askUserQuestionUse`, the title/bookkeeping lines, `registryEntry`, and `fakeKeyFile`. `tests/fixtures/transcripts/trees.ts` builds a whole `{path: content}` tree (two accounts, a session with a nested sub-agent, a named teammate, an async agent, a fork copy with repeated uuids/message ids, lines across two local days, CRLF, malformed and multibyte lines, a missing meta, a toolUseId in a sibling, a registry entry plus `.key`). `tests/main/transcripts/memoryByteFs.ts` is an in-memory `ByteReadFs` with `append`, `truncate` and `replace` (new birthtime), and it records reads. IDs, paths and text are all invented (`C:/Users/u/...`, `d:/work/demo`). No line is copied from a real transcript.
- **Automatic.** All modules use injected fs, clock, pid-alive and watcher. The service uses a fake watcher and a fake timer (vi.useFakeTimers). The renderer uses a mocked `window.api`.
- **Manual (orchestrator, after wave 4).**
  1. `npm run build` and `npm run preview`. The Team view auto-picks this repo's current VS Code session (registry live). Cards show the lead plus the sub-agents spawned during the run, status changes within about 5 s, and the console streams.
  2. Start a sub-agent in that session. A new card appears with its parent, and it shows done after it finishes.
  3. Raw terminal: start `claude` in a scratch folder and send one prompt. Auto switches to that session.
  4. Accounts: tokens today is non-zero and stays stable across restarts (dedupe).
  5. Pick an old session in the picker, then Auto. "Show demo data" and back.
  6. Confirm that nothing under `~/.claude` changed (mtime of projects/ files is untouched by the app) and the app never logs `.key`.

## Risks
- **fs.watch on Windows can delay or coalesce events for files a process keeps open.** Mitigation: the 1 s stat poll of the selected session's files plus a 2 s readdir of its `subagents/` (T08). Early check: the manual step 1 watch latency.
- **Big files (66 MB) and long lines (1.4 MB) block the main thread.** Mitigation: the 16 MiB backfill window, 4 MiB chunks with `await` between them, a raw prefilter that skips `api-request*`/`file-history*`/`queue-operation` before parse, and an 8 MiB max line. Early check: a T03 test with a 20 MB synthetic file finishes under 1 s on CI (soft assertion, logged).
- **Status heuristics (stale thresholds) mislabel long Bash runs or slow models.** Mitigation: the thresholds are exported constants, the reason is shown in the card tooltip (`Agent.runtime` and the reason), and table tests cover them. The registry gives the true busy/idle/waiting for interactive sessions.
- **The registry format is internal and may change.** The parser is tolerant: missing fields -> entry ignored, and status falls back to transcript heuristics.
- **Renderer tests seeded with mock data break when the initial team becomes empty.** T07 owns the seed helper and the `beforeEach` edits in all affected files, and finishes with the full `npm test` green.
- **Account dir mapping.** `AccountView.configDir` may be `~`-prefixed. T08 uses `expandHome` and always adds the default `~/.claude` (accountId `''` when unlinked).

## Assumptions and spec gaps
- ASSUMPTION: "teammate" = a sub-agent with `meta.name`. Out-of-process teammates (tmux/iTerm panes) would be separate sessions and are not merged into a team (Later).
- ASSUMPTION: the lead id is the constant `'lead'`, and sub-agent ids are the file agentIds.
- ASSUMPTION: "done" for a sub-agent = meta.finished, or the parent got a `completed` Agent result, or the sub-agent's last turn ended (`end_turn`) with no open tool. For the lead = 30 min quiet after end_turn with no live registry entry.
- ASSUMPTION (tokens headline): `input + output + cacheCreation` is shown, and `cacheRead` appears separately as "+N cached". See the user decisions.
- ASSUMPTION: `worktree` on cards = `gitBranch` from the lines until Phase 5.
- The spec's Notification/permission signals come from the registry only (interactive sessions). Phase 4 hooks complete it.

## Later
- Phase 4: hooks give realtime Notification/PermissionRequest/SubagentStop and replace the heuristics.
- Agent teams: read `<configDir>/teams/<team>/{config.json,inboxes/*.json}` once a real team exists to verify the schema (Messages tab inbox).
- Derive the shared task list from `TaskCreate`/`TaskUpdate` tool calls (input subject/status/taskId verified). Phase 5 timeline swimlanes from activity.
- Delta pushes, if snapshots grow.

## User decisions needed (plan gate)
1. **Tokens headline:** `input + output + cache writes`, with cache reads shown separately as "+N cached" (default). Alternatives: include cache reads in the headline, as ccusage-style totals do (numbers are about 10-100x larger), or output only.
2. **Empty state vs demo:** an empty state with an explicit "Show demo data" button (default). The alternative is demo data automatically when no session exists, which is not recommended.
3. **Auto-selection scope:** the app pty, then any live CLI/VS Code session, then the newest session within 24 h, across all accounts (default). The alternative is limiting it to the app's own pty sessions only.
4. **Needs-you without hooks:** registry `waiting`, plus open AskUserQuestion/ExitPlanMode, plus API errors (default). Optional extra heuristic: an open tool quiet for more than 20 s while the registry says `busy`. It is off by default, because long Bash runs look the same.
5. **Agent teams mailbox:** not read in Phase 3, because no team exists on disk to verify the schema. Create a small team once (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) if you want it verified and added.

## User decisions (plan gate, 2026-11-19)
- Plan approved as written.
- Tokens today headline: input + output + cache-creation; cache reads shown separately as "+N cached".
- No session: empty state with a "Show demo data" button (no automatic demo).
- Auto-pick: best available — app's own claude pty, then any live registry session (CLI / VS Code), then newest in last 24 h, across all accounts; header picker to switch.
- Needs-you heuristic (open tool quiet >20 s while busy): OFF. Only registry `waiting`, open AskUserQuestion/ExitPlanMode, API error.
- Team mailbox: not read in Phase 3 (format unverifiable on this PC).
