# T02 - Transcript line parser (pure): raw JSON line -> TranscriptRecord

- Wave: 1
- Depends on: none (it defines its own types in `records.ts`; it must not import anything T01 adds)
- Spec refs: R-04; plan Verified facts 3, 5-10, 13, 15
- Tests: tests/main/transcripts/parseLine.test.ts (written by test-writer from tests/fixtures/transcripts/builders.ts)

## Goal
A pure, total parser. It takes one transcript line (a string) and returns a typed record, or `null` for lines we do
not use. It is the only code that knows the raw Claude Code line schema. Everything downstream works on records.

## Owned files
- create: src/main/transcripts/records.ts
- create: src/main/transcripts/parseLine.ts
- create: tests/main/transcripts/parseLine.test.ts (test-writer writes it first; the implementer may fix it only for `!`)

## Read-only context
- .factory/20261119-phase3-transcripts/plan.md (Verified facts: the schema source of truth)
- tests/fixtures/transcripts/builders.ts (synthetic line builders)

## Notes
### records.ts (exact)
```ts
export interface TokenUsage { input: number; output: number; cacheCreation: number; cacheRead: number }
export interface ToolUseRec {
  id: string; name: string
  target: string                 // see targetFor below, max 160 chars
  filePath?: string; command?: string
  agent?: { description?: string; subagentType?: string; name?: string; background?: boolean }
  send?: { to: string; text: string; summary?: string }   // SendMessage: to = input.to ?? input.recipient
}
export interface FileChange { path: string; kind: 'create' | 'update'; added: number; removed: number }
export interface ToolResultRec {
  toolUseId: string
  isError: boolean               // tool_result.is_error === true, or string toolUseResult starting 'Error', or denial
  interrupted: boolean           // toolUseResult.interrupted === true or denial in {interrupted, cancelled}
  denial?: string                // line.toolDenialKind
  summary: string                // first non-empty line of the result text, max 200 chars ('' if none)
  fileChange?: FileChange
  agentResult?: { agentId: string; status: string; totalTokens?: number; text?: string }  // text max 500
  sendOk?: boolean               // SendMessage toolUseResult.success
}
interface Base { uuid: string; ts: string; tsMs: number; sessionId: string; agentId?: string; cwd?: string; gitBranch?: string }
export type TranscriptRecord =
  | (Base & { t: 'assistant'; messageId: string; model: string; stopReason: string | null; usage?: TokenUsage
      toolUses: ToolUseRec[]; text?: string; isApiError: boolean; errorKind?: string })
  | (Base & { t: 'tool_results'; results: ToolResultRec[] })
  | (Base & { t: 'prompt'; text: string; kind: 'user' | 'command' | 'task-notification' | 'compact-summary' | 'first-task' })
  | (Base & { t: 'interrupted' })
  | (Base & { t: 'system'; subtype: string; level?: string; fatal: boolean })
  | { t: 'title'; sessionId: string; kind: 'ai' | 'custom' | 'agent-name'; value: string }
```
### parseLine.ts
- `export function shouldSkipRaw(line: string): boolean`: true for lines starting with `{"type":"api-request`, `{"type":"file-history`,
  `{"type":"queue-operation"`, `{"type":"atis-latch"`, `{"type":"session-owner"` or `{"type":"tools-used"`. It is a cheap prefilter only; the
  parser must still return null for those types when the prefilter misses them.
- `export function parseLine(line: string): TranscriptRecord | null`. It catches JSON errors and returns null, and never throws for
  any input (non-object, array, wrong field types). Every field is read defensively (`typeof` checks).
- `export function parseRecord(obj: unknown): TranscriptRecord | null`: the same, for a parsed object.
- `assistant`: requires a string `uuid`, `timestamp` and `message.id`. `usage` comes from message.usage numbers (missing -> 0) and
  is **omitted when `isApiErrorMessage` or model === '<synthetic>'**. `text` = the joined `text` blocks, max 300 chars (thinking is never
  included). `errorKind` = the string `error` field.
- `user` with an array content holding `tool_result` blocks -> a `tool_results` record (one ToolResultRec per block). The top-level
  `toolUseResult` applies to the **first** tool_result (that is how the CLI writes it: one result per line). Text extraction: a string content,
  or the `text` items of the array content.
- `fileChange`: `toolUseResult.filePath` (string) plus `structuredPatch` (array). added/removed = the count of hunk lines whose first char is `+`/`-`.
  For `type === 'create'` with an empty patch, added = the number of lines in `toolUseResult.content`. kind comes from `type` ('update' when absent).
- `agentResult`: when `toolUseResult.agentId` is a string. status = `toolUseResult.status`, totalTokens, and text = the first text item of `content`.
- `user` without tool_result: if the text starts with `[Request interrupted` -> `interrupted`. Lines with `isMeta === true` -> null.
  `isCompactSummary` -> prompt kind 'compact-summary'. A text starting with `<command-name>` or `<command-message>` -> 'command'. `<task-notification>`
  -> 'task-notification'. Other `<...>` system-reminder-only texts -> null. Else 'user'. For a sub-agent line (`agentId` set) with
  `parentUuid === null` -> kind 'first-task'. prompt text max 300 chars, with XML-ish tags stripped from command prompts (`/name args`).
- `system`: `fatal = subtype === 'api_error' && retryAttempt >= maxRetries` (both numbers) or `level === 'error' && subtype !== 'api_error'`.
  Only `api_error`, `compact_boundary`, `local_command` and `informational` produce records. Others -> null.
- `ai-title`/`custom-title`/`agent-name` -> `title`. Every other `type` -> null (attachment, cost-state, mode, relocated, pr-link, …).
- `targetFor(name, input)` (exported): `file_path`/`notebook_path` -> the path. Bash/PowerShell `command` -> the first line, max 120 chars.
  Grep/Glob -> `pattern` (+ ` in ${path}` when present). WebFetch -> `url`. WebSearch -> `query`. Agent -> `name ?? subagent_type ?? description`.
  SendMessage -> `→ ${to}`. Skill -> `skill`. mcp__x__y -> `y`. Else ''. Max 160 chars overall.
- Truncation helper: cut at the limit and append `…`. Never split a surrogate pair.
- tsMs = `Date.parse(ts)`, or NaN -> the line is rejected (null) for timestamped types.

## Acceptance commands
- npm test -- tests/main/transcripts/parseLine.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
