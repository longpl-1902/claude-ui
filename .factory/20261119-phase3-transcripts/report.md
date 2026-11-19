# Phase 3 report: transcripts → live Team view

Status: **done, waiting for user review.** Branch `main`, not pushed.

## What was built
- **Main process.**
  - Watches `<configDir>/projects/**/*.jsonl` for every account, including `<session>/subagents/agent-*.jsonl` plus `.meta.json`.
  - Tails by byte offset (partial lines, CRLF, multibyte, truncate/replace). The first open reads the last 16 MiB in 4 MiB async chunks, with time-sliced yielding.
  - Chokidar plus a 1 s size poll. One serialized work lane per session. Pushes are throttled to 4 Hz, size-capped snapshots (< 300 kB for 55 agents).
- **Parser.** Turns each line into records: tool calls and results, usage deduped by `message.id`, errors, rejections, interrupts, and edit +/- counts taken from tool input. Never throws.
- **Session model.** Builds the lead → sub-agent tree from `meta.toolUseId` (fallback `meta.parentAgentId`). Handles nested agents, fork copies and parallel async launches.
  - Sub-agent name = its task description; role = type · model.
  - Fills each agent's Activity, Files and Messages (task prompt in, result out, SendMessage).
- **Status** follows the spec: running / waiting / needs-you / done, with thresholds exported. The quiet-tool heuristic is OFF (user decision).
- **Live session registry.** Reads `<configDir>/sessions/<pid>.json` (busy / idle / waiting) through an allowlist; `.key` files are never opened.
- **Projects (user request).** Sessions are grouped by git project. `git rev-parse --git-common-dir` maps worktrees to their main repo; non-git folders group by folder.
  - Header: Project picker (`name · N live`), then a Session picker filtered to that project.
  - "Auto (latest)" = the app's own terminal session in that project, then the most recent live session (by transcript mtime, sticky while live), then the newest. The project choice is remembered.
- **Resizable panels (user request).** Left (180–480 px) and right (280–640 px) splitters; the center keeps at least 420 px.
  - Mouse, keyboard (arrows, Shift, Home/End, Enter/double-click to reset) and screen-reader separators. Widths are remembered.
- **Renderer.**
  - Empty first paint, then live data. With no session: an empty state with "Show demo data". LIVE/DEMO badge.
  - Live lead console. Inspector Activity/Files/Messages on live data.
  - Actions that come later are disabled with tooltips (Phase 3b/4).
  - Accounts card: "Tokens used today" = input + output + cache writes, with "+N cached" separately; it rolls over at local midnight.

## Tasks
| Task | Result |
|---|---|
| T01 contract v3, T04 status, T07 store | PASS (round 1) |
| T02 parser, T03 tailer, T06 index/usage, T08 service, T09 team UI, T10 inspector/tokens | PASS after fix round 1 |
| T05 session model | PASS after fix round 1 + an orchestrator fix for the review-2 regression (parallel async launches showed Done) |
| T11 project grouping, T12 resizable panels (added at the user's request after review) | Done: tests, typecheck, build, and checked in the real app; **not reviewed by Opus** |

Orchestrator one-liners: a plain `'\n'` in parseLine, no repeated model in the inspector, and no repo text in the live header (the Project picker shows it).

## Checks
- `npm test`: 45 files, 1125 tests pass (both drive-letter cases). Typecheck is clean. Build passes the bundle check.
- The built app was run on the user's real sessions several times:
  - Live sessions were picked and showed real tool calls, tokens and status.
  - This build session displayed 63 agents with descriptive names.
  - Sub-agent selection, the Files/Messages tabs, and the project picker (5 projects, live counts) worked.
  - Splitter drags were clamped correctly, and the widths persisted across a restart.

## Spec differences (reality wins)
1. No `parent_tool_use_id`. Sub-agents are separate files linked by `meta.toolUseId`. The spawn tool is `Agent`, not `Task`.
2. Sub-agent tool results carry no `toolUseResult`, so edit counts come from the tool input.
3. There is no mailbox in transcripts. Messages = task prompt, result and SendMessage calls.
4. "Needs you" before hooks comes only from the registry `waiting` status, open AskUserQuestion/ExitPlanMode calls, or API errors.
5. Usage repeats on every line of one API reply, so it is deduped by `message.id`.
6. Agent-team files (`teams/`, `inboxes/`) could not be verified (none exist on this PC), so they are not read yet.

## Known limits / still manual
- In teams of more than 12 agents, a finished agent keeps its last 15–25 activity items (a shared budget).
- Manual: real file-watch latency on a fresh session, and confirming nothing under `~/.claude` changed (the code never writes there; grep-verified).
- Demo data and mockups use the neutral placeholder org "acme" (personal project; no company names).
