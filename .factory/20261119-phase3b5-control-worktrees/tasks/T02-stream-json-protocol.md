# T02 - Stream-json protocol: parser, encoder, CLI args, agent message routing

- Wave: 1
- Depends on: none
- Spec refs: R-02, R-06, R-19
- Tests: tests/main/control/protocol.test.ts, tests/main/control/args.test.ts, tests/shared/agentMessage.test.ts

## Goal
Pure, dependency-free modules that turn CLI stdout lines into typed messages, build every stdin frame we send, build
the CLI argument list for a controlled session, and route console input (plain / `@agent` / `/command`).

## Owned files
- create: src/main/control/protocol.ts
- create: src/main/control/args.ts
- create: src/shared/agentMessage.ts
- create: tests/main/control/protocol.test.ts
- create: tests/main/control/args.test.ts
- create: tests/shared/agentMessage.test.ts
- create: src/shared/displayPath.ts
- create: tests/shared/displayPath.test.ts

## Read-only context
- plan.md "Verified facts" 2-8 (the only source of shapes), Decisions D2, D8
- src/main/transcripts/parseLine.ts (style: never throw, truncate)

## Notes
Define local types in protocol.ts (do NOT import from src/shared/types.ts; T01 runs in parallel):
```ts
export type OutMsg =
  | { t: 'init'; sessionId: string; model?: string; permissionMode?: string; cwd?: string; slashCommands: string[]; version?: string }
  | { t: 'status'; status: string }
  | { t: 'delta'; messageId?: string; index: number; kind: 'text' | 'thinking' | 'input_json'; text: string; parentToolUseId: string | null }
  | { t: 'block-start'; messageId?: string; index: number; blockType: string; toolName?: string; toolUseId?: string; parentToolUseId: string | null }
  | { t: 'message-start'; messageId: string; parentToolUseId: string | null }
  | { t: 'message-stop'; parentToolUseId: string | null; stopReason?: string | null }
  | { t: 'assistant'; messageId: string; aborted: boolean; parentToolUseId: string | null; text?: string }
  | { t: 'user'; parentToolUseId: string | null }
  | { t: 'result'; subtype: string; isError: boolean; sessionId?: string; text?: string; costUsd?: number; denials: number; stopReason?: string | null }
  | { t: 'can-use-tool'; requestId: string; toolName: string; displayName: string; input: Record<string, unknown>; toolUseId?: string; description?: string; decisionReason?: string; blockedPath?: string; suggestions: unknown[] }
  | { t: 'control-request'; requestId: string; subtype: string }        // any other request from the CLI (answer with error 'unsupported')
  | { t: 'control-response'; requestId: string; ok: boolean; error?: string }
  | { t: 'other'; type: string; subtype?: string }
export function parseOutputLine(line: string): OutMsg | null   // null for blank/invalid JSON; never throws
export function inputPreview(toolName: string, input: Record<string, unknown>): string // command / file_path / url / pattern first, else compact JSON; max 2000 chars
export function encodeUserTurn(text: string): string             // {type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:''} + '\n'
export function encodeAllow(requestId: string, input: Record<string, unknown>, sessionRules?: unknown[]): string // control_response success, response {behavior:'allow', updatedInput: input, updatedPermissions?: sessionRules}
export function sessionScopedSuggestions(suggestions: unknown): unknown[] // keep only objects with type 'addRules'|'replaceRules'|'addDirectories'|'setMode', clone each with destination forced to 'session' (never userSettings/projectSettings/localSettings -> hard rule 3); [] when none
export function encodeDeny(requestId: string, message: string): string                  // response {behavior:'deny', message}
export function encodeUnsupported(requestId: string, subtype: string): string           // control_response {subtype:'error', request_id, error:'unsupported: <subtype>'}
export function encodeControlRequest(requestId: string, req: { subtype: 'interrupt' } | { subtype: 'set_model'; model: string | null } | { subtype: 'set_permission_mode'; mode: string }): string
export function createLineSplitter(onLine: (l: string) => void, maxLine = 16 * 1024 * 1024): { push(chunk: Buffer | string): void; end(): void; dropped(): number } // UTF-8 safe across chunks, CRLF ok, over-long lines dropped+counted
```
Text fields truncated (assistant text 4000, result text 4000, description/decisionReason 500, strip ANSI from
decision_reason). `result.denials` = `permission_denials.length`. `subtype:'error_during_execution'` after an
interrupt is mapped by T07, not here.

args.ts:
```ts
export interface ControlLaunch { model?: string; permissionMode: 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk'; resume?: { kind: 'resume'; sessionId: string; fork?: boolean } | { kind: 'continue' } }
export const MODEL_RE = /^[A-Za-z0-9._\[\]-]{1,64}$/
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function buildControlArgs(l: ControlLaunch): string[] | null // null on invalid model/mode/sessionId
```
Order: `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
--permission-prompt-tool stdio --permission-mode <mode>` then `--model <m>` if set, then `--resume <id>` (+
`--fork-session`) or `--continue`. Never `bypassPermissions`, never `--dangerously-*`. Mode `default` is passed as
`default` (the CLI also accepts `manual`).

agentMessage.ts:
```ts
export function formatAgentMessage(agentName: string, text: string): string // D2 exact format
export type ConsoleRoute = { kind: 'send'; text: string; targetAgentId?: string } | { kind: 'error'; reason: 'empty' | 'unknown-agent' | 'too-long' }
export function routeConsoleInput(input: string, agents: { id: string; name: string }[], leadId = 'lead'): ConsoleRoute
```
`@name rest` (name matched case-insensitively against agent names; names may contain spaces: longest match wins;
`@lead` = plain) -> formatted; `/cmd ...` sent verbatim; max 32 000 chars; trimmed.
displayPath.ts (UX S4, used by console, Files tab, cards, worktree cards):
`shortenPath(p: string, o: { root?: string; home?: string; platform: string }): { short: string; full: string }` -
relative to `root` when inside it (slash/case-insensitive on win32), temp/scratchpad dirs (`AppData/Local/Temp/...`,
`/tmp/...`) collapsed to `‹tmp›/<last 2 segments>`, home -> `~`; `shortenPathsInText(text, o)` applies it to absolute
paths found in a console line (Windows drive and posix forms). Tests with `C:/Users/u/acme`.
Tests: one fixture line per verified shape in plan facts 3-6 (hand-written, synthetic ids), malformed JSON, unknown
type, huge line drop, split multibyte chunk, every encoder round-trips through JSON.parse with the exact keys.

## Acceptance commands
- npm test -- tests/main/control tests/shared/agentMessage.test.ts tests/shared/displayPath.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
