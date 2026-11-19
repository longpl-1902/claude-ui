# T24 - Stream-json protocol v2: request/response encoders, rich user turns, new args

- Wave: 9
- Depends on: T02 (extends its files)
- Spec refs: R-27, R-29, R-30, R-31
- Tests: tests/main/control/protocolV2.test.ts, tests/main/control/args.test.ts

## Goal
Pure encoders/parsers for the parity control requests (all verified by schema in the installed CLI and used by the
VS Code extension), image user turns, and launch args for effort / output style / checkpointing / fork-at.

## Owned files
- modify: src/main/control/protocol.ts
- modify: src/main/control/args.ts
- create: tests/main/control/protocolV2.test.ts
- modify: tests/main/control/args.test.ts (new cases only)

## Read-only context
- plan.md "VS Code parity" facts P1-P12; existing tests/main/control/protocol.test.ts must stay green

## Notes
Keep local types (no import from shared types; T23 runs in parallel). Add:
```ts
export type CtlReq =
  | { subtype: 'initialize' } | { subtype: 'mcp_status' } | { subtype: 'mcp_toggle'; serverName: string; enabled: boolean }
  | { subtype: 'mcp_reconnect'; serverName: string } | { subtype: 'get_context_usage'; detail?: 'summary' }
  | { subtype: 'rewind_files'; user_message_id: string; dry_run?: boolean } | { subtype: 'file_suggestions'; query: string }
  | { subtype: 'apply_flag_settings'; settings: { effortLevel?: string; outputStyle?: string } }
  | { subtype: 'rename_session'; title: string } | { subtype: 'get_plan' } | { subtype: 'get_session_cost' }
export function encodeRequest(requestId: string, req: CtlReq): string   // generalizes encodeControlRequest (keep the old export)
export function encodeUserTurnRich(text: string, images: { mediaType: string; dataBase64: string }[]): string
  // message.content = [...images.map(i => ({type:'image', source:{type:'base64', media_type, data}})), {type:'text', text}]
export function encodeAllowWithAnswers(requestId: string, input: Record<string, unknown>, answers: Record<string, string>): string // updatedInput = {...input, answers}
export function parseInitializeResponse(r: unknown): { commands: {name: string; description: string; argumentHint?: string; aliases?: string[]; builtin?: boolean}[]; agents: {name: string; description?: string}[]; models: {value: string; displayName: string; description?: string}[]; outputStyle?: string; availableOutputStyles: string[] }
export function parseMcpStatus(r: unknown): { name: string; status: string; serverInfo?: {name: string; version: string}; error?: string }[]
export function parseContextUsage(r: unknown): { totalTokens: number; maxTokens: number; percentage: number; categories: {name: string; tokens: number; percentage: number}[]; model?: string } | null
export function parseRewind(r: unknown): { canRewind: boolean; filesChanged: string[]; insertions: number; deletions: number; error?: string }
export function parseFileSuggestions(r: unknown): { path: string; score?: number }[]
export function parsePlan(r: unknown): { exists: boolean; content?: string }
```
Parser additions to `parseOutputLine`: `control-response` keeps the raw `response` object (`body?: unknown`);
`system/commands_changed` -> `{ t: 'commands'; commands: [...] }`; replayed user lines (with `--replay-user-messages`
the CLI echoes our user turns with `uuid`) -> `{ t: 'user-echo'; uuid; text }` when the message content is a plain user
prompt (no tool_result); `result` gains `usage` totals (input/output/cache) and `durationMs`.
Command source inference (export `commandSource(c)`): builtin -> 'builtin'; name contains ':' with a plugin prefix
-> 'plugin'; `mcp__` prefix -> 'mcp'; else 'unknown' (the catalog scan refines user/project/skill in the UI).
args.ts: `ControlLaunch` gains `effort?`, `outputStyle?`, `resumeAt?`; build adds `--replay-user-messages` always,
`--effort <e>` (enum), `--settings <json>` with exactly `{"outputStyle": "<name>"}` when set (name
`^[A-Za-z0-9 _.-]{1,64}$`), `--resume-session-at <uuid>` only with resume+fork. Export `CHECKPOINT_ENV =
'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING'` for T26 (env value '1').
Tests: every encoder shape, every parser with synthetic responses incl. malformed input, rich turn content order,
args with each new option, invalid values rejected.

## Acceptance commands
- npm test -- tests/main/control
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
