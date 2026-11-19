# T08 - Transcript service: watch, select, tail, push; IPC and main wiring

- Wave: 3
- Depends on: T01, T03, T05, T06 (and transitively T02)
- Spec refs: R-01, R-08, R-09, R-10, R-14; plan Architecture (data flow, auto-selection, backfill, push)
- Tests: tests/main/transcripts/transcriptService.test.ts (test-writer), tests/main/ipcHandlers.test.ts (this task appends cases)

## Goal
Compose the Phase 3 modules into one main-process service. It watches every account's config dir, keeps the selected
session's model fed from incremental tails, pushes throttled snapshots, session-list changes and tokens-today, and wires it
all into the IPC handlers and `index.ts`.

## Owned files
- create: src/main/transcripts/transcriptService.ts
- modify: src/main/ipc/handlers.ts (real handlers for `team:get-snapshot`, `transcripts:*` and `usage:get-today` when `deps.transcripts` is given)
- modify: src/main/index.ts
- create: tests/main/transcripts/transcriptService.test.ts (test-writer first; the implementer may add `!` only)
- modify: tests/main/ipcHandlers.test.ts (append cases for the new real handlers)

## Read-only context
- src/main/transcripts/*.ts (T02, T03, T05, T06), src/main/accounts/accountsService.ts, src/main/accounts/paths.ts, src/main/pty/types.ts
- src/main/accounts/signIn.ts (`createChokidarWatchFile`, the chokidar usage pattern)

## Notes
### API (exact)
```ts
export interface DirWatcher { close(): void }
export type WatchDir = (absDir: string, opts: { depth: number }, onEvent: (kind: 'add' | 'change' | 'unlink', absPath: string) => void) => DirWatcher
export interface TranscriptServiceDeps {
  fs: ByteReadFs                          // transcriptNodeFs in prod
  host: HostEnv
  roots(): Promise<ConfigRoot[]>          // from accounts (see below)
  ptyHint(): PtyHint | null               // newest running 'claude' pty
  watchDir: WatchDir
  isPidAlive(pid: number): boolean
  nowMs(): number
  localDay(ms: number): string
  setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (t: unknown) => void   // injectable for fake timers
}
export interface TranscriptService {
  start(): Promise<void>
  snapshot(): TeamSnapshot                     // the current live snapshot, or EMPTY_TEAM_SNAPSHOT (+ waitingForSession)
  listSessions(): Promise<SessionSummary[]>
  select(sel: TeamSelection): Promise<TeamSnapshot>
  getSelection(): TeamSelection
  usageToday(): UsageToday
  refreshRoots(): Promise<void>                // call on accounts change
  onPtyChanged(): void                         // call on pty spawn/exit
  onTeam(cb: (s: TeamSnapshot) => void): () => void
  onSessions(cb: (s: SessionSummary[]) => void): () => void
  onUsage(cb: (u: UsageToday) => void): () => void
  dispose(): void
}
export function createTranscriptService(deps: TranscriptServiceDeps): TranscriptService
export function createChokidarWatchDir(): WatchDir   // chokidar 4: watch(dir, { depth, ignoreInitial: true, ignored: fn }) — files allowed only if
                                                     // isTranscriptReadable; never follow symlinks; errors swallowed
```
### Behaviour
- **Roots:** for each account, `{accountId, configDirAbs: expandHome(configDir)}`. Always add the default `~/.claude` with accountId `''` when no account uses
  it (isDefaultDir). Dedupe by `samePath`.
- **Watch:** per root, `watchDir(projects, {depth: 4})` and `watchDir(sessions, {depth: 0})`. Missing dirs are fine (retry on refreshRoots).
- **Selection:** in mode auto, `pickAuto` runs on start, on onPtyChanged, on a registry change, and on the `add` of a main jsonl. Switch only when the pick differs.
  An explicit select pins it. On switch: dispose the old model and tails, create a new model, read the metas, and backfill the main + every
  `subagents/**/agent-*.jsonl` file (T03 tailer, default 16 MiB), calling `tailer.read` until `eof` and yielding (`await` the timer of 0 ms) between chunks.
- **Tail loop:** `change`/`add` events for files of the selected session -> enqueue that path. Also a 1 s poll stats the known files (enqueue on a size/mtime change)
  and a 2 s readdir of `<sessionId>/subagents` (new agents). The meta.json add/change -> `parseSubagentMeta` -> `model.setMeta`. The registry entry for the
  selected session -> `model.setRegistry`. A tailer reset -> `model.reset(source)` and re-ingest. skippedBytes > 0 -> `model.markHistoryTruncated()`.
- **Push:** after ingest, if `model.isDirty()`, schedule a trailing 250 ms timer -> `onTeam(model.snapshot(nowMs))`, at most one push per 250 ms.
  Also push when the selection changes (immediately).
- **Sessions:** debounce 1 s after any main-file add/unlink or registry change -> `listSessions` -> onSessions.
- **Usage:** on start, for each root, enqueue every jsonl (main and subagents) with mtime >= local midnight into the usage counter. Then any changed jsonl
  -> addFile. A background pump loop runs `counter.pump()` until it returns false, yielding between calls. Debounce 2 s -> onUsage. At midnight the counter handles rollover.
- **Privacy:** the service only uses `deps.fs` (the allowlisted reader). The test uses a recording fs and asserts zero write attempts (there is no write API) and that no
  `.key`/credentials path was ever passed to stat/readRange/readText.
- **dispose:** close all watchers, clear all timers, drop the models.
### handlers.ts
- `HandlerDeps.transcripts?: TranscriptService`. When given: `'team:get-snapshot': () => transcripts.snapshot()`, `'transcripts:list-sessions'`,
  `'transcripts:select': (sel) => isTeamSelection(sel) ? transcripts.select(sel) : structuredClone(EMPTY_TEAM_SNAPSHOT)`, `'transcripts:get-selection'`,
  `'usage:get-today'`. Without the dep, the existing mock behaviour is unchanged (existing tests keep passing).
### index.ts
- Build with `transcriptNodeFs`, `createChokidarWatchDir()`, roots from `accounts.snapshot()`, and ptyHint from `pty.list()` (purpose 'claude', no exitCode, newest
  startedAt; `startedAtMs = Date.parse(startedAt)`). `isPidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }`.
  localDay uses local date getters.
- Forward pushes: `broadcast(IPC.teamChanged, s)`, `broadcast(IPC.transcriptsSessionsChanged, list)`, `broadcast(IPC.usageChanged, u)`. Call `accounts.onChanged(() => void transcripts.refreshRoots())`,
  and on pty spawn/exit call `transcripts.onPtyChanged()`. Exit: call it in the existing `pty.onExit` callback. Spawn: add
  `HandlerDeps.onPtySpawned?: (ptyId: string) => void`. The real `'pty:spawn'` handler calls it when the result is `ok`, and index.ts passes
  `() => transcripts.onPtyChanged()`. Add one ipcHandlers test for it.
- `void transcripts.start()` after the handlers are registered. `transcripts.dispose()` on before-quit.

## Acceptance commands
- npm test -- tests/main/transcripts/transcriptService.test.ts tests/main/ipcHandlers.test.ts
- npm run typecheck
- npm run build
- npm test

## Done when
- All acceptance commands pass; `npm run build` bundle check passes (chokidar stays external)
- Only owned files changed
