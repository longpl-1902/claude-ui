# ac — Agent Console (Go TUI) — spec

Status: v1 design, 2026-11-19. Replaces the Electron spec (kept in tag `electron-final`).
Module `github.com/longpl-1902/claude-ui`, binary `ac.exe`, Go 1.27, Windows 11 first.

## 1. Product goal

A lead runs many Claude Code sessions across several git projects and several Claude
accounts. `ac` is "Claude Code in the terminal, extended for a lead": one small,
keyboard-first screen in Windows Terminal that

- lists every session of every project, grouped by git project, with a live status;
- jumps straight to the sessions that need the lead (permission, question, error);
- **controls** sessions it starts or resumes (prompt, allow/deny, answer, interrupt,
  model, mode, stop) through the official `claude` CLI stream-json protocol;
- shows sessions running elsewhere (VS Code, another terminal) read-only, and can fork or
  resume them into a controlled one, or open them in a real `claude` tab;
- keeps several Claude accounts (`CLAUDE_CONFIG_DIR`s) apart, with one account per `ac`
  instance and as many instances as the lead wants.

Feel: lazygit / k9s. Vim modes, `:`-commands, no mouse needed.

Budgets: `ac.exe` < 15 MB (target ~8 MB), cold start to first paint < 300 ms with 50 sessions,
idle CPU ~0, RSS < 60 MB. No Node, no Chromium, no cgo, no installer.

## 2. UX

### 2.1 Screens

Only three screens plus overlays.

**A. Account picker** (on start, see §4.3)

```
 ac · choose an account
 ▸ work      ~/.claude-acme   dev@acme.example · Acme Ltd     signed in   last used
   personal  ~/.claude        u@example.com                   signed in
   test      ~/.claude-test   —                                not signed in
 enter use · s sign in · n add dir · e edit · * always use · q quit
```

**B. Main screen**

```
┌ Sessions · work ──────┐┌ acme-api · fix login flow · ● needs you ─────────────┐
│▾ acme-api         2!  ││ › Fix the login redirect bug                         │
│  ● fix login flow  !  ││ I'll look at the handler first.                      │
│  ○ add tests     run  ││ ✓ Read  src/auth/login.go                            │
│▾ acme-web             ││ ✓ Edit  src/auth/login.go  +12 −3                    │
│  ○ ui polish    idle  ││ … Bash  go test ./...                                 │
│▸ tools (3)            ││ ┌ Permission: Bash ──────────────────────────────┐   │
│                       ││ │ go test ./... -run Login                       │   │
│                       ││ │ a allow · A allow for session · d deny         │   │
└───────────────────────┘└───────────────────────────────────────────────────────┘
 NORMAL │ work dev@acme.example │ 2 need you (+1 other acct) │ 1.2M tok today │ opus · default · ctx 41%   ? help
 > _
```

- Left pane: sessions of the current account (`ga` toggles all accounts, then each row
  shows an account tag in that account's colour). Grouped by git project (main repo root,
  so linked worktrees group with their repo). Groups fold with `za`. Rows: status glyph,
  title (custom title › AI title › first prompt), badge (`!` blocked, `run`, `idle`, `done`),
  source mark (`C` controlled here, `c` controlled by another ac, `vs` VS Code, blank CLI).
  Shown: all live sessions + sessions active in the last `listDays` days (default 7).
- Right pane: the conversation of the selected session (or sub-agent), markdown-lite.
  Tool calls are one line, expandable (`Enter`/`za`) to show input preview and result text.
  Thinking is never shown. Permission and question cards render inline at the end.
  An `Agent(...)` line opens the sub-agent's own log with `Enter`; `-` goes back.
- Status line: mode, **account name + email in the account colour** (the mode block and the
  pane borders use the account accent so two terminals are easy to tell apart),
  needs-you count (and other accounts' count in brackets), tokens today (this account),
  model · permission mode · context % of the selected controlled session, hint.
- Prompt line (INSERT): multi-line textarea, grows to 8 lines. Prefix shows the target:
  `>` send prompt, `answer:` when a question card is focused (free-text "Other"),
  `draft>` for a draft session that has not spawned yet.
- Narrow windows (< 100 cols): the sessions pane hides; `Ctrl+w h` / `\` toggles it.

**C. Worktrees / diff view** (`:diff`): worktrees of the selected session's repo, their
changed files (+/−, committed vs uncommitted), and a **live overlap** banner. `Enter` on a
file shows a coloured unified diff in a read-only pager; `gf` opens the file in the editor.

**Overlays**: help (`?`), confirm (y/n), command line completion list, slash-command list,
`:ctx` / `:mcp` info boxes, error toast line (bottom, 5 s).

### 2.2 Modes

| Mode | Enter | Leave | Purpose |
|---|---|---|---|
| NORMAL | start, `Esc` | — | navigate, act on cards, scroll |
| INSERT | `i`, `I` (clear first) | `Esc` | type prompt / answer |
| COMMAND | `:` | `Enter` runs, `Esc` cancels | `:`-commands with Tab completion |
| SEARCH | `/` (forward only) | `Enter` keeps the match, `Esc` clears | search in the log; `n`/`N` next/prev |

### 2.3 Keymap (complete for v1)

Global (NORMAL unless noted)

| Key | Action |
|---|---|
| `?` | help overlay (this table) |
| `:` | command line |
| `i` / `I` | INSERT on the prompt (`I` clears it first) |
| `Esc` | back to NORMAL; close overlay; leave sub-agent view |
| `Tab` / `Ctrl+w w` | switch focus sessions ↔ log |
| `Ctrl+w h` / `Ctrl+w l` | focus sessions / log |
| `\` | show/hide sessions pane |
| `]n` / `[n` | next / previous **blocked** item (any session of this account; switches session and focuses the card) |
| `]r` / `[r` | next / previous **ready** (idle, waiting for a prompt) session |
| `a` | allow the focused permission card |
| `A` | allow for this session (only when the CLI offered session rules) |
| `d` / `D` | deny the focused card (`D` first asks for a reason sent to Claude) |
| `1`–`9` | pick option N of the focused question (multi-select: toggle; `Enter` submits) |
| `Ctrl+c` | interrupt the selected controlled session if busy; otherwise hint `:q` |
| `S-Tab` | cycle permission mode of the controlled session (default → acceptEdits → plan) |
| `o` | open the selected session in a new Windows Terminal tab (`claude --resume`) |
| `gf` | open the file of the item under the cursor in the editor |
| `y` | yank item under cursor (message text / tool result / file path) |
| `Y` | yank the whole visible conversation as markdown |
| `ga` | toggle "all accounts" in the session list |
| `gr` | refresh (rescan sessions, git) |
| `q` | close sub-agent view / overlay; on the main screen same as `:q` with confirm |

Sessions pane

| Key | Action |
|---|---|
| `j` / `k`, `↓` / `↑` | move |
| `gg` / `G` | first / last |
| `Enter` / `l` | open in the log pane (focus moves) |
| `za` / `h` | fold / unfold project group |
| `x` | `:stop` the selected controlled session (confirm) |

Log pane

| Key | Action |
|---|---|
| `j` / `k` | move cursor one item |
| `Ctrl+d` / `Ctrl+u` | half page |
| `Ctrl+e` / `Ctrl+y` | scroll one line |
| `gg` / `G` | top / bottom (`G` re-enables follow mode) |
| `[[` / `]]` | previous / next user prompt |
| `Enter` / `za` | expand / collapse tool item; open sub-agent log on an `Agent` item |
| `-` | back from sub-agent log to parent |
| `/` then `n` / `N` | search, next, previous (case-insensitive, smart-case) |
| mouse wheel | scroll (optional, `mouse = true`; hold Shift to select text in WT) |

INSERT

| Key | Action |
|---|---|
| `Enter` | send (or answer) |
| `Alt+Enter`, `Shift+Enter`, `Ctrl+j` | newline (Shift+Enter needs Bubble Tea v2 key disambiguation; Alt+Enter and Ctrl+j always work) |
| `Ctrl+p` / `Ctrl+n`, `↑`/`↓` on first/last line | prompt history (in memory, per session) |
| `Tab` | complete `/slash-command` (list from the CLI init/initialize) |
| `Ctrl+u` | clear line |
| `Esc` | NORMAL (text kept) |

### 2.4 `:`-commands

| Command | Action |
|---|---|
| `:new [dir]` | draft session in `dir` (default: the selected session's project root; Tab completes paths). Folder rules may ask to switch account (§4.4). Nothing is spawned until the first send. |
| `:resume` | make the selected session controlled here (draft; spawns `--resume <id>` on first send). Refused if it is live in another process; offers `:fork`. |
| `:fork` | draft that forks the selected session (`--resume <id> --fork-session` on first send). |
| `:diff` | worktrees / overlap view (§2.1 C) |
| `:account [name]` | switch this instance's account (opens the picker without a name) |
| `:model [name]` | set model of the controlled session (`set_model`); no arg lists models from `initialize` |
| `:mode <default\|acceptEdits\|plan\|auto\|dontAsk>` | `set_permission_mode` (never bypassPermissions) |
| `:interrupt` | same as `Ctrl+c` |
| `:stop` | stop the controlled session (deny pending, interrupt, close stdin, kill tree after 3 s) |
| `:rename <title>` | `rename_session` |
| `:ctx` | `get_context_usage` box |
| `:mcp` | `mcp_status` box |
| `:open` | same as `o` |
| `:q`, `:q!` | quit (confirm if any controlled session is busy; `:q!` skips it). Quitting stops our children. |
| `:help` | same as `?` |

## 3. Architecture

### 3.1 Packages

```
cmd/ac/                main: flags (--account, --version, --debug-log), wiring, tea.Program
internal/core/         shared view-model types (no logic, no deps)                      T01
internal/mdlite/       markdown-lite → lipgloss lines (headings, bold/italic, `code`,
                       fences, lists, quotes, links as text)                            T01
internal/platform/     Windows glue: wt tab, editor launch, clipboard, toast, bell        T01
internal/pathx/        path normalise / compare / expand ~ / display                     T04
internal/safefs/       read-only file access with the credential deny-list + allow-list  T04
internal/statefile/    app dirs, atomic JSON write, re-read on change, session locks     T04
internal/accounts/     config-dir detection, .claude.json display fields, profiles,
                       folder rules, launch safety, sign-in command                      T04
internal/transcript/   parseLine → Record, tailer, layout (project dir encoding, path
                       classification, registry entry)                                   T02
internal/control/      stream-json protocol, args, child env, claude binary resolve,
                       Windows process (job object), Session state machine               T03
internal/gitx/         porcelain parsers, worktree snapshot, project root resolver,
                       overlap + live overlap                                            T05
internal/session/      per-session model: records + control events → core.SessionView,
                       tokens, sub-agent tree, live status, attention                    T06
internal/index/        session discovery across accounts, registry, fsnotify + hot poll,
                       usage today                                                       T07
internal/ui/           Bubble Tea root model, panes, modes, keymap, prompt, cmdline,
                       help, cards; ui.Backend interface                                 T08
internal/ui/picker/    account picker screen + sign-in step                              T10
internal/ui/diffview/  worktrees / overlap / diff pager                                  T11
internal/app/          Backend implementation: wires accounts, index, sessions,
                       control, locks, attention, notifications                          T09
```

Wave-1 packages (`transcript`, `control`, `gitx`, `accounts`+`pathx`+`safefs`+`statefile`,
`core`/`mdlite`/`platform`) import **only the standard library** (plus lipgloss for mdlite,
`golang.org/x/sys/windows` for control/platform) so they build in parallel.

### 3.2 Dependencies (and why each is worth its bytes)

| Module | Why | Cost |
|---|---|---|
| Bubble Tea **v2** (`charm.land/bubbletea/v2`, else `github.com/charmbracelet/bubbletea/v2`) | the TUI runtime; v2 gives key disambiguation (Shift+Enter, Ctrl+i vs Tab) on Windows and built-in clipboard/mouse modes | core |
| Bubbles v2 (textarea, viewport, textinput) | multi-line prompt and command line; writing our own is not worth it | small |
| Lip Gloss v2 | styles, borders, colours (already a Bubble Tea dep) | small |
| `github.com/fsnotify/fsnotify` | directory change events (ReadDirectoryChangesW) | ~100 KB |
| `github.com/atotto/clipboard` | Win32 clipboard, pure Go, no deps; works in conhost too (OSC 52 via `tea.SetClipboard` is the fallback) | ~20 KB |
| `golang.org/x/sys/windows` | job objects, process flags (already transitive) | — |

Rejected: **glamour** (pulls goldmark + chroma, adds ~4–6 MB and slow first render) →
own `mdlite` (~300 lines, no syntax highlighting in v1). **go-toast** → `platform.Toast`
runs `powershell -NoProfile -Command` with a fixed script and escaped text (opt-in);
default notification is the terminal bell (`\a`), which flashes the WT tab/taskbar for free.
**teatest** not needed: UI tests drive `Update`/`View` directly with fixed sizes.
T01 pins exact versions with `go list -m -versions`; Bubble Tea v1.3.x is the fallback only
if v2 does not resolve (then Shift+Enter is dropped from the keymap).

### 3.3 Data flow

```
 fsnotify (projects/, project dirs, subagents/, sessions/)   hot-file poll (500 ms, open sessions)
            │                                                         │
            └──────────► index.Watcher ──(FileRecords, RegistryChanged)─┐
                                                                         ▼
 control.Session (one goroutine set per child) ──(control.Event)──► app.Store ──► session.Model (per session)
                                                                         │  mutex; marks dirty
                                                                         ▼
                                                 50 ms coalescing ticker: program.Send(core.ChangedMsg{})
                                                                         ▼
                                     ui.Model.Update → pulls backend.Sessions()/View() snapshots → View()
 ui key/command ──► backend method (returns tea.Cmd; slow work in the Cmd goroutine) ──► Store / control
```

- **One source of truth for the conversation: the transcript file**, for both external and
  controlled sessions (exactly as the old app). The control stream adds only an overlay:
  typing text (text deltas, top-level only), thinking flag, pending permission/question
  cards, state (starting/idle/busy/stopping/exited), notices, last turn cost/usage.
- Snapshots handed to the UI are immutable copies (`core.SessionView` built under the store
  lock, items slice shared copy-on-write). The UI never touches backend state directly.
- Throttling: control stream events are batched (50 ms, consecutive typing events collapse);
  `ChangedMsg` is sent at most every 50 ms; the status line clock ticks every 1 s only
  while something is running.

### 3.4 Bubble Tea model

- `ui.Model` holds: `mode`, `focus` (sessions|log), `screen` (picker|main|diff), window size,
  `sessionsPane` (rows, cursor, folds, allAccounts), `logPane` (key, agentID stack, items,
  cursor, expanded set, follow, search state), `prompt` (bubbles textarea + per-session
  history + drafts), `cmdline` (textinput + completion), `overlay`, `flash` message.
- Messages: `tea.KeyMsg`/`tea.KeyPressMsg`, `tea.WindowSizeMsg`, `tea.MouseWheelMsg`,
  `core.ChangedMsg`, `core.ErrMsg{Text}`, `core.InfoMsg{Title, Lines}` (ctx/mcp boxes),
  `tickMsg`, `editorDoneMsg`, `signInDoneMsg`, `pickerDoneMsg{Account}`.
- Key parsing: a small key-sequence matcher (`g g`, `] n`, `Ctrl+w w`, `z a`, digit counts not
  supported in v1) with a 1 s timeout shown in the hint area.
- Long operations (`:new` validation, git, `:ctx`) run in `tea.Cmd`s; results come back as
  messages. External programs that need the terminal (nvim, `claude` sign-in) use
  `tea.ExecProcess` so the TUI suspends and restores cleanly.

`ui.Backend` (owned by T08, implemented by T09):

```go
type Backend interface {
    Account() core.Account                 // this instance's account
    Accounts() []core.Account
    Sessions(all bool) []core.SessionSummary
    View(key core.SessionKey, agentID string) (core.SessionView, bool)
    Attention() (mine, others int, items []core.Attention)
    UsageToday() int64
    Do(a core.Action) tea.Cmd             // every user action; never blocks
    Completions(kind string, prefix string) []string // "path", "model", "slash", "account"
    SetNotify(func())                       // called (throttled) when anything changed
}
```

`core.Action` is a tagged struct: `Send{Key, Text}`, `Answer{Key, RequestID, Allow, ForSession,
Message, Answers map[string]string}`, `Interrupt{Key}`, `Stop{Key}`, `NewDraft{Dir}`,
`Resume{Key}`, `Fork{Key}`, `SetModel`, `SetMode`, `Rename`, `Ctx`, `Mcp`, `OpenWT{Key}`,
`OpenEditor{Path, Line}`, `Yank{Text}`, `SwitchAccount{ID}`, `SignIn{Dir}`, `Refresh`.

### 3.5 Controlled sessions (stream-json children)

Args (ported from `args.ts`, order fixed, validated, never a bypass/dangerous flag):

```
-p --input-format stream-json --output-format stream-json --verbose
--include-partial-messages --permission-prompt-tool stdio
--permission-mode <default|acceptEdits|plan|auto|dontAsk> --replay-user-messages
[--model M] [--effort E] [--resume ID [--fork-session [--resume-session-at UUID]]]
```

- Env: parent env minus `CLAUDECODE, CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_CHILD_SESSION,
  CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_EXECPATH, CLAUDE_CODE_MESSAGING_SOCKET,
  CLAUDE_CODE_MESSAGING_TOKEN, CLAUDE_CODE_SESSION_ATTENDED, CLAUDE_PID,
  CLAUDE_AGENT_SDK_VERSION, CLAUDE_CODE_EMIT_STARTUP_TIMING, CLAUDE_CODE_STARTUP_FAILURE_RESULTS,
  CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING, CLAUDE_CODE_QUESTION_PREVIEW_FORMAT,
  CLAUDE_CODE_ENABLE_TASKS, MCP_CONNECTION_NONBLOCKING, ELECTRON_RUN_AS_NODE, CLAUDE_CONFIG_DIR`
  (case-insensitive on Windows), then `CLAUDE_CONFIG_DIR=<abs account dir>` (must be absolute),
  `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`, `TERM`/`COLORTERM` defaults.
- Binary: `config.claudePath` if set, else PATH `claude.exe`; for an npm `claude.cmd` shim
  use `node_modules\@anthropic-ai\claude-code\bin\claude.exe` next to it; else
  `~/.local/bin/claude.exe`. **Never run a `.cmd` through cmd.exe** with our arguments
  (BatBadBut quoting) — report "claude.exe not found, set claudePath" instead.
  The version (`system/init.claude_code_version`) is shown in `:ctx`; the VS Code extension
  bundles a different CLI version than npm, so sessions may be resumed by a different version.
- Process (Windows): `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` (the child and its tool
  sub-processes get their own hidden console and cannot draw into the TUI), stdin/stdout/stderr
  pipes, the child is put in a **job object with KILL_ON_JOB_CLOSE**, so the whole tree dies if
  `ac` exits or crashes. `Stop`: deny all pending, `interrupt` if busy, close stdin, after 3 s
  `TerminateJobObject`.
- Goroutines per child: stdout line splitter (UTF-8 safe, CRLF ok, max line 16 MiB, over-long
  dropped and counted) → `ParseOutputLine` → state machine → events; stderr → 4 KiB ring
  (shown on non-zero exit, ANSI stripped); `Wait` → exit event.
- State machine: `draft → starting → idle ⇄ busy → stopping → exited` (exited may respawn on
  the next send with `--resume <sessionId>`). Port `controlSession.ts` semantics: outstanding
  turn counter, `requesting` status → busy, `result` → idle + turn cost, `can_use_tool` →
  pending card, unknown `control_request` → `encodeUnsupported`, `control_response` settles
  correlated requests (10 s timeout), `user-echo` records user turns.
- Permission answers: allow = `{behavior:"allow", updatedInput: input}`; allow-for-session adds
  `updatedPermissions` = suggestions filtered to `addRules|replaceRules|addDirectories|setMode`
  with `destination` forced to `"session"` (never a settings file); deny =
  `{behavior:"deny", message}`; AskUserQuestion = allow with `updatedInput = input + answers`
  where `answers[questionText] = label` (multi-select labels joined with `", "`).

### 3.6 File watching

- Roots: for every account, `<configDir>/projects` (transcripts) and `<configDir>/sessions`
  (live registry `<pid>.json`). All accounts are watched by every instance (cheap), the UI
  filters.
- fsnotify is not recursive on Windows: watch `projects/`, each project dir, and the
  `<session>/subagents/` dir of every session that is open or live; add watches when new dirs
  appear.
- **Hot-file poll**: Windows often does not report appends to a file that another process
  keeps open. Every 500 ms `os.Stat` the files of live / controlled / selected sessions and
  tail them when the size grows. Everything else relies on fsnotify plus a 30 s rescan.
- Tailing: port `tailer.ts` (backfill window 16 MiB, chunk 4 MiB, max line 8 MiB, reset on
  truncate or replaced file, partial line held back). On Windows use file creation time for
  "replaced".
- Index: list `projects/*/*.jsonl` by mtime; for each of the newest N read the first 64 KiB and
  last 256 KiB for cwd, entrypoint, titles (custom › ai › agent-name), first prompt; cache by
  (mtime,size). Sessions are loaded fully (tailed) only when selected, live, or controlled.
- Registry: `<configDir>/sessions/<pid>.json` → `{pid, sessionId, cwd, status busy|idle|waiting,
  waitingFor, updatedAt, name, entrypoint}`, kept only if the pid is alive. Only files whose
  name is `<digits>.json` are read; `*.key` and anything else in that dir is never opened.
- Project grouping: `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` (3 s
  timeout, cached per normalised cwd); the parent of a trailing `/.git` is the project root,
  else the cwd. Keys compare case-insensitively with `/` separators (drive letter case differs
  between tools: `d:\x` and `D:\x` are the same project).

## 4. Accounts

### 4.1 Model

`Account{ID, Name, Color, ConfigDir (abs), Kind company|personal|"" , Email, Org, SignedIn}`.
Email/org come **only** from `oauthAccount.emailAddress` / `oauthAccount.organizationName` in
`.claude.json` (default dir `~/.claude` → `~/.claude.json`; other dirs → `<dir>/.claude.json`;
fallback `<dir>/.config.json`). Nothing else from that file is kept in memory.

Detection (port `detect.ts`): `~/.claude`, `~/.claude-*` dirs that look like config dirs
(`.claude.json` or ≥ 2 markers: settings.json, projects, history.jsonl, sessions, todos,
statsig, shell-snapshots, file-history, plugins, ide), `CLAUDE_CONFIG_DIR` in the
environment, and VS Code user `settings.json` (JSONC) `claudeCode.environmentVariables`
entries for `CLAUDE_CONFIG_DIR`. Linked accounts live in the app config.

### 4.2 App state files (safe for many instances)

- `%APPDATA%\ac\config.json`: accounts (name, colour, dir, kind), folder rules, prefs
  (`claudePath`, `editor`, `listDays`, `mouse`, `toast`, safety toggles, `alwaysUseAccount`).
- `%LOCALAPPDATA%\ac\state.json`: `lastAccount` + `lastAccountAt` (most recent pick only).
- `%LOCALAPPDATA%\ac\locks\<sessionId>.lock`: controlled-session locks.

Rules: every write is **read-modify-write of the latest file** then atomic replace (write
`<file>.tmp-<pid>-<rand>`, fsync, `os.Rename` → MoveFileEx REPLACE_EXISTING; retry up to 5×
on sharing violations). Readers tolerate a missing/partial file (keep the last good value).
Instances re-read `config.json` when its mtime changes (checked on fsnotify of the dir and on
focus-relevant actions). No single-instance lock. `lastAccount` is only a preselection hint:
each running instance keeps its own account in memory and never re-reads it.

### 4.3 Start-up account choice

1. `ac --account <name|dir>` → use it (error + picker if unknown).
2. else `alwaysUseAccount` set and still present → use it.
3. else exactly one account → use it.
4. else show the picker, preselect `lastAccount`.

Picker rows show name, dir (display form `~/...`), email · org or "not signed in".
`Enter` use · `s` sign in the selected (or a new) dir · `n` add an existing dir · `e` rename /
colour / kind · `*` toggle always-use · `q` quit. `:account` re-opens it; switching changes
this instance only (running controlled sessions keep their own account).

**Sign in**: `tea.ExecProcess` runs the official `claude` (interactive, no args, or `claude
auth login` if the installed CLI has it — T10 checks `claude --help`) with
`CLAUDE_CONFIG_DIR=<dir>` in the same terminal; the user completes the CLI's own browser
login and exits; `ac` resumes and re-reads the display fields. `ac` never sees tokens.

### 4.4 Which account a new session uses

The instance's account, unless a folder rule (glob → account, first match wins; port
`folderRules.ts`) names a different one; then a confirm: "Folder rule `C:/work/acme/**` →
work. Use work? [y] yes · [c] current · [esc] cancel". Safety (port `safety.ts`): warn when a
personal account opens a company folder; refuse when another account already has a live
session in the same/nested folder (toggle `lockAccountPerFolder`, default on). Resume and fork
always use the account that owns the transcript.

### 4.5 Several instances at once

- Each `ac` is independent; two WT tabs/panes can run `ac --account work` and
  `ac --account personal`. Each spawns `claude` with its own `CLAUDE_CONFIG_DIR`.
- **One controller per session**: before spawning a child for a known session id (resume),
  and right after `system/init` reveals a new id (new / fork), the instance creates
  `locks\<sessionId>.lock` with `O_CREATE|O_EXCL` holding `{pid, startedAt (process create
  time), account}`. A lock is **stale** if the pid is dead or its create time differs (pid
  reuse); stale locks are removed and retaken (remove + O_EXCL again, so two instances cannot
  both win). Locks are released on stop/exit and on clean quit. A second instance shows the
  session read-only with "controlled by another ac (pid N)", and `:resume` is refused there
  (`:fork` is allowed).
- A session live in a non-`ac` process (registry pid alive) is "live elsewhere": `:resume`
  and `o` are refused with a hint to fork.
- Hooks: **not in v1** (see §9). If added later: one shared hook entry runs `ac hook`, which
  posts to every live instance listed in `%LOCALAPPDATA%\ac\endpoints\<pid>.json` (each
  instance its own 127.0.0.1 random port + token); install/uninstall takes the same lock
  mechanism so two instances never write settings at once.

## 5. Session lifecycle

| From | Action | Result |
|---|---|---|
| any transcript | select | read-only view (watch). Status from transcript + registry. |
| none | `:new [dir]` | draft (controlled, nothing spawned). First `Enter` spawns the child, then sends `initialize` (local, no model call), then the user frame. |
| external / ended | `:resume` | draft with `--resume <id>`, cwd = the session's recorded cwd (exact string from the transcript, else resume says "no conversation found"). Refused if live elsewhere or locked. |
| any | `:fork` | draft with `--resume <id> --fork-session`; new id from `init`, then locked. |
| any not controlled here | `o` | `wt -w 0 nt -d <cwd> --title <title> powershell -NoLogo -NoExit -Command "$env:CLAUDE_CONFIG_DIR='<dir>'; & '<claude.exe>' --resume <id>"` (pwsh if present). Env is set inside the command because `wt -w 0` hands the tab to the existing WT process, which does not inherit our env. Values validated (abs path without quotes, UUID). No WT → `cmd /c start` a new console window. |
| controlled | `Ctrl+c` / `:interrupt` | `control_request interrupt` |
| controlled | `:stop` / `x` | stop sequence (§3.5), lock released |
| controlled | quit `ac` | stop all children (job objects guarantee it), release locks |

Live status (port `liveStatus.ts`, hook reasons removed): done/finished, needs-you
(registry waiting, open AskUserQuestion/ExitPlanMode, API error, **pending control card**),
running (open tool < 30 min, model turn < 5 min, registry busy, control busy), waiting
(idle, interrupted, stale, no activity). Attention items (port `statusHub.ts`): **blocked**
(permission, question, plan, api-error, registry waiting) vs **idle** (ready for next
prompt: control idle or registry idle after an assistant reply). `]n` walks blocked, `]r`
walks idle; newest first. Notification on a new blocked item when the item's session is not
the one on screen: terminal bell by default, Windows toast if `toast = true`, at most one per
3 s, text only (never an Allow action in a toast).

Tokens: per message id dedupe (last usage wins); session tokens = input + output +
cacheCreation (cacheRead excluded); "today" = assistant lines with a local-date timestamp of
today, per account. API-error and `<synthetic>` lines count nothing.

## 6. Security rules

1. **Credentials**: never read, copy, log or store Claude credentials. `safefs` refuses any
   path whose basename is `.credentials.json` or ends with `.key`, and transcript/registry
   reads go through an allow-list (`*.jsonl`, `agent-*.meta.json`, `sessions/<digits>.json`,
   `.claude.json`, `.config.json`, VS Code `settings.json`, our own state files). A test
   greps the repo: the string `.credentials.json` appears only in `safefs`. No keychain /
   Credential Manager calls. Auth is always the official `claude` CLI.
2. **No silent settings edits**: v1 writes no Claude settings at all. Any future write shows
   the exact diff first and has an uninstall.
3. **R-19 no token spend**: nothing goes to Claude and no paid request is made without an
   explicit user action. A child is spawned only by the user's first send in that session.
   Local control requests (`initialize`, `mcp_status`, `get_context_usage`) are sent only in a
   running child (i.e. after that first send). No retries, keep-alives, warm-ups, prompt
   suggestions or automatic prompts. Tests use a fake `claude` (§8).
4. Never offer `bypassPermissions`/`--dangerously-*`. Session-rule suggestions are forced to
   `destination: "session"`.
5. Child processes get validated args only (model `^[A-Za-z0-9._\[\]-]{1,64}$` not starting
   with `-`, UUID session ids, enum modes/efforts); `.cmd` shims are never invoked.
6. Displayed tool input / decision reasons are ANSI-stripped and capped (500 / 2000 chars).
7. Privacy: fixtures and docs use neutral names (`acme`, `C:/Users/u`, `u@example.com`).
   `--debug-log <file>` logs event kinds and sizes, never prompt or result text.

## 7. Build and release

- `go build -trimpath -ldflags "-s -w -X main.version=<tag>" -o ac.exe ./cmd/ac`,
  `CGO_ENABLED=0`, `GOOS=windows GOARCH=amd64`.
- `.github/workflows/ci.yml`: on push/PR, `windows-latest`, `actions/setup-go` (go-version-file:
  go.mod), `go vet ./...`, `go test ./...`, build, size check (fail > 15 MB).
- `.github/workflows/release.yml`: on tag `v*`, same build, then `gh release create
  "$GITHUB_REF_NAME" ac.exe --generate-notes` (permissions: contents: write). No installer,
  no zip, just `ac.exe` (+ `ac.exe.sha256`).
- Install for the user: download `ac.exe`, put it on PATH. Optional WT profile snippet in the
  README.

## 8. Test plan

- Port the behavioural tests of the old app as Go **table tests**; keep the requirement tags
  (R-02 protocol, R-03 tailer/claudeJson, R-04 parseLine, R-05/06 session model, R-07 live
  status, R-08 git parse, R-10 overlap) in test names.
- Fixtures: the old fixtures are TS builders (`tests/fixtures/transcripts/builders.ts`,
  `trees.ts`). T02 writes equivalent synthetic `.jsonl` files under
  `internal/transcript/testdata/` (same ids: session `11111111-aaaa-4bbb-8ccc-000000000001`,
  cwd `d:\work\demo`, model `claude-test-opus`, T0 `2026-11-18T10:00:00Z`); T03 writes
  stream-json lines under `internal/control/testdata/`. Shared with T06/T07 by path.
- **Fake claude**: the control test binary re-execs itself as a scripted fake CLI when
  `AC_FAKE_CLAUDE=<script>` is set (standard Go re-exec trick), replaying stream-json lines
  and asserting the frames it receives. No real `claude` run in tests or CI.
- Required new tests: session lock (acquire, second acquire fails, stale by dead pid, stale by
  pid reuse, concurrent takeover race with 20 goroutines → exactly one winner), atomic state
  write (concurrent writers from goroutines + a child process never yield a partial/corrupt
  file; reader during write sees old or new), credential deny-list, R-19 (a draft never
  spawns; no frame before the first send; local requests only after spawn), args never
  contain dangerous flags, env stripping, live-overlap rule.
- UI: drive `ui.Model.Update` with key messages against a fake `Backend` at 120×40 and 80×24;
  golden `View()` strings for the main screen, cards, picker, help (normalise ANSI).
- Manual check before release (no tokens): `ac` against real local transcripts read-only;
  one controlled session with a tiny prompt only if the user agrees.

## 9. Not in v1

- Hook installer / local hook server (registry + transcript already cover needs-you).
- Images / paste of images, `@file` mention completion, `file_suggestions`.
- `rewind_files` UI, `get_plan`, effort / output-style pickers (protocol encoders exist).
- MCP toggle/reconnect (`:mcp` is read-only).
- Killing external (non-ac) Claude processes.
- Timeline swimlanes, shared task list, mailbox view, team grid.
- Pop-out windows, themes beyond the account accent, light/dark detection (use terminal
  defaults).
- Persistent prompt history, settings UI (edit `config.json` by hand; `:account` covers accounts).
- macOS/Linux builds (code stays portable where free; CI builds Windows only).
- Syntax highlighting in code blocks.
- Auto-update.
