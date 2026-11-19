# T10 - External "Stop process", Open in VS Code, hooks service

- Wave: 4
- Depends on: T04, T05, T07
- Spec refs: R-07, R-17, hard rules 1 and 3
- Tests: tests/main/control/externalKill.test.ts, tests/main/editor/openInEditor.test.ts, tests/main/hooks/hooksService.test.ts

## Goal
Three main-process services the IPC layer (T13) calls: a guarded kill of an external Claude session process, a
shell-free `code <path>`, and the hooks service (status / preview / apply per project, server lifecycle, event fan-out).

## Owned files
- create: src/main/control/externalKill.ts
- create: src/main/editor/openInEditor.ts
- create: src/main/hooks/hooksService.ts
- create: tests/main/control/externalKill.test.ts
- create: tests/main/editor/openInEditor.test.ts
- create: tests/main/hooks/hooksService.test.ts

## Read-only context
- src/main/control/processTree.ts (T07: createKillTree, createImageName)
- src/main/transcripts/sessionIndex.ts (`readRegistry`, `LiveRegistry`), src/main/transcripts/layout.ts (`parseRegistryEntry`)
- src/main/hooks/{hookPayload,hookInstaller,hookServer,endpointFile,hookRuntime}.ts (T04, T05)
- plan.md Verified facts 13-14, Decisions D3, D11

## Notes
externalKill.ts:
```ts
export function createExternalKiller(deps: { readRegistry: () => Promise<{ accountId: string; entry: { pid: number; sessionId: string } }[]>; isPidAlive: (pid: number) => boolean; imageName: (pid: number) => Promise<string | null>; killTree: (pid: number) => Promise<void>; ownPids: () => number[] }): { kill(req: KillExternalRequest): Promise<OkResult> }
```
Refuse (reason): invalid args; pid in `ownPids()` ('app-owned', use Stop instead); no registry entry with that
accountId + pid + sessionId ('not-registered'); pid not alive ('not-running'); image not `claude`/`claude.exe`/
`node`/`node.exe` (case-insensitive) ('unexpected-process'); then killTree -> ok. Every check runs at call time.

openInEditor.ts:
```ts
export function createOpenInEditor(deps: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; exists: (p: string) => boolean; isDir: (p: string) => Promise<boolean>; spawnDetached: (file: string, args: string[], env?: Record<string, string>) => boolean; openPath: (p: string) => Promise<string> }): { open(path: string): Promise<OkResult> }
```
Path must be absolute and an existing directory ('invalid-path'). win32: find `code.cmd` on PATH -> `<dir>\..\Code.exe` +
`<dir>\..\resources\app\out\cli.js` exist -> spawnDetached(Code.exe, [cli.js, path], {...env, ELECTRON_RUN_AS_NODE:'1'}).
posix: `code` on PATH -> spawnDetached(code, [path]). No VS Code -> `openPath(path)` (file manager) and
`{ok:true, reason:'opened-folder'}`. Never a shell.

hooksService.ts:
```ts
export function createHooksService(deps: { server: ReturnType<typeof createHookServer>; installer: ReturnType<typeof createHookInstaller>; resolveNode: () => string | null; installScript: () => Promise<string>; onHook: (e: HookEvent) => void }): {
  start(): Promise<void>; stop(): Promise<void>
  status(projectRoot: string | null): Promise<HooksStatus>
  preview(projectRoot: string, action: 'install' | 'uninstall'): Promise<HooksPreview | OkResult>
  apply(previewId: string): Promise<OkResult>
  onChanged(cb: (s: HooksStatus) => void): () => void   // after apply and (throttled 2 s) after events
}
```
The server is created by T13 with `parse: parseHookPayload` and `onEvent` -> this service's handler (counts, then
`deps.onHook`). Status: projectRoot null -> 'unavailable' reason 'no-project'; node missing -> 'unavailable' reason
'node-not-found'; invalid settings JSON -> 'unavailable' reason 'invalid-json'; else `hooksState(json, entry)`.
Preview install: `installScript()` first (copy into userData), then installer.preview. Uninstall needs no node.
Tests with fakes for all deps.

## Acceptance commands
- npm test -- tests/main/control/externalKill.test.ts tests/main/editor tests/main/hooks/hooksService.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
