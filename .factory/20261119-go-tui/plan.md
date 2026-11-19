# Run 20261119-go-tui — plan

Goal: rewrite Agent Console as `ac.exe`, a Go + Bubble Tea v2 TUI (spec: `docs/spec.md`).
Reference (read-only): `D:/personal/claude-ui-ref` at tag `electron-final`.

## Key decisions
- Conversation = transcript file for every session; the stream-json child only adds an
  overlay (typing, cards, state). Same as the old app, one render path.
- Controlled sessions run inside the TUI via `claude -p` stream-json; external sessions are
  read-only; `o` opens real `claude --resume` in a new WT tab (env set inside the command).
- One account per `ac` instance; many instances allowed; per-session lock files; atomic
  shared state; account accent colour on the status line.
- Hooks, images, rewind UI, team grid: not in v1.
- Deps: bubbletea v2, bubbles v2, lipgloss v2, fsnotify, atotto/clipboard, x/sys/windows.
  No glamour (own `mdlite`), no go-toast (PowerShell one-liner, opt-in).

## Wave 0 (orchestrator, 2 minutes, before wave 1)
Commit on `main`: `go.mod` with exactly
```
module github.com/longpl-1902/claude-ui

go 1.27
```
and add `ac.exe`, `*.test`, `/dist/` to `.gitignore`. Every task branch starts from this.
Only T01 adds `require` lines; other wave-1 tasks use the standard library (T03 also uses
`golang.org/x/sys/windows`: T01 pins it; T03 may run `go get golang.org/x/sys@<same version
as T01>` and the merge keeps one line).

## Waves
| Wave | Tasks (parallel inside a wave) |
|---|---|
| 1 | T01 scaffold+core+mdlite+platform · T02 transcript · T03 control · T04 accounts+pathx+safefs+statefile · T05 gitx |
| 2 | T06 session model · T07 index/watcher · T08 UI shell (fake backend) |
| 3 | T09 app backend + main wiring · T10 account picker + sign-in · T11 diff/worktree view |
| 4 | T12 end-to-end tests, release check, README |

Merge each task as soon as it is green (user asked for parallel work, not strict waves);
a wave-N task may start once the packages it imports are merged.

## Rules for every implementer
- Read `docs/spec.md` first; port behaviour from the named reference files, not their UI.
- Never run `claude` (except `claude --version` / `claude --help` where a task says so).
  No paid requests. Tests use fixtures and the fake claude.
- Neutral names only (`acme`, `C:/Users/u`, `u@example.com`). Never a real profile path.
- Own only the files listed in your task. Need a change elsewhere? Say so in the report.
- Each package: `go vet ./...`, `go test ./internal/<pkg>/...`, `gofmt -l .` empty,
  `go build ./...` green, from both `D:\personal\claude-ui` and `/d/personal/claude-ui`
  (drive-letter case).
- The checkout uses CRLF (autocrlf); tests that read source/testdata text must accept `\r\n`.
  Prefer adding `testdata/.gitattributes` with `* -text` so fixtures keep LF.
- Report: files changed, tests ported (old name → Go test), spec mismatches found.
