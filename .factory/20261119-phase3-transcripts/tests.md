# Tests (written first, all failing until the modules exist)

Run: `npm test -- <file>` (never raw npx vitest). Full suite: `npm test`. Typecheck of tests: `npm run typecheck` (tsconfig.tests.json).

## Fixtures (synthetic only, read-only for implementers)
- `tests/fixtures/transcripts/builders.ts` - line builders per plan facts 6-11 (userPrompt, assistantBlocks one line per block with repeated message.id+usage, toolResult, bashResult, errorResult, rejectedResult, interruptedToolResult, editResult, writeCreateResult, agentToolUse, agentResult, subMeta, apiErrorLine, systemApiError, systemLine, interruptedLine, sendMessageUse, askUserQuestionUse, exitPlanModeUse, titles, bookkeepingLine/IGNORABLE_TYPES, registryEntry, fakeKeyFile, `toLine`/`jsonl`).
- `tests/fixtures/transcripts/trees.ts` - `buildTranscriptTree()` -> `{files, mtimes, paths, lines, expect}`. Two roots (`acme` = C:/Users/u/.claude-acme, `''` = C:/Users/u/.claude). Session S1 (lead + SUB1 + NESTED (parent in a sibling file) + TEAM (meta.name, async) + NOMETA (no meta file) + ORPHAN (toolUseId nowhere)); S2 fork copy (same uuids / message ids); S3 (two UTC days, malformed + multibyte lines, API error); S4 (CRLF); registry live (pid 4242, waiting "dialog open") + dead (9999) + `.key` + fake credentials files; tool-results, prefix.json, memory dir. Expected totals/parents/order in `expect`. Tests use `utcDay` as the injected `localDay`, so they are timezone independent (except the service "mtime >= local midnight" assertion, which computes local midnight itself).
- `tests/main/transcripts/memoryByteFs.ts` - in-memory `ByteReadFs` with `set/append/truncate/replace/remove/setMtime`, logs `reads` (stat/readRange/readText paths), `readdirs`, `rangeCalls`, empty `writes`. Pass it RAW (not wrapped) to see forbidden-path attempts.

## Test files and R-ids
| File | Tests (approx) | IDs |
|---|---|---|
| tests/main/transcripts/parseLine.test.ts | ~60 | R-04 |
| tests/main/transcripts/transcriptFs.test.ts | ~11 | R-02, R-14 |
| tests/main/transcripts/layout.test.ts | ~16 | R-02 |
| tests/main/transcripts/tailer.test.ts | ~23 (1 soft perf, skipped when CI is set) | R-03 |
| tests/shared/liveStatus.test.ts | ~9 blocks, ~55 table rows | R-07 (incl. needs-you heuristic OFF) |
| tests/main/transcripts/sessionModel.test.ts | ~84 | R-05, R-06 (tokens headline decision, dedupe by uuid / message.id) |
| tests/main/transcripts/sessionIndex.test.ts | ~30 | R-08, R-14 (`.key` never opened) |
| tests/main/transcripts/usageToday.test.ts | ~20 | R-09 |
| tests/main/transcripts/transcriptService.test.ts | ~26 | R-08, R-09, R-10, R-14 |
| tests/shared/ipcContract.test.ts (appended) | 12 | R-01 |

Manual (not automatable): plan "Manual" steps 1-6 (R-10 latency on real fs.watch, real session switch, nothing changed under ~/.claude).
Not written (other tasks own them): renderer tests (T07/T09/T10), tests/main/ipcHandlers.test.ts (T08).

## Signature assumptions (from task Notes; implementers must match)
- parseLine.ts: `parseLine(line: string)`, `parseRecord(obj: unknown)`, `shouldSkipRaw(line)`, `targetFor(name, input)`. Truncation = limit chars + `…` (tests allow limit+1). Record fields exactly as T02 records.ts (e.g. `ToolResultRec.fileChange/agentResult/sendOk`, prompt kinds).
- transcriptFs.ts: `ByteReadFs {stat, readRange, readdir, readText}`, `FileStat {size, mtimeMs, birthtimeMs, isFile}`, `TranscriptAccessError`, `isTranscriptReadable`, `createTranscriptFs`, `nodeByteFs`, `transcriptNodeFs`. The wrapper object has exactly the 4 methods.
- layout.ts: `encodeProjectDir`, `isEncodedTruncated`, `sameProjectDir(a,b,platform)`, `projectsRoot`, `sessionsRegistryDir`, `classifyTranscriptPath(abs, root)` (returns `{kind:'main'|'subagent'|'meta',...}` or null; sub-agent includes `metaPath`), `parseRegistryEntry(text)`.
- tailer.ts: `createTailer(fs, {backfillBytes, chunkBytes, maxLineBytes})` -> `read/offsetOf/forget`; `TailRead {lines, reset, skippedBytes, droppedLines, eof}`. Tests only assert `skippedBytes > 0` (not the exact value) for a windowed first read.
- liveStatus.ts (`@shared/liveStatus`): `LIVE_THRESHOLDS`, `NEEDS_YOU_TOOLS`, `deriveLiveStatus(rt, nowMs, th?)`, `reasonLabel`; `reasonLabel('waiting-for-you','dialog open') === 'waiting for you: dialog open'`.
- sessionModel.ts: `createSessionModel({sessionId, accountId, projectCwd?, caps?})` with `ingest/setMeta/setRegistry/reset/markHistoryTruncated/isDirty/snapshot`, `parseSubagentMeta`. The tests build records with the real `parseLine`. Assumptions beyond the Notes: events are returned chronologically (sorted by ts across sources); a sub-agent whose `meta.finished` is true emits exactly one `stop` event + `done` console line; event `tokens` appear on exactly one event per message id; activity result for an Agent call is the first line of the tool_result text; repo = basename of projectCwd (Windows-style path).
- sessionIndex.ts: `createSessionIndex({fs, platform, home, isPidAlive, nowMs})`; `ConfigRoot`, `PtyHint` exports; `pickAuto` returns `{pick:{accountId, sessionId, configDirAbs, projectDir}|null, waitingForSession}`; a pty with no matching file returns `waitingForSession:true` and does NOT fall back to the registry/24 h rules; `startedAtMs - 5000` boundary is inclusive.
- usageToday.ts: `createUsageCounter({fs, nowMs, localDay})`: `addFile/pump/today/forgetAccount`; `today()` returns `{day, byAccount}`; accounts with no usage may be absent.
- transcriptService.ts: deps as T08; the service takes `nowMs: () => Date.now()` in tests (fake timers + `vi.setSystemTime`), `setTimer/clearTimer` wrap setTimeout. Tests assume: start() awaits the initial pick/backfill; snapshot() returns the last live snapshot; watch depths 4 (projects) and 0 (sessions); 1 s stat poll, 2 s subagents readdir, 250 ms push throttle, 1 s sessions debounce, 2 s usage debounce; `refreshRoots()` closes watchers of removed roots; dispose leaves zero timers.
- ipcContract: new invoke/push constant names exactly as T01.

## Note for T01 (existing test that must be updated)
`tests/shared/ipcContract.test.ts` still has the old case "R-01 PUSH_CHANNELS is exactly teamEvent plus the four new pushes". It passes today but will fail once T01 adds the 3 new pushes. T01 must update that expectation (the appended v3 block already asserts the new set).

## Status when written
`npm test`: 601 pre-existing tests pass; all new files fail (missing modules `src/main/transcripts/*`, `@shared/liveStatus`, and the new IPC constants). Only 3 appended ipcContract cases pass today (generic uniqueness checks).
