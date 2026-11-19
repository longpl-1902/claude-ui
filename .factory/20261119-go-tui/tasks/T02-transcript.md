# T02 — transcript parser, tailer, layout (wave 1)

## Goal
Port the transcript reading layer: one JSONL line → typed `Record`, an incremental tailer,
and the on-disk layout helpers. Standard library only.

## Owns
`internal/transcript/**` (including `testdata/`).

## Reference
`src/main/transcripts/parseLine.ts`, `records.ts`, `layout.ts`, `tailer.ts`,
`transcriptFs.ts` (allow-list idea only), `sessionIndex.ts` (head/tail metadata scan),
tests `tests/main/transcripts/{parseLine,parseLineTasks,tailer,layout}.test.ts`,
fixtures `tests/fixtures/transcripts/builders.ts`, `trees.ts`.

## Steps
1. `records.go`: Go equivalents of `TranscriptRecord` variants as one struct with
   `T RecType` (`Assistant, ToolResults, Prompt, Interrupted, System, Title`) and per-variant
   fields; `TokenUsage`, `ToolUse`, `ToolResult`, `FileChange`. Add `ToolResult.Text`
   (full result text, capped 8 KiB) — new vs the old parser, needed for the expandable tool
   view — and `ToolUse.InputPreview` (command / file_path / url / pattern first, else compact
   JSON, cap 2000).
2. `parse.go`: `ShouldSkipRaw(line []byte) bool` (same prefixes), `ParseLine(line []byte) (Record, bool)`.
   Same rules as `parseLine.ts`: envelope (uuid + RFC3339 timestamp required), assistant
   (message.id required; text joined; thinking never kept; usage omitted for API-error or
   `<synthetic>`; caps TEXT 12000 / PROMPT 8000 / AGENT_RESULT 4000 / summary 200 / target 160,
   Bash first line 120), tool targets (`targetFor`), edit counts, Task*/TodoWrite, Agent,
   SendMessage, tool results (is_error, string toolUseResult "Error…"/rejected, toolDenialKind,
   interrupted, structuredPatch counts, Write-create content lines, agentId results, success),
   user prompts (isMeta skip, system-reminder-only skip, command tags → `/name args`,
   task-notification, compact summary, sub-agent first-task), `[Request interrupted`,
   system subtypes (api_error with retry exhaustion fatal, compact_boundary, local_command,
   informational), titles (ai-title, custom-title, agent-name). Truncation cuts on a rune
   boundary and appends `…`. Never panics (recover + table test with garbage).
3. `layout.go`: `EncodeProjectDir(cwd)` (non `[A-Za-z0-9]` → `-`, > 200 chars → cut + `-`),
   `SameProjectDir(a,b)` (case-insensitive on Windows), `Classify(abs, projectsRoot) PathInfo`
   (main / subagent / meta, case-insensitive prefix match, `/` and `\`),
   `ParseRegistryEntry([]byte)` (also keeps `entrypoint`), `ParseSubagentMeta([]byte)`.
   Inline helper `normKey` (lowercase, `\`→`/`, collapse `//`, trim trailing `/`) — do not import
   other internal packages.
4. `tailer.go`: `Tailer` over an interface `ByteReader{Stat(path) (size int64, created time.Time, ok bool, err error); ReadRange(path, start, end) ([]byte, error)}`
   (T07 supplies the safefs-backed implementation). Port all `tailer.ts` behaviour: backfill
   window 16 MiB (start one byte early, discard to first newline), chunk 4 MiB, max line 8 MiB
   (dropped + counted), partial line held, CRLF, reset on truncate or new creation time,
   `Forget`, per-path state. Return `TailRead{Lines [][]byte; Reset bool; Skipped int64; Dropped int; EOF bool}`.
5. `meta.go`: `ScanMeta(head, tail []byte) Meta{Cwd, Entrypoint, Title, TitleKind, FirstPrompt, LastTs}`
   (title priority custom › ai › agent-name; first prompt from the first `Prompt` record of
   kind user).
6. `testdata/`: hand-write synthetic `.jsonl` equivalents of the builders (same ids, cwd
   `d:\work\demo`, model `claude-test-opus`, T0 `2026-11-18T10:00:00Z`): `lead_basic.jsonl`
   (prompt, split assistant lines of one message id with usage, tool_use/tool_result Edit with
   structuredPatch, Bash failing, AskUserQuestion open), `subagents/agent-a1.jsonl` +
   `agent-a1.meta.json`, `fork_copy.jsonl` (same uuids/message ids), `garbage.jsonl`,
   `registry/12345.json`. Add `testdata/.gitattributes` (`* -text`). T06/T07 reuse these.

## Tests to port (keep R-tags in names)
All cases of `parseLine.test.ts` and `parseLineTasks.test.ts` (R-04), `tailer.test.ts` (R-03,
in-memory `ByteReader`; include multibyte split across reads, invalid UTF-8, over-long line,
replaced file), layout encode/classify/registry tests. Add: `ToolResult.Text` cap, `InputPreview`.
Benchmark `BenchmarkParseLine` on `lead_basic.jsonl` (report ns/line).

## Acceptance
`go vet ./...` · `go test ./internal/transcript/...` · `go build ./...` · `gofmt -l .` empty.
