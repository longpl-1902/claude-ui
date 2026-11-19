# T01 — scaffold, core types, mdlite, platform (wave 1)

## Goal
Module layout, pinned dependencies, CI/release workflows, the shared view-model types,
the markdown-lite renderer and the Windows glue helpers.

## Owns
- `go.mod`, `go.sum` (the only task that adds `require` lines in wave 1)
- `cmd/ac/main.go` (stub; T09 takes it over in wave 3)
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `internal/core/**`, `internal/mdlite/**`, `internal/platform/**`

## Steps
1. Resolve and pin versions (`go list -m -versions`): Bubble Tea v2 (`charm.land/bubbletea/v2`,
   else `github.com/charmbracelet/bubbletea/v2`), Bubbles v2, Lip Gloss v2, fsnotify,
   atotto/clipboard, golang.org/x/sys. Record the chosen import paths in the report (T06–T11
   use them). Add a `tools.go`-free approach: deps appear in go.mod once imported; to pin
   before use, import them from `internal/platform` / `internal/mdlite` where natural, and add
   a tiny `cmd/ac` usage of bubbletea (`tea.NewProgram` of a placeholder model printing
   "ac <version>" and quitting) so `go mod tidy` keeps them.
2. `cmd/ac/main.go`: `var version = "dev"`; flags `--version`, `--account`, `--debug-log`
   parsed with `flag`; placeholder program.
3. `internal/core` — types only, no logic beyond `String()` methods and small helpers:
   - `AccountID string`; `Account{ID AccountID; Name, Color, ConfigDir, Kind, Email, Org string; SignedIn bool}`
   - `SessionKey{Account AccountID; SessionID string}` (+ `DraftID string` for drafts with no id yet)
   - `Status` enum `Done, Waiting, Running, NeedsYou`; `Severity` `Blocked, Idle`
   - `Source` `CLI, VSCode, AC, SDK, Unknown` (from transcript/registry `entrypoint`)
   - `Ctl` `{Kind CtlNone|CtlMine|CtlOtherAC|CtlElsewhere; PID int}`
   - `SessionSummary{Key; Title, ProjectKey, ProjectName, ProjectRoot, Cwd, Branch string; Status; Reason string; Source; Ctl; LastActivity time.Time; Tokens int64; Model string; Blocked, Idle bool}`
   - `ItemKind` `Prompt, Command, Text, Tool, Agent, Notice, Interrupted, CompactSummary`
   - `Item{ID string; Kind ItemKind; Time time.Time; Text string; Tool *ToolItem; Agent *AgentItem}`
   - `ToolItem{UseID, Name, Target, FilePath, Input, Result string; Open, Failed, Interrupted bool; Added, Removed int}`
   - `AgentItem{AgentID, Name, Type, Status string; ToolCalls int; Tokens int64}`
   - `Card{RequestID, ToolName, DisplayName, Preview, Description, Reason, BlockedPath string; Questions []Question; CanAllowSession bool; Since time.Time}`
   - `Question{Text, Header string; Options []Option; Multi bool}`, `Option{Label, Description string}`
   - `CtlInfo{State string; Model, Mode string; CtxPct float64; CostUSD float64; Version string; Commands []string; Models []string; Error string}`
   - `SessionView{Summary SessionSummary; Items []Item; Typing string; Thinking bool; Cards []Card; Ctl *CtlInfo; Notices []string; AgentPath []string}`
   - `Attention{Key SessionKey; AgentID, Kind, Detail string; Severity; Since time.Time}`
   - `Action` (tagged union per spec §3.4: `Kind ActionKind` + fields), `ChangedMsg`, `ErrMsg{Text}`, `InfoMsg{Title string; Lines []string}`
4. `internal/mdlite`: `Render(md string, width int, st Styles) []string`. Supports ATX
   headings, paragraphs (word wrap by display width, `lipgloss.Width`), `**bold**`, `*em*`,
   `` `code` ``, fenced code (no highlight, keep indentation, no wrap — truncate with `…`),
   `-`/`*`/`1.` lists with hanging indent, `>` quotes, `[text](url)` → `text (url)`, tables
   rendered as-is in monospace. Never panics on malformed input. Pure function.
5. `internal/platform` (Windows; build-tag stubs for others returning "unsupported"):
   - `OpenInWT(o WTOpen) (*exec.Cmd, error)`: builds the command of spec §5 (`wt -w 0 nt -d <cwd>
     --title <t> <pwsh|powershell> -NoLogo -NoExit -Command "<script>"`); validates cwd/configDir
     are absolute with no `'`/`"`/newline, session id is a UUID, claude path absolute. Fallback
     when `wt.exe` is not on PATH: `cmd /c start "" <shell> ...`. Pure builder + `Start`.
   - `EditorCmd(file string, line int, editorEnv, cfg string) (cmd *exec.Cmd, inTerminal bool)`:
     `$EDITOR`/config, default `nvim` if on PATH, else `notepad`. nvim/vim/hx/micro → in-terminal
     (`+line` arg); `code` → `code -g file:line` detached.
   - `Copy(text string) error` via atotto/clipboard.
   - `Bell()` writes `\a` to the terminal; `Toast(title, body string) error` runs
     `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command <fixed script>` with
     title/body passed through environment variables (not string-concatenated into the script).
6. CI/release workflows per spec §7 (windows-latest, setup-go from go.mod, vet, test, build with
   `-trimpath -ldflags "-s -w -X main.version=..."`, size check > 15 MB fails, release with
   `gh release create "$GITHUB_REF_NAME" ac.exe ac.exe.sha256 --generate-notes`).

## Tests
- `mdlite`: table tests for each construct, wrap at widths 20/80, malformed input (unclosed
  fence, `**` alone) never panics, golden output with ANSI stripped.
- `platform`: argument builders (WT command line exactly; refuses quotes/relative paths/bad id;
  editor selection table). No process is started in tests.
- `core`: compile-only plus `String()` tests.

## Acceptance
`go vet ./...` · `go test ./internal/core/... ./internal/mdlite/... ./internal/platform/...` ·
`go build -trimpath -ldflags "-s -w" -o ac.exe ./cmd/ac` and report the size · `gofmt -l .` empty.
