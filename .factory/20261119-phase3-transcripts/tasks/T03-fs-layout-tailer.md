# T03 - Transcript fs allowlist, path layout and incremental tailer

- Wave: 1
- Depends on: none (it uses only the existing `src/main/contracts.ts` `DirEntry` and `src/main/accounts/safeFs.ts` `isDeniedPath`)
- Spec refs: R-02, R-03, R-14; plan Verified facts 1-3, 11, 14
- Tests: tests/main/transcripts/{transcriptFs,layout,tailer}.test.ts (test-writer), helper tests/main/transcripts/memoryByteFs.ts (test-writer)

## Goal
The low-level read path for transcripts: a byte-range reader that can only open allowlisted files, the knowledge of
where the CLI puts files and how it names project folders, and a tailer that turns appended bytes into complete lines.
It stays correct across partial writes, truncation and file replacement.

## Owned files
- create: src/main/transcripts/transcriptFs.ts
- create: src/main/transcripts/layout.ts
- create: src/main/transcripts/tailer.ts
- create: tests/main/transcripts/transcriptFs.test.ts, layout.test.ts, tailer.test.ts (test-writer first; the implementer may add `!` only)

## Read-only context
- .factory/20261119-phase3-transcripts/plan.md
- src/main/accounts/safeFs.ts, src/main/accounts/paths.ts (reuse `normalizeForCompare`, `expandHome`)
- tests/main/transcripts/memoryByteFs.ts

## Notes
### transcriptFs.ts (exact interface)
```ts
import type { DirEntry } from '../contracts'
export interface FileStat { size: number; mtimeMs: number; birthtimeMs: number; isFile: boolean }
export interface ByteReadFs {
  stat(path: string): Promise<FileStat | null>                 // null on ENOENT
  readRange(path: string, start: number, end: number): Promise<Uint8Array>  // [start, end)
  readdir(path: string): Promise<DirEntry[]>
  readText(path: string): Promise<string>                      // utf8, small files (meta/registry)
}
export class TranscriptAccessError extends Error {}
export function isTranscriptReadable(path: string): boolean
export function createTranscriptFs(inner: ByteReadFs): ByteReadFs
export const nodeByteFs: ByteReadFs      // node:fs/promises open/read/close, stat, readdir withFileTypes, readFile utf8
export const transcriptNodeFs: ByteReadFs // createTranscriptFs(nodeByteFs)
```
- Allowlist (basename, case-insensitive): `*.jsonl`, `*.meta.json`, or `^\d+\.json$` **and** the parent dir is named `sessions`.
  Denied always: `isDeniedPath(p)` (credentials) and any `*.key`. `stat`/`readRange`/`readText` on a non-allowlisted path reject with
  `TranscriptAccessError`. `readdir` is allowed (names only). There are no write methods at all.
- `readRange` clamps `end` to the file size and returns an empty array when start >= size.
### layout.ts (pure)
- `encodeProjectDir(cwd: string): string`: `cwd.replace(/[^a-zA-Z0-9]/g, '-')`. When the result is longer than 200 chars, return the first 200 chars
  plus `'-'` and mark it unreliable (`isEncodedTruncated(name): boolean` = length > 200). The CLI's hash cannot be reproduced, so callers fall back to the `cwd` field.
- `sameProjectDir(a: string, b: string, platform): boolean`: case-insensitive on win32/darwin.
- `projectsRoot(configDirAbs) = join(configDirAbs, 'projects')`; `sessionsRegistryDir(configDirAbs) = join(configDirAbs, 'sessions')`.
- `classifyTranscriptPath(abs: string, projectsRootAbs: string)` returns one of:
  `{ kind: 'main', projectDir, sessionId }` for `<root>/<projectDir>/<sessionId>.jsonl`;
  `{ kind: 'subagent', projectDir, sessionId, agentId, metaPath }` for `<root>/<projectDir>/<sessionId>/subagents/**/agent-<id>.jsonl`;
  `{ kind: 'meta', projectDir, sessionId, agentId }` for the matching `.meta.json`; or `null` (tool-results, memory, prefix.json, anything else).
  Separator-agnostic. The root is compared with `normalizeForCompare`.
- `parseRegistryEntry(text: string): RegistryEntry | null`, where
  `RegistryEntry = { pid: number; sessionId: string; cwd: string; status?: 'busy'|'idle'|'waiting'; waitingFor?: string; startedAt?: number; updatedAt?: number; statusUpdatedAt?: number; name?: string }`.
  It copies **only** these fields (never messagingSocketPath or others). An unknown status -> undefined. Bad JSON or missing pid/sessionId -> null.
  Export the `RegistryEntry` type.
### tailer.ts
```ts
export interface TailOptions { backfillBytes?: number /*16 MiB*/; chunkBytes?: number /*4 MiB*/; maxLineBytes?: number /*8 MiB*/ }
export interface TailRead { lines: string[]; reset: boolean; skippedBytes: number; droppedLines: number; eof: boolean }
export interface Tailer {
  read(path: string): Promise<TailRead>      // reads [offset, size) in chunks; eof=false if more than one chunk remains (call again)
  offsetOf(path: string): number | undefined
  forget(path: string): void
}
export function createTailer(fs: ByteReadFs, opts?: TailOptions): Tailer
```
- First read: when size > backfillBytes, start at `size - backfillBytes` and discard bytes up to and including the first `\n`
  (`skippedBytes` = the new start offset). Otherwise start at 0. `backfillBytes: Infinity` reads everything (usageToday uses this).
- Split on byte 0x0A **before** UTF-8 decoding (`TextDecoder('utf-8', { fatal: false })`), strip a trailing `\r`, skip empty lines.
  The trailing incomplete line is kept as bytes (`partial`) and completed on the next read. A partial longer than maxLineBytes is
  dropped up to its end-of-line (`droppedLines++`).
- Reset: when `size < offset`, or birthtimeMs changed (the file was replaced), drop the state and re-read like a first open, with `reset: true`.
  A missing file -> `{ lines: [], reset: false, eof: true, ... }`, and the state is forgotten.
- One `read` call reads at most `chunkBytes` (so callers can yield between chunks). `eof` tells whether the offset reached the size.
- Perf test (test-writer): a 20 MB synthetic file with backfill 16 MiB reads in under 1500 ms (log the duration; mark the test `it.skipIf(process.env.CI)` soft).

## Acceptance commands
- npm test -- tests/main/transcripts/transcriptFs.test.ts tests/main/transcripts/layout.test.ts tests/main/transcripts/tailer.test.ts
- npm run typecheck
- npm test -- tests/main/noCredentials.test.ts

## Done when
- All acceptance commands pass (noCredentials keeps passing: do not spell the credentials file name; use `isDeniedPath`)
- Only owned files changed
