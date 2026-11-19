# Handoff — rewrite Agent Console as `ac`, a Go terminal app (TUI)

This file hands the work to a new agent (cloud or local) that has NOT seen the earlier conversation.
Read it fully before touching code. Where it conflicts with `docs/spec.md`, **this file wins**.

## 1. What happened so far

- The owner is a team lead who runs many Claude Code sessions across several git projects on
  Windows 11. They use Windows Terminal + PowerShell and two monitors. They write in Vietnamese.
  Reply to them in Vietnamese and keep it short.
- We first built an Electron desktop app, "Agent Console": a dashboard with team grid, chat, accounts,
  extensions, multi-window, themes. It shipped as v0.1.0 / v0.1.1 on GitHub Releases.
- The owner then said it was **over-engineered and too heavy** (386 MB installed). What they wanted
  was *"a screen like PowerShell, customised for a leader; the simpler the UI the better; Neovim-like
  editing so devs rarely touch the mouse; as light as possible"*.
- The Electron app was **deleted from `main`**. The full code is kept in the git tag
  **`electron-final`**. Use it as the reference implementation:
  `git worktree add ../ref electron-final` (or `git show electron-final:<path>`).
- A senior-architect pass produced a **draft** `docs/spec.md` (538 lines). It also produced wave-1
  task files in `.factory/20261119-go-tui/` (`plan.md`, T01–T05). The architect was stopped before
  folding in the owner's latest UX rules (section 3 below). **Step 1 of your work is to update the
  spec and the plan with section 3.** Then implement.

## 2. Decisions (owner-approved)

| Topic | Decision |
|---|---|
| Form | Terminal UI app, binary `ac` (`ac.exe`), run inside Windows Terminal / PowerShell |
| Language | **Go 1.27 + Bubble Tea** (charmbracelet; bubbletea/bubbles/lipgloss). Node/Ink was rejected as not smooth enough |
| Size | As small as possible; target **< 15 MB single exe**, no runtime dependencies besides the official `claude` CLI |
| Control | Full control of sessions, not just watching: "like Claude Code in the command prompt, but an extended version for a lead" |
| Accounts | **Keep multi-account** (several Claude config dirs via `CLAUDE_CONFIG_DIR`, each signed in by the official `claude` CLI) |
| Multi-instance | The owner wants to run **two or more `ac` at once, each on a different account** (e.g. one per monitor) |
| Delivery | Two drops; drop 1 must be usable alone (section 6) |
| Release | Push to `main`, tag `v0.2.0`, GitHub Actions builds `ac.exe` (windows-amd64) and attaches it to the Release. A zipped exe is fine; no installer needed |

## 3. Binding UX rules (newest; override the draft spec)

The owner wants the **fewest possible actions**. Keyboard shortcuts are welcome; the mouse should never
be needed.

1. **Start-up.**
   - `ac` opens an **account picker**. It lists the detected/linked config dirs with email/org
     (read ONLY from `.claude.json`), shows a "not signed in" state, and preselects the last-used
     account. `j/k` and `Enter` confirm.
   - The picker is skipped when only one account exists, with `ac --account <name>`, or with a
     remembered "always use".
   - The picker can start a sign-in through the official `claude` login flow.
   - After the picker, the app lands on the main screen with the cursor **already in the prompt line
     (INSERT mode)**.
2. **No explicit resume/fork in normal use.**
   - No session selected + `Enter`: start a **new** session in the project of the directory where
     `ac` was launched (fall back to the last project).
   - A session selected + `Enter`: **continue (resume)** it.
   - If the selected session is live in another process (VS Code, another `ac`, a terminal
     `claude`), **auto-fork** (`--resume <id> --fork-session`) and send into the fork. Show one
     inline line: "↳ forked from <short id> because it is running in <where>". Never ask.
     Forking costs no tokens; only the user's prompt does.
   - Keep `:fork` only as a rare explicit command. Drop `:resume`.
3. **Needs-you is one key away.**
   - The status line shows the count.
   - `Tab` (also `]n` / `[n`) jumps to the next item needing the user (permission, question,
     plan, API error).
   - `a`/`d` allow or deny; `1`–`9` pick an answer. Focus then returns to where the user was.
4. **Keymap tiers.**
   - Daily actions are single keys in NORMAL mode: `j/k`, `Enter`, `i`, `Esc`, `Tab`, `a`, `d`,
     `1`–`9`, `/`, `y`, `gf` (open file in `$EDITOR`, default nvim), `o` (open the real
     `claude --resume` in a new Windows Terminal tab), `?`, `q`.
   - Rare actions use `:` commands with fuzzy completion: `:new`, `:account`, `:model`, `:mode`,
     `:diff`, `:fork`, `:stop`, `:interrupt`, `:q`.
   - `Ctrl+C` or `Esc Esc` interrupts the running turn.
   - Multi-line prompt: Shift+Enter where the terminal reports it, with Alt+Enter as the always-works
     fallback.
5. **Count keystrokes.** Put a table in the spec with the keystrokes for each top flow, and minimise
   them:
   - open, then send the first prompt
   - answer a pending permission
   - switch to another project's session and continue
   - start a new session in another project
   - switch account
6. **Simple UI.**
   - A session list (grouped by git project) on the left.
   - The conversation on the right. Tool calls are collapsed to one line and expandable; permission
     and question cards sit inline at the end.
   - One status line, then the prompt line.
   - No dashboards, grids, themes or panels beyond that.

## 4. Multiple accounts and multiple instances

- **No single-instance lock.** Each `ac` process is independent and spawns `claude` with its own
  `CLAUDE_CONFIG_DIR`.
- **Shared app state** (prefs, profiles, folder rules, last-used account) must be:
  - written atomically (temp file + rename),
  - re-read on change,
  - safe with concurrent instances.
- Each running instance keeps its own account. The picker only preselects the most recent choice.
- **One controller per session.** Keep a lock file per controlled session that holds the pid; the lock
  is stale if that pid is dead. A second instance shows the session read-only, labelled
  "controlled by another ac (pid N)". If the user types into it, auto-fork (rule 3.2).
- The status line shows the instance's account clearly. A per-account accent colour is fine.
- Within one instance, the session list can show all accounts, filterable. New sessions use the
  chosen account unless a folder rule says otherwise.
- Tests:
  - lock and stale-lock cases,
  - atomic state writes with two writers.

## 5. Hard rules (unchanged from the original spec — never break)

- **Never read, copy or store Claude credentials.** Never open `.credentials.json` or the registry
  `.key` files. Auth is always the official `claude` CLI; we only set the environment.
- Never edit Claude settings silently. Any write shows the exact change first and can be undone
  (hooks are not in v1).
- **R-19, no autonomous token spend.** Nothing is sent to Claude without an explicit user action. No
  automatic prompts. Local control requests (initialize, `mcp_status`, `get_context_usage`) are sent
  only after the user's first send. **Never run real `claude` sessions in tests or CI.** Use
  fixtures and a fake `claude` binary.
- **Privacy.**
  - Personal project. Use neutral names only ("acme", `C:/Users/u`, `u@example.com`) in code,
    fixtures, docs, commit messages and factory notes.
  - Never write the owner's real name, email, company or Windows profile path.
  - Before every push, grep the unpushed commits for personal data.

## 6. Delivery plan

- **Drop 1 (ship as v0.2.0):**
  - account picker
  - sessions grouped by project, all accounts with a filter
  - conversation view
  - prompt line
  - control: send, interrupt, allow/deny, answer questions, approve plan
  - needs-you jump
  - basic vim keys
  - the auto-fork rule
  - multi-instance locks
- **Drop 2:**
  - worktree overlap / `:diff`
  - `/` search
  - `y` yank
  - `gf` nvim
  - `o` Windows Terminal tab
  - optional toast
- Waves (from the draft plan, adjust for section 3):
  - wave 1 foundations in parallel: scaffold/core, transcript parser, control protocol,
    accounts/state, git
  - wave 2: session model, index/watcher, UI shell
  - wave 3: backend wiring, account picker, diff
  - wave 4: end-to-end tests, release workflow, README
- **CI/release** (`.github/workflows/`; the old Node workflows were deleted):
  - On push or PR: `go vet`, `go test ./...`, `gofmt` check.
  - On tag `v*`: build `GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=<tag>" -o ac.exe ./cmd/ac`,
    zip it, and attach `ac.exe` (and the zip) to the GitHub Release.
  - Earlier releases v0.1.0/v0.1.1 are the Electron app; the next version is **v0.2.0**.
- README: install (download `ac.exe`, put it on PATH), first run, the keymap table, multi-account,
  running two instances.

## 7. Reference map: where the hard-won knowledge lives (tag `electron-final`)

Port the **behaviour and test cases**. Do not port the UI. The old `tests/**` plus their fixtures are
the behavioural spec. Port the important cases to Go table tests and reuse the redacted fixtures.

| Area | Old files | Notes |
|---|---|---|
| Transcript parsing | `src/main/transcripts/parseLine.ts`, `records.ts` | Claude Code JSONL under `<configDir>/projects/<encoded-cwd>/<sessionId>.jsonl`. Sub-agents in `<session>/subagents/agent-*.jsonl`, linked to the parent by `meta.toolUseId`. Keep FULL message text (limits 12000 reply / 8000 prompt / 4000 sub-agent result; the old 300-char cut was a bug the owner hit). Thinking blocks are never shown. |
| Session model | `sessionModel.ts`, `activitySpans.ts`, `taskTracker.ts`, `liveStatus.ts` | Tokens: dedupe per message id (last usage wins); session = input+output+cacheCreation (cacheRead excluded); "today" by local date. API-error and `<synthetic>` lines count nothing. |
| Index / roots / tailing | `transcriptService.ts`, `tailer.ts`, roots and project-key helpers | Tail incrementally, cap history (old cap 20 MB with a "older history not loaded" note). Project key = git root. Normalise drive-letter case on Windows. |
| Live registry | `<configDir>/sessions/<pid>.json` | Use it for live/busy/waiting. **Never open the `.key` files there.** |
| Control protocol | `src/main/control/args.ts`, `protocol.ts`, `controlSession.ts`, `controlManager.ts`, `processTree.ts`, `externalKill.ts` | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio --permission-mode <m> --replay-user-messages [--model] [--effort] [--resume <id> [--fork-session [--resume-session-at <uuid>]]]`. Permission prompts arrive as `control_request` subtype `can_use_tool` and are answered with `control_response`. Other requests: initialize, interrupt, set_model, set_permission_mode, get_context_usage, mcp_status, rename_session, rewind_files. Validate model/session ids (regexes in `args.ts`); never emit bypass/dangerous flags. On Windows, kill the whole process tree (use job objects in Go). |
| Accounts | `src/main/accounts/*` | Config-dir detection (default `~/.claude` plus others), profile store, folder rules, sign-in by running `claude` login in a pseudo-console, safety toggles. Read only email/org from `.claude.json`. |
| Git / worktrees | `src/main/git/*`, `src/shared/overlap.ts` | Overlap counts as "live" only when a file has uncommitted edits in 2+ worktrees, or in a worktree where an agent works (committed-only overlaps were noise: 546 files in a real repo). |
| Attention | `src/main/attention/*` | blocked (permission, question, plan, api-error, registry waiting) vs idle (ready for the next prompt). |
| Question cards | `src/renderer/src/components/team/QuestionCard.tsx` | AskUserQuestion input: up to 4 questions, options, multiSelect, plus "Other" free text. ExitPlanMode = plan card. |

## 8. Gotchas learned the hard way

- Shells spawned from VS Code / Claude Code carry `ELECTRON_RUN_AS_NODE=1`. **Strip it** from the
  environment when spawning `claude`, or `claude` breaks.
- The `claude` used by the VS Code extension (bundled) can be a different version from the npm
  CLI on PATH. Detect `claude.exe` / `claude.cmd`. On Windows, `.cmd` shims need `cmd /c`.
- A lowercase `d:\` vs `D:\` cwd caused duplicate projects and broken tools. Normalise paths.
- The repo uses CRLF on Windows checkouts (autocrlf). Tests that read text must accept `\r\n`. Add
  `testdata/.gitattributes` with `* -text` so fixtures keep LF.
- `wt -w 0 nt` hands the new tab to the existing Windows Terminal process, which does NOT inherit
  our env. Set `CLAUDE_CONFIG_DIR` inside the launched command (see spec §5).
- Resume needs the session's original cwd (the exact string from the transcript), or `claude` says
  "no conversation found".
- Real-data runs catch what fixtures miss. For example, sub-agent results lack `toolUseResult`, and
  registry timestamps are not activity.

## 9. What a cloud agent cannot verify (leave a checklist for the owner)

A cloud runner has no Windows desktop, no signed-in `claude` and no real `~/.claude` data. Build,
test with fixtures, and cross-compile. Then write `docs/CHECKLIST-v0.2.0.md` for the owner to run on
their PC the next morning:
- start-up picker with 2 accounts
- two `ac` instances on different accounts
- send a prompt
- allow/deny
- answer a question
- auto-fork of a VS Code session
- keys in Windows Terminal (Shift/Alt+Enter, Tab, Esc)
- Vietnamese text and box-drawing on resize
- exe size

## 10. Working agreements with the owner

- They said: *"Just do it, no need to report first. When the TUI is done, push to git, create the
  release, I'll check tomorrow morning."* You are authorised to commit, push `main` and tag
  `v0.2.0` for this work.
- They prefer parallel work over strict waves, and few questions. Decide reasonable defaults and note
  them.
- End commit messages with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your own
  model's equivalent line).
- Final report: Vietnamese, short. Include what shipped, the download link, the checklist, and known
  gaps.
