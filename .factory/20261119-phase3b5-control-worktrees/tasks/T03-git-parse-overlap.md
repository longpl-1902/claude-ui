# T03 - Git porcelain parsers, base detection, overlap detection, agent mapping

- Wave: 1
- Depends on: none
- Spec refs: R-08, R-10, spec "3. Git worktrees", hard rule 5
- Tests: tests/main/git/gitParse.test.ts, tests/shared/overlap.test.ts

## Goal
Pure functions for every git output we read and for overlap detection / agent-to-worktree mapping, fully tested.

## Owned files
- create: src/main/git/gitParse.ts
- create: src/shared/overlap.ts
- create: tests/main/git/gitParse.test.ts
- create: tests/shared/overlap.test.ts

## Read-only context
- plan.md Verified fact 12, Decision D10
- src/main/accounts/paths.ts (`normalizeForCompare`) - gitParse may import it; overlap.ts (shared) must NOT import main code: implement its own `normKey(p, platform)` (backslash -> slash, trim trailing slash, lower-case on win32).
- src/shared/types.ts (`Worktree`, `FileOverlap`, `Agent` as they exist today)

## Notes
gitParse.ts:
```ts
export interface RawWorktree { path: string; head: string; branch?: string /* short, refs/heads/ stripped */; detached: boolean; bare: boolean; locked: boolean; prunable: boolean }
export function parseWorktreeList(out: string): RawWorktree[]          // --porcelain (blank-line blocks; CRLF tolerant); first block = main worktree
export interface StatusEntry { path: string; origPath?: string; x: string; y: string; status: 'M' | 'A' | 'D' | 'R' | '?' | 'U' }
export function parseStatusZ(out: string): StatusEntry[]               // status --porcelain=v1 -z; R/C consume the extra NUL field; '!!' ignored
export function parseLeftRight(out: string): { behind: number; ahead: number } | null // "behind\tahead"
export interface NumstatEntry { path: string; added: number | null; removed: number | null } // null for binary '-'
export function parseNumstatZ(out: string): NumstatEntry[]              // handles rename form a\td\t\0old\0new\0 (path = new)
export function pickBase(c: { originHead: string | null; existing: (ref: string) => boolean }): string | null // originHead e.g. 'origin/main'; else main, master, origin/main, origin/master
export function parseSymbolicRef(out: string): string | null            // 'refs/remotes/origin/main' or 'origin/main' -> 'origin/main'
export function mergeChanged(committed: NumstatEntry[], status: StatusEntry[], cap = 500): { files: { path: string; status: StatusEntry['status']; added?: number; removed?: number; committed: boolean; uncommitted: boolean }[]; total: number }
```
Paths stay repo-relative with forward slashes. Status letter: from y if not ' ' else x; '?' untracked; 'U' if either is U.

overlap.ts (structural input types, compatible with T01's WorktreeInfo):
```ts
export interface WtFiles { path: string; branch?: string; files: { path: string }[] }
export function detectOverlaps(wts: WtFiles[]): { path: string; worktrees: string[] }[]   // file in >= 2 worktrees; sorted by path; worktrees in input order
export function worktreeForCwd(cwd: string | undefined, wtPaths: string[], platform: string): string | null // longest wt path that equals or is a segment-prefix of cwd (case-insensitive on win32, slash-agnostic)
export function mapAgentsToWorktrees(agents: { id: string; cwd?: string }[], wtPaths: string[], platform: string): Map<string, string[]> // wt path -> agentIds
export function toWorktreeViews(s: { worktrees: (WtFiles & { changedFiles: number; ahead: number | null; behind: number | null; isMain: boolean; error?: string })[]; overlaps: { path: string; worktrees: string[] }[] }, agents: { id: string; cwd?: string }[], platform: string): { worktrees: Worktree[]; overlaps: FileOverlap[] }
```
`toWorktreeViews`: Worktree{branch: branch ?? '(detached)', path, agentIds, changedFiles, ahead: ahead ?? 0, behind, files (paths), isMain, error, overlapsWith: branches of other worktrees sharing a file}; FileOverlap{path, agentIds (agents on involved worktrees), worktrees (branches)}.
Tests: Windows (`D:/x` vs `d:\x\sub`), posix, prefix trap (`/repo-a` vs `/repo`), main + 2 linked worktrees, detached,
prunable, rename in status and numstat, binary numstat, empty outputs, 3-way overlap, no overlap, agent without cwd.
Fixture paths: `C:/Users/u/acme`, `/home/u/acme`.

## Acceptance commands
- npm test -- tests/main/git/gitParse.test.ts tests/shared/overlap.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
