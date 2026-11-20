# Drop 1 (v0.2.0): remaining work, implementation spec

Author: architect. Base commit: `86a0d43`. Implementers: Sonnet agents, one per task.
This file is a **spec, not code**. Where it conflicts with `docs/spec.md`, this file wins.
`docs/HANDOFF.md` §3–§5 still win over both.

Neutral names only in code, fixtures and messages: `acme`, `C:/Users/u`, `u@example.com`.

---

## 0. State of the code (what exists, what is wrong)

| Area | State at 86a0d43 | Gap |
|---|---|---|
| `internal/control` | `args.go`, `env.go`, `binary.go`, `linesplitter.go`, `protocol.go` done and tested. `session.go` holds only `State`, `EventKind`, `Event`. | **No runtime**: no process spawn, no job object, no `Session` with `Send/Answer/Interrupt/Stop`, no fake claude. T03 items 5–7 were never built. |
| `internal/app/app.go` | Scans transcripts + registry. `doSend/doAnswer/doInterrupt/doStop/doFork` are stubs. | Everything in §2. Also: `LoadSession` is never called, so `View` shows no items. `scanAccountSessions` skips known sessions, so `Ctl`/`Status` never reset when a process ends. Registry pids are not checked for liveness. |
| `internal/app/locks.go` | `AcquireLock/ReleaseLock/CheckLock` work, tested. | `LockInfo.Account` never filled. `isProcessAlive` on Windows returns true for any pid `OpenProcess` accepts (exited processes with open handles, pid reuse). Nothing calls the lock functions. |
| `internal/statefile` | `WriteJSONAtomic`, `Update`, plus a second, unused session-lock API (`AcquireSession`, `SessionOwner`). | Duplicate lock API; `app/locks.go` is the canonical one. |
| Picker UI | `viewPicker`, `handlePicker` done. | Enter sets `m.acct` and sends `ActionRefresh`; `refresh()` re-reads `backend.Account()` and the old account comes back. `NewModel` shows the picker whenever >1 account, ignoring `--account` / always-use. `main.go` writes `state.LastAccount` at exit from the stale `active` (and clobbers other instances). |
| UI keys | Most vim keys exist. | `handleEnter` emits `ActionFork` when a session is live elsewhere (wrong: fork happens at send time, §2.6). `Tab` switches panes (rule 3.3 says `Tab` = next needs-you). Ctrl+C in INSERT does not interrupt. No `Esc Esc`. Backspace cuts bytes, breaks UTF-8 (Vietnamese). `truncPad` slices bytes of styled strings, breaks ANSI and wide runes. Answer only handles `Questions[0]` and the **last** card. Start mode is NORMAL (rule 3.1 says INSERT). |

---

## 1. Task list and file ownership

Five tasks. **W0** is a 5-minute orchestrator commit. **T13, T14, T15, T16 run in parallel**
(up to 4 agents; with 3 slots, run T16 after T15). **T17** runs after all four are merged.

| Task | Title | Owns (only these files) | Depends on (API frozen here) | Merge order |
|---|---|---|---|---|
| W0 | Core types | `internal/core/types.go` | none | first |
| T13 | Control runtime + fake claude | `internal/control/proc.go`, `proc_windows.go`, `proc_other.go`, `runner.go`, `card.go`, `session.go` (add types only), `runner_test.go`, `proc_test.go`, `card_test.go`, `main_test.go`, `internal/control/testdata/*.script`, `internal/control/fakeclaude/**` | W0 | 2 |
| T15 | Locks, account switch, picker start-up | `internal/app/locks.go`, `locks_test.go`, `procalive_windows.go`, `procalive_other.go`, `account.go`, `account_test.go`, `internal/ui/startup.go` (new; picker code moves here), `internal/accounts/accounts.go`, `accounts_test.go`, `cmd/ac/main.go`, `go.mod`, `go.sum`, `internal/statefile/statefile.go`, `statefile_test.go` | W0 | 1 |
| T14 | Store control wiring | `internal/app/app.go`, `internal/app/control.go` (new), `internal/app/controller.go` (new), `internal/app/live.go` (new), `internal/app/control_test.go`, `internal/app/testutil_test.go` | W0, T13 API (§2.1), T15 API (§3.1, §3.3) | 3 (last of the wave; rebase on T13 + T15) |
| T16 | UI behaviour | `internal/ui/model.go`, `internal/ui/keys.go` (except functions moved by T15) | W0, T15 `NewModel` signature (§3.4) | 3 (any order after T15) |
| T17 | Integration tests | `internal/app/main_test.go`, `internal/app/e2e_test.go`, `internal/app/testdata/**`, `internal/ui/model_test.go`, `internal/ui/fakebackend_test.go`, `internal/ui/picker_test.go` | all | 4 |

Rules for shared files:
- `internal/ui/model.go` / `keys.go`: T15 **removes** `NewModel`, `viewPicker`, `handlePicker`
  and the picker fields block from them and re-creates them in `startup.go`. T16 must not edit
  those functions. Git merges the disjoint hunks.
- `internal/app/app.go` `Do()` dispatch is owned by T14. T14 adds the dispatch lines for
  `ActionSwitchAccount` and `ActionSignIn`; the functions they call live in T15's
  `account.go`. T14 does **not** stub them (duplicate definitions would break the merge);
  T14 builds against T15's branch or rebases once T15 lands.
- T14 calls T13's `control.New` only from `controller.go` (`realController`). Until T13 lands,
  T14 tests use the in-package fake controller (§2.2), so T14 can work in parallel.

Acceptance for every task: `go vet ./...`, `go test -race ./...`, `gofmt -l .` empty,
`go build ./...`, and `GOOS=windows GOARCH=amd64 go build ./...` green. **No real `claude`
runs** in any test (R-19). Report: files changed, tests added, deviations from this spec.

---

## W0. Core type additions (orchestrator commits before the wave)

In `internal/core/types.go`, add:

1. `type OpenMsg struct{ Key SessionKey }` — a backend result asking the UI to show `Key` in
   the log pane (used after a new session, a fork or an auto-fork).
2. `type CardKind int` with `CardPermission` (0), `CardQuestion`, `CardPlan`, and a field
   `Kind CardKind` on `Card`. `IsPermission()` stays `len(Questions)==0` (true for plan cards,
   so `a`/`d` keep working); add `IsPlan() bool { return Kind == CardPlan }`.
3. `Account.AlwaysUse bool` — set by the backend on the account remembered as "always use".
4. `SessionSummary.CtlWhere string` — human text for "where else it runs", filled by the store
   (e.g. `VS Code`, `a terminal (pid 4242)`, `another ac (pid 4242)`). Empty when not elsewhere.

No other core changes in this drop. Field order and names are frozen.

---

## T13. Control runtime and fake claude (`internal/control`)

### 2.1 Frozen public API (T14 codes against this)

Process layer (`proc.go`, `proc_windows.go` `//go:build windows`, `proc_other.go` `//go:build !windows`):

- `type Proc interface { Stdin() io.WriteCloser; Stdout() io.Reader; Stderr() io.Reader; Wait() (code int, err error); KillTree() error; Pid() int }`
- `type Spawner interface { Start(path string, args, env []string, cwd string) (Proc, error) }`
- `var DefaultSpawner Spawner` — the OS implementation.
- Windows: `exec.Cmd` with `SysProcAttr{CreationFlags: CREATE_NO_WINDOW|CREATE_NEW_PROCESS_GROUP, HideWindow: true}`;
  create a job object (`windows.CreateJobObject`), set `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`
  with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, `AssignProcessToJobObject` immediately after
  `Start` (open the process handle with `PROCESS_SET_QUOTA|PROCESS_TERMINATE`). Keep the job
  handle open for the life of `ac` (so a crash of `ac` kills the tree). `KillTree` =
  `TerminateJobObject(job, 1)`; `Wait` closes the job handle after the process exits.
- Other OS: `Setpgid: true`; `KillTree` = `syscall.Kill(-pgid, SIGKILL)`.
- `cwd` must exist; otherwise return an error that names the cwd (the store shows it).

Session layer (`runner.go`; new types may go in `session.go`):

- `type Deps struct { Spawner Spawner; BaseEnv []string; Now func() time.Time; StopGrace time.Duration; RequestTimeout time.Duration; BatchWindow time.Duration }`
  Zero values default to `DefaultSpawner`, `os.Environ()`, `time.Now`, 3 s, 10 s, 50 ms.
- `func New(l Launch, d Deps) *Session` — **spawns nothing**, writes nothing. `Launch` already
  has `ClaudePath, ConfigDir, Mode, Model, Effort, SessionID, Fork, ResumeAt, Cwd`.
- `func (s *Session) Send(text string) error`
- `type Answer struct { Allow bool; ForSession bool; Message string; Answers map[string]string }`
- `func (s *Session) Answer(reqID string, a Answer) error`
- `func (s *Session) Interrupt() error` — `ErrNotBusy` when state is not busy/starting.
- `func (s *Session) SetModel(model string) error`, `func (s *Session) SetMode(mode string) error` (validated with the regex/set from `args.go`; only while live, else stored for the next spawn).
- `func (s *Session) Request(ctx context.Context, kind ReqKind, params map[string]any) (json.RawMessage, error)` — correlated by `FormatRequestID(n)`, `RequestTimeout`, `ErrNotLive` before the first spawn.
- `func (s *Session) Stop(ctx context.Context) error`
- `func (s *Session) Close()` — `Stop` with a 3 s context, then closes `Events()`.
- `func (s *Session) Info() Info`
- `func (s *Session) Pending() []core.Card` — copies, oldest first.
- `func (s *Session) Events() <-chan Event` — buffered (256). Never closed before `Close`.
- `type Info struct { State State; SessionID, Model, Mode, Version string; Commands, Models []string; CostUSD, CtxPct float64; PID int; Error string; Spawns int }`
- Errors: `var ErrNotBusy, ErrNotLive, ErrUnknownRequest, ErrClosed error`.

Event contract (existing `Event` struct; semantics frozen):

| Kind | When | Fields used |
|---|---|---|
| `EvState` | every state change | `Text` = `State.String()` |
| `EvInit` | `system/init` | `SessionID, Model, Version, Commands` |
| `EvTyping` | text delta of a top-level message | `Text` = **accumulated** text of the current message id (port `controlSession.ts:366`) |
| `EvTypingClear` | message complete / result / interrupt | — |
| `EvThinking` | thinking block start/stop | `Thinking` |
| `EvPermission` | `can_use_tool` | `Card` (built by `card.go`), `RequestID` |
| `EvPermissionResolved` | after we wrote the response, or the child cancelled it | `RequestID` |
| `EvTurnEnd` | `result` | `Cost, Usage, Text` = stop reason |
| `EvNotice` | non-fatal problems (dropped over-long line, unknown control request answered `unsupported`, denied-by-stop) | `Text` |
| `EvDetails` | `initialize`/`get_context_usage`/`mcp_status` responses | `Info` raw JSON; `Text` = which |
| `EvExited` | process exit | `Code`, `Error` = last 4 KiB stderr, ANSI stripped, only when `Code != 0` |

Consecutive `EvTyping` events inside `BatchWindow` collapse to the last one.

### 2.2 Behaviour

State machine `draft → starting → idle ⇄ busy → stopping → exited` (port `controlSession.ts`):

1. **`Send(text)`** (empty text → error, nothing written):
   - state `draft` or `exited`: build args with `BuildArgs(l)`; on `exited` with a known
     `SessionID` from init, relaunch with `SessionID = that id`, `Fork = false`,
     `ResumeAt = ""`. Env = `ChildEnv(d.BaseEnv, l.ConfigDir)`. Spawn. State `starting`.
     Write `initialize` request (`EncodeRequest`) **then** the user frame
     (`EncodeUserTurn`). Increment `Info.Spawns`.
   - state `idle`/`busy`/`starting`: write the user frame (claude queues it).
   - Turn counter +1; state `busy`.
   - Writes go through one `writeFrame` under the session mutex; a write error →
     `EvNotice` + returned error.
2. **stdout goroutine**: `NewLineSplitter` → `ParseOutputLine` → handle:
   `MsgInit` → store ids, `EvInit`, then (R-19 allowed: after the user's send) write
   `mcp_status` request; `MsgStatus "requesting"` → busy; `MsgStreamEvent` → typing/thinking;
   `MsgAssistant` → `EvTypingClear`; `MsgResult` → turn counter −1, when 0 → idle, `EvTurnEnd`,
   then `get_context_usage` request (parse `percentage`/`used/total` into `CtxPct` 0..1);
   `MsgCanUseTool` → record `pending[reqID] = {input, suggestions, card}`, `EvPermission`;
   other `MsgControlRequest` → if it is a cancel for a pending request (`subtype` cancel /
   `control_cancel_request`) drop the card + `EvPermissionResolved`, else write
   `EncodeUnsupported` + `EvNotice`; `MsgControlResponse` → settle the waiter in `Request`.
   Dropped lines (`Dropped()` growth) → `EvNotice "dropped N over-long line(s)"`.
3. **stderr goroutine**: 4 KiB ring buffer.
4. **wait goroutine**: `Wait()` → state `exited`, deny nothing (process gone), clear pending,
   fail all `Request` waiters with `ErrNotLive`, `EvExited`.
5. **`Answer(reqID, a)`**: unknown id → `ErrUnknownRequest`. Encoding:
   - plan / permission allow: `EncodeAllow(reqID, input, rules)` where `rules =
     SessionScopedSuggestions(suggestions)` only when `a.ForSession`, else nil.
   - question: `EncodeAllowWithAnswers(reqID, input, a.Answers)`. Multi-select values are
     already joined by the UI with `", "`; the runner does not re-join.
   - deny: `EncodeDeny(reqID, msg)`; empty msg → `"Denied by user"`; for plan cards
     `"User rejected the plan"`.
   - Remove from pending, emit `EvPermissionResolved`.
6. **`Interrupt()`**: busy/starting only. Deny all pending with `"Interrupted by user"`
   (emit resolved for each), then write `EncodeRequest(id, ReqInterrupt, nil)`. Never send an
   OS signal (CTRL_BREAK is unreliable with `CREATE_NEW_PROCESS_GROUP` and `-p`).
7. **`Stop(ctx)`**: draft → state exited, return. Else state `stopping`; deny all pending
   (`"Stopped by user"`); if busy, `Interrupt`; close stdin; wait for exit up to
   `min(StopGrace, ctx deadline)`; then `KillTree`; wait for the wait goroutine. Idempotent.
8. All shared state behind one `sync.Mutex`; never hold it while blocking on a channel send
   to `Events()` (send outside the lock, or drop typing events when the buffer is full —
   never drop any other kind).

### 2.3 Card building (`card.go`)

`func CardFromMsg(m Msg, now time.Time) core.Card`:
- `RequestID, ToolName, DisplayName, Description, Reason, BlockedPath, CanAllowSession` copied.
- `Kind`: `AskUserQuestion` (or `len(m.Questions)>0`) → `CardQuestion`; `ExitPlanMode` →
  `CardPlan`; else `CardPermission`.
- `Questions` from `m.Questions`, or parsed from `input.questions` when the envelope had none.
- `Preview` (one to a few lines, capped 2000 runes, ANSI stripped): Bash → `input.command`;
  Edit/Write/Read/NotebookEdit → `input.file_path`; WebFetch → `input.url`; ExitPlanMode →
  `input.plan`; else compact JSON of input capped 300 runes.
- `Since = now`.

### 2.4 Fake claude (`internal/control/fakeclaude`)

A normal (non-test) package so both `control` and `app` tests can use it:
- `const EnvScript = "AC_FAKE_CLAUDE"`, `const EnvLog = "AC_FAKE_CLAUDE_LOG"`.
- `func MaybeRun()` — if `EnvScript` is set, run the script and `os.Exit(code)`; else return.
  Test packages call it first thing in `TestMain`; the claude path in tests is `os.Args[0]`.
- When `EnvLog` is set, append one JSON line per event to that file: `{"argv":[...], "cwd":..., "env_config_dir":...}` at start, then every stdin frame received. Tests assert on this log
  (spawn count = number of argv lines).
- Script format (`testdata/*.script`, one directive per line, `#` comments):
  `expect <json-subset>` (next stdin frame must contain these keys/values; mismatch → stderr
  message, exit 3), `reply <json body>` (write a `control_response` whose `request_id` is the
  last expected frame's), `emit <json line>` (`{{session}}` → a fixed UUID
  `11111111-2222-4333-8444-555555555555`, `{{fork}}` → `...666666666666`), `sleep <ms>`,
  `stderr <text>`, `wait-eof` (block until stdin closes), `hang` (ignore stdin EOF, sleep
  forever), `grandchild` (re-exec self with `AC_FAKE_CLAUDE=hang-script` so tree kill can be
  tested; write its pid to the log), `exit <code>`.
- At stdin EOF without `exit`, exit 0.

### 2.5 Tests (T13)

`main_test.go` calls `fakeclaude.MaybeRun()`. Cases (port `controlSession.test.ts` /
`controlV2.test.ts`): draft never spawns; no frame before the first `Send`; `initialize`
precedes the user frame; allow / allow-for-session (destination forced to `session`) / deny
(default messages) / question answers / plan approve; unknown control request →
`unsupported`; interrupt only when busy and denies pending first; stop sequence with a `hang`
child is killed after `StopGrace` (use 200 ms); grandchild dies with `KillTree` (Windows: job;
Unix: pgid); non-zero exit carries stderr; second `Send` after exit respawns with
`--resume <init id>` and no `--fork-session`; `Request` timeout; typing coalescing; `-race`.

---

## T14. Store control wiring (`internal/app`)

### 2.6 Data model

`controller.go`:
- `type controller interface { Send(string) error; Answer(string, control.Answer) error; Interrupt() error; SetModel(string) error; SetMode(string) error; Request(context.Context, control.ReqKind, map[string]any) (json.RawMessage, error); Stop(context.Context) error; Close(); Info() control.Info; Pending() []core.Card; Events() <-chan control.Event }`
  (`*control.Session` satisfies it.)
- `type newControllerFunc func(l control.Launch) controller`; the real one wraps
  `control.New(l, control.Deps{Spawner: opts.Spawner, BaseEnv: opts.Env})`.

`app.go` constructor:
- `type Options struct { Dirs statefile.AppDirs; ClaudePath string; Env []string; Spawner control.Spawner; NewController newControllerFunc; LaunchDir string; Home string; Now func() time.Time; NotifyDelay time.Duration }`
- `func NewWithOptions(acct core.Account, all []core.Account, cfg accounts.Config, o Options) *Store`;
  `New(...)` = `NewWithOptions` with defaults (`statefile.GetDirs()`, resolved claude path,
  `os.Environ()`, `os.Getwd()`, `os.UserHomeDir()`, 50 ms).
- `func (s *Store) Close()` — §2.12.

Replace `controlledSession` with (in `control.go`):

| Field | Meaning |
|---|---|
| `key core.SessionKey` | current key; starts as a draft key, gains `SessionID` at init |
| `ctl controller` | the runtime |
| `account core.Account` | account whose `ConfigDir` the child uses |
| `cwd string` | exact cwd passed to the child |
| `forkedFrom string` | parent session id, if a fork |
| `locked string` | session id we hold a lock for ("" = none) |
| `typing string`, `thinking bool` | overlay |
| `cards []core.Card` | pending, oldest first |
| `info core.CtlInfo` | for `SessionView.Ctl` |
| `notices []core.Item` | `ItemNotice` items, capped 50, with `Time` |
| `echo *core.Item` | optimistic prompt shown until the transcript has it |
| `done chan struct{}` | closed when the pump exits |

`Store` gains: `alias map[string]string` (draftID → sessionID), `opts Options`,
`notifyPending atomic.Bool`, `forkSeq int`. `controlSessions` is keyed by
`keyID(k) = k.SessionID if set else k.DraftID`. A helper `resolve(k) (id string)` follows
`alias` for draft ids. **Every** public method that takes a key goes through `resolve`.

### 2.7 Send flow (`doSend`) — the auto-resume / auto-fork rule

```
doSend(a)                                    [no lock]
 ├─ text = a.Text; empty → ChangedMsg
 ├─ lock mu
 │   ├─ key zero ───────────────► draft := newDraft(LaunchDir)              (case N)
 │   ├─ pending question card on cs and text not a command
 │   │                 ──────────► answer "Other": Answers{q0.Text: text}    (case Q)
 │   ├─ cs exists (mine) ───────► target = cs                               (case M)
 │   ├─ key is draft, no cs ────► cs = newControlled(draft, Launch{Cwd})    (case D)
 │   └─ key is a transcript session:
 │        live := liveWhere(ss)   // registry pid alive, or lock by another live ac
 │        ├─ live == "" → AcquireLock(id, acct)
 │        │     ok   → cs = newControlled(key, Launch{SessionID:id, Cwd: ss.Cwd})  (case R)
 │        │     held → live = "another ac (pid N)"; fall through to fork
 │        └─ live != "" → fork := newDraft(ss.Cwd) copying title/project,
 │                       cs = newControlled(fork, Launch{SessionID:id, Fork:true, Cwd: ss.Cwd}),
 │                       cs.forkedFrom = id,
 │                       cs.notices += "↳ forked from <id[:8]> because it is running in <live>"   (case F)
 │   cs.echo = ItemPrompt{Text: text, Time: now}
 ├─ unlock
 ├─ err := cs.ctl.Send(text)          // may spawn; never under mu
 ├─ err → lock; drop echo; if cs is new and never spawned, remove it and release lock; unlock;
 │        return ErrMsg{"send failed: <err>"}
 └─ return OpenMsg{cs.key} for N, F (and D when the UI key differs); else ChangedMsg
```

Details:
- **Account for the child**: case R/F use the session's own account (`ss.summary.Key.Account`
  → look up in `s.accounts`); resume must use the config dir that owns the transcript. Case
  N/D: `accounts.MatchFolder(cfg.Rules, cwd, home)` if it names a known account, else
  `s.account`. If the chosen account has `SignedIn == false` → `ErrMsg{"<name> is not signed
  in — :account, then s to sign in"}` and nothing spawns.
- **Cwd for resume/fork**: `ss.summary.Cwd` exactly as in the transcript (no normalising);
  if it no longer exists → `ErrMsg{"project folder is gone: <cwd>"}`.
- **`liveWhere(ss)`** returns `ss.summary.CtlWhere` computed by the live pass (§2.10). It
  must be recomputed right before deciding (call `refreshLive(acct)` for that one account,
  cheap), so a session that just ended is resumed, not forked.
- **Launch fields**: `ClaudePath = s.claudePath` (empty → `ErrMsg{"claude.exe not found; set
  prefs.claudePath"}`), `ConfigDir = account.ConfigDir` (absolute; else error), `Mode =
  "default"`.
- **Draft creation** (`newDraft(dir)`): reuse `doNewDraft` logic, extracted into a helper that
  runs under `mu`; `DraftID = "draft-<forkSeq>"` (counter, not time, for test determinism).
  `doNewDraft` keeps returning `ChangedMsg` but should now return `OpenMsg{key}` too.
- **R-19**: only `doSend` (and case Q) ever reaches `controller.Send`/`Answer`. No other
  code path spawns or writes. Auto-fork costs no extra request: the fork is the same spawn
  that carries the user's prompt.

### 2.8 Event pump

`newControlled` starts `go s.pump(cs)`:

```
for ev := range cs.ctl.Events() {
    s.mu.Lock(); s.apply(cs, ev); s.mu.Unlock()
    s.kick()
}
close(cs.done)
```

`apply(cs, ev)` (under `mu`; no I/O except the lock file at init):

| Event | Effect |
|---|---|
| `EvState` | `cs.info.State = ev.Text`; summary `Status`: starting/busy → Running, idle → Waiting, stopping/exited → Done; `Ctl = {CtlMine, os.Getpid()}`; `CtlWhere = ""` |
| `EvInit` | `info.Model/Version/Commands`. If `cs.key.SessionID == ""` (draft or fork): set it, `alias[draftID] = id`, move `s.sessions[draftID]` to `s.sessions[id]` (keep `Key.DraftID` so old UI keys still match), move `controlSessions` entry, `AcquireLock(locks, id, acct)` (failure → notice, keep going: a brand-new id cannot be held by anyone), set `filePath = <ConfigDir>/projects/<transcript.EncodeProjectDir(cwd)>/<id>.jsonl` |
| `EvTyping` | `cs.typing = ev.Text` |
| `EvTypingClear` | `cs.typing = ""` |
| `EvThinking` | `cs.thinking = ev.Thinking` |
| `EvPermission` | append `*ev.Card`; `Blocked = true`; `Status = NeedsYou`; `Reason` = `permission: <DisplayName>` / `question` / `plan` |
| `EvPermissionResolved` | remove card by `RequestID`; `Blocked = len(cards) > 0`; recompute `Reason` |
| `EvTurnEnd` | `info.CostUSD += ev.Cost`; `typing = ""`; invalidate the transcript (`ss.view = nil`, force re-tail) |
| `EvNotice` | append notice item |
| `EvDetails` | `Text=="get_context_usage"` → `info.CtxPct`; `"initialize"` → `info.Models`, `info.Commands` |
| `EvExited` | `info.State = "exited"`; clear cards/typing/thinking; `Code != 0` → `info.Error` + notice `claude exited (code N): <stderr first line>`. Keep the lock and the entry: the next send respawns with `--resume` (control does that) |

`kick()`: if `notifyPending.CompareAndSwap(false, true)`, `time.AfterFunc(NotifyDelay, func(){ notifyPending.Store(false); fn := s.getNotify(); if fn != nil { fn() } })`.
**Never call `notify` while holding `mu`**: `notify` is `p.Send`, which blocks until `Update`
runs, and `Update` calls back into the store → deadlock.

### 2.9 View merge

`View(key)`:
1. `id := resolve(key)`; look up `ss`. Missing → `false`.
2. `ensureLoaded(ss)`: if `filePath == ""` return; `safefs.Stat`; if size/mtime differ from
   the last read, read new complete lines with `ss.tailer` (`transcript.NewTailer`, keyed by
   path) and append parsed records (`ShouldSkipRaw`, `ParseLine`); first read of a file over
   20 MB starts at the last 20 MB and adds a notice "older history not loaded". Invalidate
   `ss.view`. (This replaces the unused `LoadSession`; delete it.)
3. Items = cached `recordToItems` of all records (cache in `ss.view.Items`).
4. If controlled: merge `cs.notices` and `cs.echo` into items by `Time` (stable; notices go
   **before** a transcript item with the same time). Drop `cs.echo` once a `ItemPrompt` with
   identical text and `Time >= echo.Time - 2s` exists in the transcript.
   Set `Typing`, `Thinking`, `Cards` (copy), `Ctl = &copy(cs.info)`.
5. Return a copy; the UI never sees store-owned slices.

Tool items: `recordToItems` emits separate items for use and result with the same ID. Merge
them in the item cache: a result fills `Result/Failed/Added/Removed` of the earlier use item
and sets `Open = false`; it is not a new item (the current code shows every tool twice).

### 2.10 Live pass (`live.go`) — `Ctl`, `CtlWhere`, `Status`

`refreshLive(acct)` runs at the end of `scanAccountSessions` for **all** sessions of the
account, not only new ones:
1. For each session not in `controlSessions`: reset `Ctl = {CtlNone,0}`, `CtlWhere = ""`,
   `Status = StatusDone` (keep `Blocked=false` unless set below).
2. Registry `sessions/<pid>.json` (never `.key`): skip when the pid is dead
   (`isProcessAlive` from T15) or equals the pid of one of our own children
   (`cs.ctl.Info().PID`). Else `Status` from the entry, `Ctl = {CtlElsewhere, pid}`,
   `CtlWhere` = `VS Code` (source vscode) / `an SDK process (pid N)` (sdk) /
   `a terminal (pid N)` (cli or unknown); `Blocked = status=="waiting"`, `Reason =
   "waiting in <where>"`.
3. Locks: `ListLocks(s.opts.Dirs.Locks)` once per scan (T15, §3.1). For each live lock whose
   pid is not ours: `Ctl = {CtlOtherAC, pid}`, `CtlWhere = "another ac (pid N[, account])"`.
   Lock wins over registry (the other ac's child is in the registry too).
4. Sessions in `controlSessions`: `Ctl = {CtlMine, os.Getpid()}`, status from `cs.info.State`,
   `Blocked = len(cs.cards) > 0`.

`Attention()` additionally counts controlled sessions with cards; `Since` = oldest card time.
`Kind` = `permission|question|plan|waiting`.

### 2.11 Answer, interrupt, stop, fork

- **`doAnswer(a)`**: `cs := controlled(resolve(a.Key))`; none → `ErrMsg{"not controlled
  here"}`. Card by `a.RequestID` missing → `ErrMsg{"already answered"}`. Call
  `cs.ctl.Answer(reqID, control.Answer{Allow, ForSession, Message, Answers})` outside `mu`.
  The card disappears on `EvPermissionResolved`. Return `ChangedMsg`.
- **`doInterrupt(a)`**: `cs` missing → `ErrMsg{"nothing to interrupt"}`;
  `ErrNotBusy` → `ErrMsg{"not running"}`. Otherwise `ChangedMsg`.
- **`doStop(a)`**: draft without a spawn → remove the draft row, `ChangedMsg`. Else
  `cs.ctl.Stop(ctx 5 s)` outside `mu`, then `cs.ctl.Close()`, wait `cs.done` (≤1 s), then
  under `mu`: delete from `controlSessions`, `ReleaseLock(cs.locked)`, summary `Ctl` none,
  `Status` done, `Blocked` false. Return `ChangedMsg`.
- **`doFork(a)`** (explicit `:fork`): needs a `SessionID` (draft → `ErrMsg{"nothing to fork
  yet"}`). Create fork draft + controller exactly as case F of §2.7 but **do not send**; notice
  `↳ forked from <id[:8]>`. Return `OpenMsg{forkKey}`. Spawn happens on the first send.
- **`ActionSetModel/SetMode`**: on `cs` → `SetModel/SetMode`; errors → `ErrMsg`.
- **`ActionCtx` / `ActionMcp`**: only for a live `cs` (R-19: after the first send);
  `Request(ctx 10 s, get_context_usage|mcp_status)` → `InfoMsg` with a few summary lines;
  not live → `ErrMsg{"send a prompt first"}`.
- **Dispatch additions in `Do`** (T14 owns): `ActionSetModel, ActionSetMode, ActionCtx,
  ActionMcp, ActionSwitchAccount → s.doSwitchAccount(a)`. Before the closure:
  `ActionSignIn → return s.signInCmd(a)` (it returns a `tea.ExecProcess` command; T15).

### 2.12 Thread safety and shutdown

- `mu` guards `sessions`, `controlSessions`, `alias`, `account`, `accounts`. Fix the existing
  unlocked reads (`doNewDraft` reading `s.account`, `Completions` reading `s.accounts`).
- Never hold `mu` while calling `controller` methods, `notify`, `statefile.Update`, or
  `tea.ExecProcess`. Lock-file I/O under `mu` is allowed (small, local).
- `Close()`: snapshot all `cs` under `mu`; outside it, `Stop` all in parallel
  (`sync.WaitGroup`, ctx 4 s), `Close` each; release every lock we hold. Idempotent.
  `main.go` (T15) calls `store.Close()` after `p.Run()` returns, also on error.
- Crash: the job object kills the children; our lock files become stale and are reclaimed
  by pid-liveness (§3.2).

### 2.13 Tests (T14, `control_test.go` + `testutil_test.go`)

`testutil_test.go` (shared with T17): `newTestStore(t, opt ...func(*Options)) (*Store, *fakeCtlFactory)`:
temp dirs for `Config/Local/Locks`, one account `acme` at `t.TempDir()/acme` with a
`.claude.json` (`u@example.com`, `SignedIn` true), `LaunchDir` = a temp project dir,
`ClaudePath = "fake"`, `NewController` = a fake factory recording each `Launch` and
returning a `fakeCtl` whose `Events()` channel the test feeds and whose calls are recorded.
Helper `writeTranscript(t, acct, cwd, id, fixture)` copies
`internal/transcript/testdata/lead_basic.jsonl` (rewrite its `cwd`).

Cases (all with the fake controller, `-race`):
1. **R-19**: `NewWithOptions`, `Sessions`, `View`, `doNewDraft`, `doFork` → zero `Send` calls
   on any fake; the factory may be called by `doFork` but `Send` count is 0.
2. Zero key send → draft in `LaunchDir`, `OpenMsg` with the draft key, one `Send(text)`.
   Feed `EvInit{id}` → `View(draftKey)` resolves to the session; lock file exists with our pid
   and `Account == "acme"`.
3. Resume idle transcript session → `Launch{SessionID:id, Fork:false, Cwd:<transcript cwd>}`,
   lock acquired **before** `Send`.
4. Registry entry with a live foreign pid (`os.Getppid()`), entrypoint `vscode` → fork
   `Launch{SessionID:id, Fork:true}`, `OpenMsg` to a new draft key, notice text exactly
   `↳ forked from <id[:8]> because it is running in VS Code`, original session unchanged.
5. Lock held by `os.Getppid()` → fork, `where = another ac (pid N, acme)`.
6. Stale lock (pid 999999999) → resume, not fork.
7. Own child's pid in the registry → still `CtlMine`, not elsewhere.
8. `EvPermission` → `View.Cards` 1, `Blocked`, `Attention()` mine 1; `doAnswer` allow →
   fake recorded `Answer(reqID, {Allow:true})`; feed resolved → cards 0, attention 0.
9. `doAnswer` unknown request → `ErrMsg`.
10. Pending question + send text → `Answer` with `Answers{q:text}`, no `Send`.
11. `doInterrupt` with fake returning `ErrNotBusy` → `ErrMsg{"not running"}`.
12. `doStop` → `Stop`, `Close` called, lock released, `Ctl` none.
13. `EvExited{Code:1, Error:"boom"}` → notice `claude exited (code 1): boom`, `Ctl.Error`.
14. Not signed-in account → `ErrMsg`, factory not called.
15. Notify: 200 `EvTyping` in a burst → notify called ≤ 3 times; the notify func calls
    `s.Account()` (would deadlock if called under `mu`; test has a 2 s timeout).
16. `Close()` stops every fake and removes every lock.
17. Tool use + result produce **one** item with the result filled.

---

## T15. Locks, account switch, picker start-up

### 3.1 Locks (`internal/app/locks.go`) — frozen API

- `type LockInfo struct { PID int; Account string; Since time.Time; Started int64 }`
  (`json:"pid"`, `"account"`, `"since"`, `"started,omitempty"`). `Started` = the holder's
  process start time in Unix ms (0 when unknown).
- `func AcquireLock(locksDir, sessionID string, account core.AccountID) (bool, *LockInfo, error)` —
  as today plus `Account` and `Started = processStart(os.Getpid())`. Validate `sessionID`
  against the UUID regex (reject path tricks); invalid → error.
- `func ReleaseLock(locksDir, sessionID string) error` — remove **only if** the file's pid is
  ours (another instance may have taken over a stale lock).
- `func CheckLock(locksDir, sessionID string) *LockInfo` — unchanged semantics, uses
  `lockAlive`.
- `func ListLocks(locksDir string) map[string]LockInfo` — one `ReadDir`; parse every
  `<uuid>.lock`; skip `*.tmp-*`; remove stale ones; return live ones (including ours; callers
  filter by pid).
- `func lockAlive(info LockInfo) bool` = `isProcessAlive(pid)` and, when both `info.Started`
  and `processStart(pid)` are non-zero, they are equal (±1 s) — catches pid reuse.
- Locks dir = `statefile.GetDirs().Locks` (`%LOCALAPPDATA%\ac\locks`): one per user, shared by
  all instances and accounts.

File format (pretty JSON, written via temp + hard link, unchanged):
`{"pid": 4242, "account": "acme", "since": "2026-11-19T08:00:00Z", "started": 1763539200000}`

### 3.2 Process liveness (`procalive_windows.go`, `procalive_other.go`)

- `func isProcessAlive(pid int) bool` and `func processStart(pid int) int64` move out of
  `locks.go` into build-tagged files.
- Windows (`//go:build windows`, `golang.org/x/sys/windows`, now a direct dependency):
  `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)`; `ERROR_ACCESS_DENIED` → alive
  (exists, protected); any other error → dead; `GetExitCodeProcess` → alive iff
  `STILL_ACTIVE (259)`; `CloseHandle`. `processStart`: `GetProcessTimes` creation `Filetime`
  → Unix ms; 0 on error.
- Other: `Signal(0)` with `EPERM` = alive (as now). `processStart`: Linux reads
  `/proc/<pid>/stat` field 22 (clock ticks since boot) + boot time from `/proc/stat btime`;
  anything else returns 0 (pid-reuse check is skipped).
- pid ≤ 0 → dead.

### 3.3 Account switch and sign-in (`internal/app/account.go`)

- `func (s *Store) doSwitchAccount(a core.Action) tea.Msg`: find account where
  `ID == a.ID` or `Name` equal-fold `a.ID`; none → `ErrMsg{"unknown account: <id>"}`. Under
  `mu`: `s.account = acct`. Outside `mu`: `statefile.Update[accounts.State](<Config>/state.json,
  fn: LastAccount = id, LastAccountAt = now ms)`; an error → `ErrMsg{"could not save
  last account: ..."}` but the switch stays. Controlled sessions of the old account keep
  running (each child carries its own config dir). Return `ChangedMsg`.
- `ActionSwitchAccount` with `a.Text == "always"` additionally sets `State.AlwaysUse = id`;
  `a.Text == "never"` clears it.
- `func (s *Store) signInCmd(a core.Action) tea.Cmd`: account by `a.ID`; claude path missing
  → cmd returning `ErrMsg`. Build `exec.Cmd{Path: claudePath, Args: [claude, "auth", "login"],
  Env: control.ChildEnv(os.Environ(), acct.ConfigDir), Dir: home}` (reference:
  `electron-final:src/main/accounts/signIn.ts:190`). Return `tea.ExecProcess(cmd, func(err)
  tea.Msg { s.reloadDisplay(acct.ID); if err != nil → ErrMsg{"sign-in failed: ..."}; else
  ChangedMsg })`. This is the official login flow; it spends no tokens and we never read
  credentials. `reloadDisplay` re-reads `accounts.ReadDisplay(configDir, home)` into
  `s.accounts[i]` (and `s.account` when it is the same id).
- `Accounts()` sets `AlwaysUse` on the account matching `State.AlwaysUse` (read the state
  file at most once per second; cache).

### 3.4 Picker start-up (`internal/ui/startup.go`)

Moved here from `model.go`/`keys.go`: `NewModel`, picker fields, `viewPicker`, `handlePicker`.

- `type Options struct { ShowPicker bool }` and `func NewModel(b Backend, o Options) Model`.
  Picker shown iff `o.ShowPicker && len(b.Accounts()) > 1`. Start `mode = ModeInsert`,
  `focus = FocusLog` (cursor already in the prompt line, rule 3.1).
- Picker rows: `▸` cursor, colour swatch `●` in the account colour, name, email (or
  `not signed in` in red/faint), org, `(always)` when `AlwaysUse`, `(current)` for the
  backend's account. Footer: `j/k move · Enter use · u always use · s sign in · q quit`.
- Keys: `j/k/down/up` move; `Enter` → `screen = ScreenMain`, `mode = ModeInsert`,
  `m.acct = a`, accent from `a.Color`, cmd = `backend.Do(Action{Kind: ActionSwitchAccount, ID:
  string(a.ID)})` (fixes the revert bug: the store now reports the new account);
  `u` → same with `Text: "always"` (toggles to `"never"` when the account already has
  `AlwaysUse`); `s` → `backend.Do(Action{Kind: ActionSignIn, ID})`, stay on the picker;
  `Enter` on a not-signed-in row → same as `s`; `q`/`ctrl+c` → quit when it is the start-up
  picker, back to main when opened by `:account` (`m.pickerFromCmd`); `esc` likewise.
- `func (m Model) openPicker() Model` — used by `:account` (T16 calls it from
  `executeCommand`; T15 provides it).

### 3.5 Accounts and `main.go`

- `accounts.State` gains `AlwaysUse string \`json:"alwaysUse,omitempty"\``.
  `ChooseStartup`: order = `--account` flag → `cfg.Prefs.AlwaysUseAccount` →
  `state.AlwaysUse` (if it still exists) → single account → picker preselecting
  `state.LastAccount`. Add table tests for each branch.
- `main.go`: pass `ui.Options{ShowPicker: showPicker}`; choose `active` = the account whose ID
  equals `startID` (also when the picker shows, so it preselects the last-used account);
  **remove** the exit-time `state.json` write (the store persists on selection); call
  `store.Close()` after `p.Run()`; `SetNotify` before `p.Run()` (as now).
- `statefile`: delete `AcquireSession`, `SessionOwner`, `Lock`, `LockInfo`, `ProcInfo` and
  their tests if `grep` finds no non-test callers.

### 3.6 Tests (T15)

`locks_test.go`: acquire/release; second acquire by "another pid" (write a lock with
`os.Getppid()`) → not acquired, info returned with account; stale dead pid → reclaimed;
`Started` mismatch → stale; corrupt file → reclaimed; `ReleaseLock` leaves a lock owned by a
different pid; invalid session id rejected; `ListLocks` cleans stale and skips temp files;
20 goroutines racing `AcquireLock` → exactly one wins.
`account_test.go`: switch persists `state.json` and `Account()` returns the new one; unknown
id → `ErrMsg`; two stores (two "instances") switching concurrently produce valid JSON with
one of the two values; `always`/`never`. `accounts_test.go`: `ChooseStartup` table.
Windows-only liveness test (`//go:build windows`): own pid alive, a finished child's pid
dead.

---

## T16. UI behaviour (`internal/ui/model.go`, `keys.go`)

### 4.1 Messages

- `core.OpenMsg{Key}` → `logKey = Key`, `focus = FocusLog`, `logFollow = true`, keep mode,
  `refresh()`.
- `refresh()`: after `View`, if `view.Summary.Key.SessionID != ""` and differs from
  `logKey.SessionID`, adopt the view's key (draft → real id). When `screen == ScreenPicker`,
  also reload `pickerAccounts = backend.Accounts()` (T15 owns the picker, T16 owns refresh).
- `tickMsg` → `refresh()` only when the current view's `Ctl.State` is busy/starting or any
  session is running; otherwise just re-arm the tick.
- `ErrMsg` flash clears after 5 s (check on tick).

### 4.2 Keys (rule 3.3–3.4)

| Key | New behaviour |
|---|---|
| `Enter` (NORMAL, sessions pane, session row) | `logKey = s.Key`, `focus = FocusLog`, `mode = ModeInsert`, `refresh()`. **No `ActionFork`** (delete `CtlElsewhereHere`). |
| `Enter` (NORMAL, no sessions / no selection) | `mode = ModeInsert` with `logKey` zero (next send starts a new session in the launch dir). |
| `Enter` (INSERT) | `ActionSend{Key: logKey, Text}` (zero key allowed). |
| `Tab`, `]n` | `jumpAttention(+1)`; `[n` → `-1`. Cycles through `Attention()` items with `Severity == SeverityBlocked`, starting after the current `logKey`. Saves `returnKey` (+ focus, mode) the first time. |
| `ctrl+w w/h/l` | pane switch (Tab no longer does it). |
| `a` / `A` / `d` | act on the **oldest** card (`Cards[0]`); `A` only if `CanAllowSession`. After the action, if `returnKey` is set, go back to it and clear it. |
| `1`–`9` | question card: pick option for the current question index `m.qIdx`; single-select stores the label and advances `qIdx`; multi-select toggles (`m.qSel`), `Enter` in NORMAL confirms the current question. When every question has an answer, send `ActionAnswer{Answers}` (multi labels joined `", "` in option order), reset `qIdx/qSel`. Plan card: `1` = approve (= `a`). |
| `ctrl+c` | if the log view's `Ctl.State` is busy/starting → `ActionInterrupt` (any mode, mode unchanged); else INSERT/COMMAND/SEARCH → NORMAL; else flash `:q to quit`. |
| `esc esc` (NORMAL, within 1 s, no overlay) | `ActionInterrupt` when busy. |
| `shift+enter`, `alt+enter`, `ctrl+j` (INSERT) | newline. |
| `backspace` (INSERT/COMMAND/SEARCH) | delete one **rune** (`utf8.DecodeLastRuneInString`). |
| `:account` | `m.openPicker()` (T15). `:account <name>` unchanged. |
| `:fork`, `:stop`, `:interrupt`, `:model`, `:mode`, `:new`, `:q` | unchanged dispatch. Remove `:resume` if present. |

### 4.3 Rendering

- `truncPad` → use `ansi.Truncate(s, w, "…")` and `ansi.StringWidth` from
  `github.com/charmbracelet/x/ansi` (already in the module graph). No byte slicing anywhere.
- Session rows: badge from `Ctl`: `CtlMine` → `ac•`, `CtlOtherAC` → `ac:<pid>`,
  `CtlElsewhere` → `vs`/`cli` by `Source`; blocked → `!`.
- Log header: title, then `· needs you` when blocked, then for a session with `CtlWhere !=
  ""` and not controlled here: `· read-only — running in <CtlWhere>; typing forks it` (for
  `CtlOtherAC` this reads `running in another ac (pid N)`, matching HANDOFF §4).
- Cards: plan card shows `Plan` header, the plan text (Preview, rendered with `mdlite`),
  footer `a approve · d reject`; question card shows `q i/n`, options numbered, selected
  marks for multi-select, footer `1-9 pick · Enter confirm · type + Enter = other`;
  permission footer shows `A` only when `CanAllowSession`.
- Notice items starting with `↳` render in the accent colour, one line.
- Status line: mode, account name in accent colour, email, `N need you`, tokens, model/mode/ctx,
  and `ctl: <state>` when controlled.

---

## T17. Integration tests (after merge)

### 5.1 `internal/app` with the real runtime and fake claude

`main_test.go`: `func TestMain(m)` → `fakeclaude.MaybeRun()` then `os.Exit(m.Run())`.
Helper on top of T14's `newTestStore`: real `NewController` (`control.New`) with
`ClaudePath = os.Args[0]`, `Env = os.Environ() + AC_FAKE_CLAUDE=<script> + AC_FAKE_CLAUDE_LOG=<tmp>`,
`StopGrace` 200 ms. Scripts under `internal/app/testdata/`.

Cases:
1. **R-19 end to end**: build the store, list sessions, open views, `:new`, `:fork`, wait
   500 ms → the fake log file does not exist (no spawn).
2. New session: send `hello` → log shows argv without `--resume`, cwd = launch dir,
   `CLAUDE_CONFIG_DIR` = account dir, frames `initialize` then `{"type":"user"}` with `hello`;
   script emits init/stream/assistant/result → `View` typing appears then clears, `Ctl.State`
   ends `idle`, cost recorded, lock file for `{{session}}` exists.
3. Permission round trip with Bash `can_use_tool` → card visible → `a` → fake `expect`s
   `{"type":"control_response","body":{"behavior":"allow"}}` → result.
4. Allow-for-session: frame has `updatedPermissions[0].destination == "session"`.
5. AskUserQuestion: frame `updatedInput.answers` equals the picked labels.
6. Auto-fork of a VS Code session: registry fixture with `os.Getppid()` and entrypoint
   `vscode` → argv has `--resume <id> --fork-session`; notice present; `OpenMsg` key resolves
   to `{{fork}}` after init.
7. Interrupt during a `sleep 2000` turn → fake receives `interrupt` request.
8. Stop with a `hang` script → process gone within 1 s; lock removed.
9. Exit 2 with `stderr boom` → notice; second send respawns with `--resume {{session}}`;
   log has two argv lines.
10. `Close()` with two live children → both gone, both locks removed.
11. Two stores sharing one locks dir (simulates two `ac`): store A controls a session; store B
    (fake pid source: B's lock check sees A's lock with a foreign pid written by the test)
    shows `CtlOtherAC` and its send forks.

### 5.2 `internal/ui` (no backend process at all)

`fakebackend_test.go`: `fakeBackend` implementing `Backend` with settable accounts,
sessions, views, attention; `Do` records the action and returns a cmd that applies simple
effects (switch account changes `Account()`; send with zero key returns `OpenMsg`).
Helpers: `press(m, keys ...string) Model` that maps names to `tea.KeyPressMsg`
(`"enter"` → `Code: tea.KeyEnter`; `"ctrl+c"` → `Code: 'c', Mod: tea.ModCtrl`; runes →
`Code: r, Text: string(r)`), runs `Update`, and **executes returned cmds** synchronously
(feeding their msgs back, depth ≤ 5, skipping `tea.Tick`/`tea.Quit`/batch of ticks);
`size(m, w, h)`; `plain(m.View().Content)` stripped with `ansi.Strip`.

Cases:
1. Picker shown with 2 accounts and `ShowPicker`; `j`, `Enter` → recorded
   `ActionSwitchAccount{ID: second}`; after the cmd round trip the status line shows the
   second account (regression for the revert bug); screen main, mode INSERT.
2. `ShowPicker` false → main screen, INSERT, no picker even with 2 accounts.
3. Picker `u` → `Text: "always"`; `s` → `ActionSignIn`; not-signed-in row renders
   `not signed in`.
4. INSERT: type `xin chào`, backspace twice → `xin ch` (rune-safe); Enter → `ActionSend`
   with zero key and the text; prompt cleared; `OpenMsg` sets `logKey`.
5. `alt+enter` inserts newline; prompt height grows, capped at 8.
6. Enter on a session row whose `Ctl` is `CtlElsewhere` → no `ActionFork` recorded; INSERT;
   header shows `read-only — running in VS Code`.
7. `Tab` with two blocked sessions jumps to the first, `a` sends `ActionAnswer{Allow:true}`
   for `Cards[0]`, then the view returns to the previous session.
8. Question card with 2 questions: `2` then `1` → one `ActionAnswer` with both answers;
   multi-select `1`,`3`,`Enter` → labels joined `", "`.
9. `ctrl+c` with `Ctl.State == "busy"` in INSERT → `ActionInterrupt`, mode stays INSERT;
   `esc esc` in NORMAL → `ActionInterrupt`.
10. `:fork`, `:stop`, `:q` → recorded actions / quit.
11. Render at 40×10 and 200×50 with a CJK/Vietnamese title and styled text → no panic, every
    line width ≤ terminal width.

### 5.3 CI note

Tests never call real `claude`: the only executable spawned is the test binary itself
(`os.Args[0]`) with `AC_FAKE_CLAUDE` set. Add a guard test in `internal/app`: with
`AC_FAKE_CLAUDE` unset, `newTestStore` must have `ClaudePath` set to the test binary or a
fake factory — fail if it resolves to a real `claude` on PATH.

---

## 6. Keystroke check (rule 3.5, after this drop)

| Flow | Keys |
|---|---|
| Open, send first prompt (1 account) | `ac`, type, `Enter` |
| Open, send first prompt (2 accounts) | `ac`, `Enter` (last-used preselected), type, `Enter` |
| Answer a pending permission | `Tab`, `a` |
| Continue another project's session | `Esc`, `ctrl+w h`, `j…`, `Enter`, type, `Enter` |
| New session in another project | `:new <dir>` `Enter`, type, `Enter` |
| Switch account | `:account` `Enter`, `j`, `Enter` |

## 7. Decisions taken (defaults, noted for the owner)

- Interrupt uses the protocol `interrupt` request, never an OS signal.
- A controlled session keeps its lock after its child exits (until `:stop` or quit), so a
  crash-respawn does not race another instance.
- "Last project" fallback for new sessions is not stored; the launch dir is always used.
- `config.json` is never rewritten by `ac` (it is JSONC, user-edited); "always use" lives in
  `state.json` as `alwaysUse`.
- Sign-in runs `claude auth login` in the foreground via `tea.ExecProcess` (TUI suspends).
