# T04 - Pty layer: claude binary resolver, child env, pty manager

- Wave: 2
- Depends on: T01 (PtyPurpose, PtyInfo in @shared/types; node-pty externalized)
- Spec refs: R-09; plan Verified facts 3, 10, 12, 13
- Tests: tests/main/pty/{claudeBinary,childEnv,ptyManager}.test.ts

## Goal
Launch the real `claude` CLI in a node-pty from the main process with a clean environment and the right
`CLAUDE_CONFIG_DIR`, keep a scrollback buffer per pty, and expose a small manager API that the accounts
service and IPC handlers use. Everything is injectable and tested with a fake pty module.

## Owned files
- create: src/main/pty/types.ts
- create: src/main/pty/claudeBinary.ts
- create: src/main/pty/childEnv.ts
- create: src/main/pty/ptyManager.ts
- create: tests/main/pty/claudeBinary.test.ts
- create: tests/main/pty/childEnv.test.ts
- create: tests/main/pty/ptyManager.test.ts

## Read-only context
- .factory/20261119-phase2-accounts/tasks/T01-contract-config.md ("Main-internal interfaces": the exact PtyManagerApi text)
- src/shared/types.ts (after T01)
- node_modules/node-pty/typings/node-pty.d.ts

## Notes
### types.ts
Copy `PtyClaudeRequest`, `PtySpawnOutcome`, `PtyManagerApi` exactly from T01 Notes.

### claudeBinary.ts
```ts
export interface ClaudeCommand { file: string; argsPrefix: string[]; via: 'exe' | 'npm-shim-exe' | 'cmd-shim' | 'posix' }
export function resolveClaudeCommand(o: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; home: string; exists: (p: string) => boolean }): ClaudeCommand | null
```
- Read PATH case-insensitively on win32 (`Path`/`PATH`). Split with `;` (win32) or `:`.
- win32, per PATH dir in order: `claude.exe` → `{file, [], 'exe'}`; `claude.cmd` → if `<dir>/node_modules/@anthropic-ai/claude-code/bin/claude.exe` exists → `'npm-shim-exe'`; else `{ file: env.ComSpec ?? 'cmd.exe', argsPrefix: ['/d','/s','/c', <cmd path>], via: 'cmd-shim' }`. After PATH: `<home>/.local/bin/claude.exe`.
- posix: PATH `claude`, then `<home>/.local/bin/claude`, `<home>/.claude/local/claude`.
- Not found → null. Real `exists` = `fs.existsSync` (caller passes it in).

### childEnv.ts
```ts
export const STRIPPED_ENV_VARS: readonly string[]   // exact list in plan Verified facts 13 (incl. ELECTRON_RUN_AS_NODE, CLAUDECODE, CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_MESSAGING_TOKEN, ...)
export function buildChildEnv(base: Readonly<Record<string, string | undefined>>, o: { configDirAbs: string | null; platform: NodeJS.Platform }): Record<string, string>
```
- Copy only string values. Delete `STRIPPED_ENV_VARS` and any existing `CLAUDE_CONFIG_DIR`, matching keys case-insensitively on win32.
- `configDirAbs` non-null → set `CLAUDE_CONFIG_DIR`. Throw if not absolute (the CLI rejects relative values; see Verified facts 3).
- Default account (`null`) → CLAUDE_CONFIG_DIR is absent from the result.
- Keep user vars such as `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `ANTHROPIC_*` and `PATH` untouched. Set `TERM=xterm-256color` and `COLORTERM=truecolor` if absent.

### ptyManager.ts
```ts
export interface NodePtyLike { spawn(file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string>; useConpty?: boolean }): IPtyLike }
export interface IPtyLike { pid: number; write(d: string): void; resize(c: number, r: number): void; kill(): void; onData(cb: (d: string) => void): { dispose(): void }; onExit(cb: (e: { exitCode: number }) => void): { dispose(): void } }
export function createPtyManager(deps: {
  loadPty: () => Promise<NodePtyLike | null>        // real: lazy `await import('node-pty')` inside try/catch → null
  resolveClaude: () => ClaudeCommand | null
  baseEnv: Readonly<Record<string, string | undefined>>
  platform: NodeJS.Platform
  now?: () => Date; newId?: () => string; bufferLimit?: number   // default 256 KiB of chars per pty
}): PtyManagerApi
export async function loadNodePty(): Promise<NodePtyLike | null>   // the real loader; never throws
```
- `spawnClaude`: if `loadPty()` returns null → `pty-unavailable`. If resolveClaude returns null → `claude-not-found`. Otherwise spawn `file` with `[...argsPrefix, ...(req.args ?? [])]`, cwd, `buildChildEnv(baseEnv, { configDirAbs })`, cols/rows (default 120x30) and `name: 'xterm-256color'`. A throw maps to `spawn-failed`. Cache the loaded module.
- `PtyInfo.configDir` = `req.configDirDisplay`. `startedAt` = ISO. Record `exitCode` on exit. Keep exited entries in `list()` until `kill(id)` or 20 newer entries exist.
- Buffer: append data and trim from the front to `bufferLimit`. `buffer(id)` returns it.
- `write`/`resize`/`kill` return false for an unknown or exited id. `disposeAll()` kills every live pty (index.ts calls it on `before-quit`).
- Listener errors must not break other listeners.
- Never log pty data (it can contain the login URL or a pasted code).

### Tests
- claudeBinary: a win32 table with an `.exe` on PATH, the npm shim with a sibling exe, the shim without an exe → cmd-shim, the `Path` key casing, the local-bin fallback, posix, not found.
- childEnv: strips each denylisted var, including lower/mixed case on win32, but only exact case on posix. Sets/overrides/removes CLAUDE_CONFIG_DIR. A relative dir throws. Keeps the user vars. Drops undefined values.
- ptyManager with a fake NodePtyLike: spawn args and env (assert there is no ELECTRON_RUN_AS_NODE, and CLAUDE_CONFIG_DIR is set for a dir and absent for null). Data fan-out, buffer trimming, exit recording, write after exit returns false, disposeAll kills all, loadPty null → pty-unavailable, resolver null → claude-not-found, spawn throws → spawn-failed.

## Acceptance commands
- npm test -- tests/main/pty
- npm run typecheck
- npm run check:pty

## Done when
- All acceptance commands pass
- Only owned files changed
