# T05 — git: parsers, worktrees, overlap, project root (wave 1)

## Goal
Shell out to `git` (no libgit) for worktrees, changed files, diffs and project roots, and
compute overlaps, including the **live overlap** rule. Standard library only.

## Owns
`internal/gitx/**`.

## Reference
`src/main/git/gitParse.ts`, `worktreeService.ts`, `src/main/transcripts/projectResolver.ts`,
`src/shared/overlap.ts`, `src/renderer/src/components/team/OverlapBanner.tsx` (the live rule
lives in the renderer there — port it as a pure function here); tests
`tests/main/git/{gitParse,worktreeService}.test.ts`, `tests/shared/overlap.test.ts`,
`tests/main/transcripts/projectResolver.test.ts`.

## Steps
1. `parse.go`: `ParseWorktreeList` (porcelain; main first; detached, bare, locked, prunable;
   CRLF; spaces), `ParseStatusZ` (`-z`; renames/copies consume the extra field; unmerged → U;
   ignored skipped), `ParseLeftRight`, `ParseNumstatZ` (binary → nil counts; rename form),
   `PickBase`, `ParseSymbolicRef`, `MergeChanged` (committed vs uncommitted, cap, total).
2. `exec.go`: `Runner` interface `Run(ctx, dir string, args ...string) ([]byte, error)`; real
   implementation `exec.CommandContext("git", "-C", dir, "--no-optional-locks", ...)` with
   4 s timeout, `HideWindow`, `CREATE_NO_WINDOW` on Windows.
3. `worktrees.go`: `Snapshot(ctx, r Runner, root) (Workspace, error)` — worktree list, base
   resolution (origin/HEAD › main › master › origin/main › origin/master, cached 60 s), per
   worktree status + numstat vs `base...HEAD` + ahead/behind, bounded parallelism 4.
   `Diff(ctx, r, worktree, path) (string, error)` = committed (`base...HEAD -- path`) + uncommitted
   (`HEAD -- path`), capped 512 KiB.
4. `overlap.go`: `DetectOverlaps`, `WorktreeForCwd` (longest segment match, case-insensitive on
   Windows, prefix trap), `MapToWorktrees`, and **`LiveOverlaps(ws)`**: an overlap is live only
   when the file has **uncommitted** edits in two or more worktrees.
5. `project.go`: `Resolver` with `Provisional(cwd)`, `Cached(cwd)`, `Resolve(ctx, cwd)`
   (`rev-parse --path-format=absolute --git-common-dir`, 3 s timeout, cache by normalised cwd,
   in-flight dedupe via `singleflight`-style map, never errors → fallback cwd project).
   `Project{Key, Name, Root string; Git bool}`; key = lowercase `/`-normalised root (inline
   helper; no internal imports).

## Tests to port / write
All of `gitParse.test.ts` (R-08), `overlap.test.ts` (R-10), `projectResolver.test.ts`,
`worktreeService.test.ts` (with a fake `Runner` returning canned outputs). New: `LiveOverlaps`
table (committed-only in one, uncommitted in two → live; uncommitted in one only → not live).
One optional integration test behind `testing.Short()` skip that creates a temp repo with
`git init` + `git worktree add` and checks a real snapshot.

## Acceptance
`go vet ./...` · `go test ./internal/gitx/...` · `go build ./...` · `gofmt -l .` empty.
