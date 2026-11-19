# T04 - Hook payload parser and settings installer (merge / unmerge / preview / apply)

- Wave: 2
- Depends on: T01
- Spec refs: R-14, R-17, hard rules 3 and 5, spec "1. Hook events"
- Tests: tests/main/hooks/hookPayload.test.ts, tests/main/hooks/hookInstaller.test.ts

## Goal
Parse raw hook JSON into the small `HookEvent` (T01) and implement the installer logic for
`<projectRoot>/.claude/settings.local.json`: compute the exact before/after text for a preview and apply it only
when the file still matches what was previewed.

## Owned files
- create: src/main/hooks/hookPayload.ts
- create: src/main/hooks/hookInstaller.ts
- create: tests/main/hooks/hookPayload.test.ts
- create: tests/main/hooks/hookInstaller.test.ts

## Read-only context
- plan.md Verified facts 10-11, Decision D11
- src/shared/types.ts (HookEvent, HookEventName, HooksState, HooksPreview from T01)
- src/main/accounts/profileStore.ts (atomic write pattern)

## Notes
hookPayload.ts:
```ts
export const HOOK_EVENTS: readonly HookEventName[] // the 16 names, in D11 order
export function parseHookPayload(body: unknown, receivedMs: number): HookEvent | null
```
Requires `hook_event_name` in HOOK_EVENTS and string `session_id`; maps snake_case fields (agent_id, agent_type,
permission_mode, tool_name, tool_use_id, notification_type, message, error, is_interrupt, task_id, task_subject,
teammate_name, source, reason, cwd). **Never copies tool_input, tool_response, prompt, last_assistant_message or
transcript paths.** Strings truncated to 300 chars; wrong types dropped; never throws.

hookInstaller.ts:
```ts
export const HOOK_MARKER = 'agent-console-hook'
export interface HookEntry { type: 'command'; command: string; args: string[]; async: true; timeout: number }
export function buildHookEntry(nodePath: string, scriptPath: string): HookEntry // timeout 10
export function isOurHook(h: unknown): boolean  // command hook whose args[0] or command contains HOOK_MARKER
export function mergeHooks(settings: Record<string, unknown>, entry: HookEntry): Record<string, unknown>   // for each event: remove our old hooks, append {hooks:[entry]} group (no matcher); other keys/groups untouched, key order kept
export function unmergeHooks(settings: Record<string, unknown>): Record<string, unknown>                  // remove only our hooks; drop groups left empty, events left empty, and `hooks` if empty
export function hooksState(settings: Record<string, unknown> | null, entry: HookEntry | null): HooksState  // all 16 present and equal -> installed; some -> partial; ours but different command/args -> outdated; none -> not-installed
export interface InstallerFs { readText(p: string): Promise<string | null>; writeTextAtomic(p: string, text: string): Promise<void>; mkdirp(p: string): Promise<void> }
export function createHookInstaller(deps: { fs: InstallerFs; newId: () => string; platform: NodeJS.Platform }): {
  settingsPathFor(projectRoot: string): string
  read(projectRoot: string): Promise<{ text: string | null; json: Record<string, unknown> | null; error?: 'invalid-json' | 'not-object' }>
  preview(projectRoot: string, action: 'install' | 'uninstall', entry: HookEntry, scriptPath: string): Promise<HooksPreview | { ok: false; reason: string }>
  apply(previewId: string): Promise<{ ok: boolean; reason?: string }>
}
```
Output text = `JSON.stringify(obj, null, 2) + '\n'`. `before` = current text or null (missing file). `after` = the
new text, except: uninstall that leaves an empty object AND our backup records "file did not exist" -> `after: null`
(apply deletes the file); otherwise the object is written (possibly `{}`). Add `remove(p)` to InstallerFs for that. Preview refuses `invalid-json`/`not-object` (never overwrite a file we cannot parse) and
`nothing-to-do`. `apply`: unknown/expired previewId (10 min) -> 'expired'; re-read file, text !== preview.before ->
'changed-since-preview'; first apply for that path writes backup `settings.local.json.agent-console.bak` with the
original text (or a JSON marker `{"agentConsoleBackup":"file did not exist"}` when missing) unless it exists;
`mkdirp(<root>/.claude)`. Previews are single-use. `notes` lists: the settings path, backup path, script path, "Hooks
run asynchronously and never block Claude", "Restart running Claude sessions to load hooks" (verify wording only).
Tests: merge into empty/missing file, into file with other hooks and permissions (preserved byte-for-byte after
re-stringify of the same object), idempotent re-merge, outdated path replaced, unmerge leaves foreign hooks, invalid
JSON refused, changed-since-preview refused, backup written once, uninstall of a file we created deletes it.

## Acceptance commands
- npm test -- tests/main/hooks/hookPayload.test.ts tests/main/hooks/hookInstaller.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
