# T06 - Session index (listing, live registry, auto-pick) and tokens-today counter

- Wave: 2
- Depends on: T01 (SessionSummary, TeamSelection, TokenTotals, UsageToday), T02 (parseLine, shouldSkipRaw), T03 (ByteReadFs, layout, tailer)
- Spec refs: R-08, R-09, R-14; spec Accounts "tokens used today"; plan Verified facts 1, 2, 8, 9, 11
- Tests: tests/main/transcripts/sessionIndex.test.ts, tests/main/transcripts/usageToday.test.ts (test-writer)

## Goal
Two main-side scanners that work across all config dirs. The session index lists recent sessions cheaply, reads the
live-session registry, and implements the auto-selection rules. The usage counter sums real token usage per account
for the local day, incrementally and deduped.

## Owned files
- create: src/main/transcripts/sessionIndex.ts
- create: src/main/transcripts/usageToday.ts
- create: tests/main/transcripts/sessionIndex.test.ts, usageToday.test.ts (test-writer first; the implementer may add `!` only)

## Read-only context
- src/main/transcripts/{transcriptFs,layout,tailer,parseLine,records}.ts, src/shared/types.ts, src/shared/teamDefaults.ts
- src/main/accounts/paths.ts (`samePath`, `normalizeForCompare`)
- .factory/20261119-phase3-transcripts/plan.md (Architecture: auto-selection)

## Notes
### sessionIndex.ts
```ts
export interface ConfigRoot { accountId: string; configDirAbs: string }
export interface PtyHint { pid: number; cwd: string; startedAtMs: number; accountId: string }
export interface LiveRegistry { entry: RegistryEntry; accountId: string; configDirAbs: string }
export interface SessionIndexDeps { fs: ByteReadFs; platform: NodeJS.Platform; home: string; isPidAlive(pid: number): boolean; nowMs(): number }
export interface SessionIndex {
  listSessions(roots: ConfigRoot[], limit?: number /*50*/): Promise<SessionSummary[]>   // newest mtime first
  readRegistry(roots: ConfigRoot[]): Promise<LiveRegistry[]>                            // alive pids only
  pickAuto(roots: ConfigRoot[], pty: PtyHint | null): Promise<{ pick: { accountId: string; sessionId: string; configDirAbs: string; projectDir: string } | null; waitingForSession: boolean }>
  resolve(roots: ConfigRoot[], accountId: string, sessionId: string): Promise<{ configDirAbs: string; projectDir: string } | null>
}
export function createSessionIndex(deps: SessionIndexDeps): SessionIndex
```
- Listing: `readdir(projects)` -> project dirs -> `*.jsonl` (main files only, never `subagents`). Stat each one. Sort by mtime and keep `limit`.
  For each kept file, read the head (the first 64 KiB, split lines, parse) for the first `cwd`, and the tail (the last 256 KiB, aligned to a newline) for
  the last title record (custom > ai > agent-name). Cache per path by `(mtimeMs, size)` so an unchanged file is never re-read.
  `live`/`registryStatus` come from readRegistry. A missing `projects` dir counts as an empty list (no error).
- Registry: `readdir(<configDir>/sessions)`, names matching `^\d+\.json$` only (never `.key`), `readText` + `parseRegistryEntry`, and keep `isPidAlive(entry.pid)`.
- pickAuto, in order (see plan Architecture): (1) pty hint -> the registry entry with `pid === pty.pid` (its sessionId, found under that account) -> else the
  newest main file under that account's projects whose dir name `sameProjectDir(encodeProjectDir(pty.cwd))` **or** whose head `cwd` matches
  `samePath(pty.cwd)`, with mtime >= `startedAtMs - 5000` -> else `{ pick: null, waitingForSession: true }`. (2) Live registry entries, newest
  `statusUpdatedAt ?? updatedAt ?? startedAt` first, whose session file exists. (3) The newest session with mtime >= now - 24 h. (4) null.
- `isPidAlive` is injected. The default lives in T08 (`process.kill(pid, 0)` in a try).
### usageToday.ts
```ts
export interface UsageCounterDeps { fs: ByteReadFs; nowMs(): number; localDay(ms: number): string /* YYYY-MM-DD local */ }
export interface UsageCounter {
  addFile(path: string, accountId: string): void   // queue for an initial or incremental read
  pump(): Promise<boolean>                          // processes at most one chunk of one queued file; true if work remains
  today(): UsageToday                               // totals for localDay(nowMs()) only
  forgetAccount(accountId: string): void
}
export function createUsageCounter(deps: UsageCounterDeps): UsageCounter
```
- Uses its own `createTailer(fs, { backfillBytes: Infinity })`. A raw prefilter keeps only lines containing `"type":"assistant"`, then `parseLine`.
  Keep assistant records with usage (synthetic/API errors have none).
- Bucket by `localDay(tsMs)`, per account. Dedupe key `${accountId}|${messageId}` **per day bucket**, across files (fork copies, fact 8).
  A replaced usage for the same id overwrites (it is identical in practice).
- Keep, for today only, `byId: Map<dedupeKey, { totals: TokenTotals; files: Set<path> }>`. Today's total = the sum over `byId`. On a tailer
  reset for a file, remove that path from every entry's `files`, delete the entries left with no file, then re-read the file. That way there is no
  double count and nothing is lost when another file still holds the id. On a local-day rollover (detected in `today()`/`pump()`), clear `byId`.
  Lines from earlier days are skipped, and no history is kept.
- The initial set comes from T08 (only files with mtime >= local midnight). The counter itself never lists dirs.
- Tests: two lines with the same message id (one per content block) -> counted once; the same id in two files (a fork) -> once; lines across local
  midnight -> only today counted; reset via truncate -> no double count; `<synthetic>` -> 0; the per-account split; pump processes chunk by chunk.

## Acceptance commands
- npm test -- tests/main/transcripts/sessionIndex.test.ts tests/main/transcripts/usageToday.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
