# T08 - Worktree service (poll, triggers, no overlapping runs, compare diffs)

- Wave: 3
- Depends on: T01, T03
- Spec refs: R-09, spec "3. Git worktrees"
- Tests: tests/main/git/worktreeService.test.ts

## Goal
For the selected git project, run the verified git commands on a 5 s poll plus change triggers, build a
`WorkspaceSnapshot` with per-worktree changed files, ahead/behind and overlaps, and serve "Compare diffs".

## Owned files
- create: src/main/git/worktreeService.ts
- create: tests/main/git/worktreeService.test.ts

## Read-only context
- src/main/git/gitParse.ts, src/shared/overlap.ts (T03)
- src/main/transcripts/projectResolver.ts (`ExecFn`, GIT_TIMEOUT_MS style)
- src/main/transcripts/transcriptService.ts (`WatchDir`/chokidar factory style)
- plan.md Verified fact 12, Decision D10

## Notes
```ts
export interface WorktreeServiceDeps { exec: ExecFn; platform: NodeJS.Platform; watchFiles?: (paths: string[], onChange: () => void) => { close(): void }; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (t: unknown) => void; now: () => Date }
export interface WorktreeService {
  watch(root: string | null): Promise<WorkspaceSnapshot>   // switch project (null = stop); returns the first snapshot (or the cached one)
  poke(): void                                              // debounced 500 ms trigger (file edited by an agent)
  current(): WorkspaceSnapshot
  compare(root: string, path: string): Promise<FileDiff[]>  // per worktree containing the file: `git -C <wt> --no-optional-locks diff <base>... -- <path>` + uncommitted `diff HEAD -- <path>`; 200 kB cap each -> truncated
  onChanged(cb: (s: WorkspaceSnapshot) => void): () => void
  dispose(): void
}
export function createWorktreeService(deps: WorktreeServiceDeps): WorktreeService
```
Cycle (one at a time; if a trigger arrives mid-cycle set `pending` and run once more after; poll timer re-armed after
each cycle ends, 5 s): 
1. `git -C root worktree list --porcelain` (skip bare; prunable shown with error 'prunable', no further calls).
2. Base (cached 60 s): `git -C root symbolic-ref --quiet refs/remotes/origin/HEAD` (failure = none) then
   `git -C root rev-parse --verify --quiet <ref>^{commit}` for candidates via `pickBase`.
3. Per worktree, max 3 in parallel: `git -C <wt> --no-optional-locks status --porcelain=v1 -z --untracked-files=all`;
   if base: `git -C <wt> rev-list --left-right --count <base>...HEAD` and `git -C <wt> diff --numstat -z <base>...HEAD`.
   Each exec has `timeout: 4000, windowsHide: true`; a failing call sets `error` on that worktree only.
4. `mergeChanged` -> files; `detectOverlaps`; push only when the JSON differs from the last push.
Every git arg list starts with `-C <path>` and never goes through a shell; `--` before user paths in compare.
`compare` validates `path` (relative, no `..` segments, no leading `-`) and that `root` equals the watched root.
Watchers: the main worktree's `.git/HEAD`, `.git/index`, and `<commonDir>/worktrees/*/HEAD|index` from step 1
(re-created when the worktree set changes) -> poke. `watch(null)` closes timers and watchers.
Tests (fake exec keyed by args, fake timers): main + linked worktree, overlap pushed, base fallback main, no base ->
ahead/behind null, one worktree failing, no overlap of cycles when exec is slow (exec call count), pending re-run
after a trigger, poll interval, switching roots cancels old timers, compare path validation, change-only pushes.

## Acceptance commands
- npm test -- tests/main/git
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
