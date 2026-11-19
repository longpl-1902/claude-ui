# T23 - Contract v5: VS Code parity types and channels

- Wave: 9
- Depends on: T01-T22 merged
- Spec refs: R-27..R-32 (plan.md "VS Code parity")
- Tests: tests/shared/ipcContract.test.ts

## Goal
Single owner of every shared contract change for the parity work: types, channels, preload, mock handler stubs.

## Owned files
- modify: src/shared/types.ts, src/shared/ipc.ts, src/preload/index.ts
- modify: src/main/ipc/handlers.ts (mock stubs + validators only)
- modify: tests/shared/ipcContract.test.ts

## Read-only context
- plan.md "VS Code parity" (verified facts P1-P12), T01 task file (style)

## Notes
Types (additive):
```ts
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CommandSource = 'builtin' | 'user' | 'project' | 'plugin' | 'skill' | 'mcp' | 'unknown'
export interface SlashCommandInfo { name: string; description: string; argumentHint?: string; source: CommandSource; aliases?: string[] }
export type McpLiveStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
export interface McpServerLive { name: string; status: McpLiveStatus; serverInfo?: { name: string; version: string }; error?: string }
export interface ContextUsage { totalTokens: number; maxTokens: number; percentage: number; categories: { name: string; tokens: number; percentage: number }[]; model?: string; fetchedAt: string }
export interface TurnCost { costUsd?: number; input: number; output: number; cacheCreation: number; cacheRead: number; durationMs?: number }
export interface UserTurnRef { uuid: string; text: string; time: string }      // text <= 120 chars
export interface ControlDetails { controlId: string; commands: SlashCommandInfo[]; agents: { name: string; description?: string }[]; models: { value: string; displayName: string; description?: string }[]; outputStyle?: string; availableOutputStyles: string[]; effort?: Effort; mcp: McpServerLive[]; tools: string[]; context?: ContextUsage; lastTurn?: TurnCost; sessionCostUsd: number; userTurns: UserTurnRef[]; checkpointing: boolean; title?: string }
export interface ImageAttachment { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string; name?: string } // <= 5 MiB decoded each, <= 5 per turn
export interface RewindPreview { canRewind: boolean; filesChanged: string[]; insertions: number; deletions: number; error?: string }
export interface FileSuggestion { path: string; score?: number }
export type CatalogKind = 'skill' | 'agent' | 'command' | 'output-style'
export interface CatalogItem { kind: CatalogKind; name: string; description?: string; scope: 'user' | 'project' | 'plugin'; plugin?: string; path: string; argumentHint?: string; model?: string }
export interface PluginInfo { id: string; name: string; marketplace?: string; version?: string; enabled: boolean; scope?: string; description?: string }
export interface McpConfigured { name: string; scope: 'local' | 'user' | 'project' | 'plugin' | 'unknown'; transport?: string; target: string; status: string; pendingApproval?: boolean }  // target masked
export interface McpAddRequest { projectRoot: string; accountId: string; name: string; scope: 'local' | 'user' | 'project'; transport: 'stdio' | 'http' | 'sse'; commandOrUrl: string; args: string[]; env: Record<string, string>; headers: Record<string, string> }
export interface CliPreview { previewId: string; argvDisplay: string[]; cwd: string; configDir: string; effect: string; warnings: string[] } // secrets masked in argvDisplay
export interface CliRunResult { ok: boolean; reason?: string; output?: string } // output masked, <= 4 KiB
```
`PermissionAnswer` gains `answers?: Record<string, string>` (AskUserQuestion). `ControlStartRequest` gains
`effort?: Effort; outputStyle?: string; resumeAt?: string /* user message uuid, requires resume.fork */`.
Channels (invoke): `control:details` (id) -> ControlDetails | null; `control:send-rich` (id, text, images:
ImageAttachment[]) -> OkResult; `control:refresh-context` (id) -> OkResult; `control:mcp-toggle` (id, name, enabled)
-> OkResult; `control:mcp-reconnect` (id, name) -> OkResult; `control:file-suggestions` (id | null, cwd, query) ->
FileSuggestion[]; `control:rewind-preview` (id, uuid) -> RewindPreview; `control:rewind` (id, uuid) -> OkResult;
`control:fork-at` (id, uuid) -> ControlStartResult; `control:set-effort` (id, effort | null) -> OkResult;
`control:set-output-style` (id, style | null) -> OkResult; `control:rename` (id, title) -> OkResult;
`control:get-plan` (id) -> { exists: boolean; content?: string }; `catalog:list` (projectRoot | null, accountId) ->
CatalogItem[]; `catalog:open` (path) -> OkResult; `mcp:list` (projectRoot, accountId) -> { servers: McpConfigured[];
ranAt: string; error?: string }; `mcp:preview-add` (req) -> CliPreview | OkResult; `mcp:preview-remove` (projectRoot,
accountId, name, scope | null) -> CliPreview | OkResult; `plugins:list` (accountId) -> { plugins: PluginInfo[];
error?: string }; `plugins:preview` (accountId, action: 'enable' | 'disable' | 'install' | 'uninstall', id) ->
CliPreview | OkResult; `cli:apply` (previewId) -> CliRunResult.
Push: `control:details` (ControlDetails) -> `control.onDetails`.
ConsoleApi groups: extend `control`, new `catalog`, `mcp`, `plugins`, `cli`. Validators exported: isImageAttachment
(mediaType whitelist, base64 charset, size), isMcpAddRequest (name `^[A-Za-z0-9_.-]{1,64}$`, scope/transport
enums, string maps <= 50 entries, values <= 4096), isEffort, uuid regex for rewind ids. Mock stubs: empty/NOT_IMPLEMENTED.

## Acceptance commands
- npm test -- tests/shared/ipcContract.test.ts tests/main/ipcHandlers.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
