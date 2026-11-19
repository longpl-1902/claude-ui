# T01 - IPC contract v2, config for node-pty, stubs

- Wave: 1
- Depends on: none
- Spec refs: R-01, R-09 (config part), plan "Verified facts" 10-11
- Tests: tests/shared/ipcContract.test.ts, tests/main/ipcHandlers.test.ts (kept green with stubs)

## Goal
Lay the shared foundation that every other Phase 2 task codes against: the new shared types, the IPC
channel map and `ConsoleApi`, the preload bridge, stub handlers for every new
channel, a stub `TerminalView` component, and the build/packaging config that lets node-pty load from the
Electron main process.

## Owned files
- modify: src/shared/types.ts
- modify: src/shared/ipc.ts
- create: src/shared/accountsDefaults.ts
- modify: src/preload/index.ts
- modify: src/main/ipc/handlers.ts (stubs only)
- create: src/renderer/src/components/terminal/TerminalView.tsx (stub)
- modify: tests/shared/ipcContract.test.ts
- modify: tests/main/ipcHandlers.test.ts (only what the stubs require)
- modify: package.json (scripts only: add `"check:pty": "node scripts/check-pty.mjs"`; do not touch deps)
- create: scripts/check-pty.mjs
- modify: electron.vite.config.ts
- modify: electron-builder.yml

## Read-only context
- .factory/20261119-phase2-accounts/plan.md (Verified facts, Architecture)
- src/shared/mock/accounts.ts (must still type-check against the new types)
- src/preload/index.d.ts

## Notes
### types.ts (add; keep every Phase 1 type compiling; new fields optional so mocks stay valid)
```ts
export type AccountKind = 'company' | 'personal'
// AccountProfile: add `kind?: AccountKind`
// AccountView: add `locked?: boolean; isDefaultDir?: boolean`
// DetectedLogin: add `isDefaultDir?: boolean; exists?: boolean; warnings?: string[]`
// RunningSession: add `ptyId?: string`
// AccountsSnapshot: add `ptyAvailable?: boolean; claudeFound?: boolean`
export type SignInStep = 'none' | 'waiting' | 'done' | 'error'          // 'error' added
export interface SignInStatus { configDir: string; step: SignInStep; email?: string; org?: string; ptyId?: string; reason?: string }
export interface AccountsFile { version: 1; profiles: AccountProfile[]; rules: FolderRule[]; defaultAccountId: string | null; safety: SafetySettings; limitPolicy: LimitPolicy }
export interface ProfileInput { id?: string; name: string; color: string; configDir: string; kind?: AccountKind }
export interface LinkDetectedRequest { configDir: string; accountId?: string; name?: string; color?: string; kind?: AccountKind }
export interface OkWithId extends OkResult { accountId?: string }
export interface FolderResolution { accountId: string | 'ask'; ruleIndex: number; pattern?: string }   // ruleIndex -1 = fallback
export type LaunchWarning = 'personal-in-company-folder'
export type LaunchBlock = 'account-locked' | 'unknown-account' | 'pty-unavailable' | 'claude-not-found' | 'invalid-folder'
export interface LaunchCheck { allowed: boolean; warnings: LaunchWarning[]; blockedReason?: LaunchBlock; matched: FolderResolution }
export type PtyPurpose = 'claude' | 'login'
export interface PtyInfo { id: string; purpose: PtyPurpose; cwd: string; accountId?: string; configDir: string; pid: number; startedAt: string; exitCode?: number }
export interface PtySpawnRequest { cwd: string; accountId: string; cols: number; rows: number; confirmed?: boolean }
export interface PtySpawnResult { ok: boolean; ptyId?: string; reason?: LaunchBlock | 'needs-confirmation' | 'invalid-args' | 'spawn-failed'; warnings?: LaunchWarning[] }
export interface PtyDataEvent { ptyId: string; data: string }
export interface PtyExitEvent { ptyId: string; exitCode: number }
```
### accountsDefaults.ts
`DEFAULT_SAFETY: SafetySettings` (all three true), `DEFAULT_LIMIT_POLICY: LimitPolicy = 'pause'`,
`ACCOUNT_COLORS = ['#6E9BF0','#F2A541','#5ED3A8','#C792EA','#F07178','#82AAFF']`,
`EMPTY_ACCOUNTS_SNAPSHOT: AccountsSnapshot` = `{ accounts: [], defaultAccountId: '', activeAccountId: '', detected: [], rules: [], safety: DEFAULT_SAFETY, limitPolicy: 'pause', sessions: [] }`,
`emptyAccountsFile(): AccountsFile` (version 1, empty lists, `defaultAccountId: null`, defaults). Pure, no Node imports.

### ipc.ts: add to `IPC` and `IpcInvokeMap` (exact names)
| const key | channel | args | result |
|---|---|---|---|
| accountsScan | accounts:scan | [] | AccountsSnapshot |
| accountsLinkDetected | accounts:link-detected | [req: LinkDetectedRequest] | OkWithId |
| accountsSaveProfile | accounts:save-profile | [p: ProfileInput] | OkWithId |
| accountsRemoveProfile | accounts:remove-profile | [accountId: string] | OkResult |
| accountsSetRules | accounts:set-rules | [rules: FolderRule[]] | OkResult |
| accountsSetSafety | accounts:set-safety | [s: SafetySettings] | OkResult |
| accountsSetLimitPolicy | accounts:set-limit-policy | [p: LimitPolicy] | OkResult |
| accountsResolveFolder | accounts:resolve-folder | [folder: string] | FolderResolution |
| accountsCheckLaunch | accounts:check-launch | [folder: string, accountId: string] | LaunchCheck |
| accountsReopenSignIn | accounts:reopen-sign-in | [configDir: string] | OkResult |
| ptySpawn | pty:spawn | [req: PtySpawnRequest] | PtySpawnResult |
| ptyWrite | pty:write | [ptyId: string, data: string] | OkResult |
| ptyResize | pty:resize | [ptyId: string, cols: number, rows: number] | OkResult |
| ptyKill | pty:kill | [ptyId: string] | OkResult |
| ptyList | pty:list | [] | PtyInfo[] |
| ptyGetBuffer | pty:get-buffer | [ptyId: string] | string |
| appPickFolder | app:pick-folder | [] | string \| null |
| appGetDefaultCwd | app:get-default-cwd | [] | string |
Change `accounts:check-sign-in` result to `SignInStatus`.
Push-only channels (not in IpcInvokeMap): `teamEvent` (existing), `accountsChanged: 'accounts:changed'` (AccountsSnapshot),
`accountsSignInStatus: 'accounts:sign-in-status'` (SignInStatus), `ptyData: 'pty:data'` (PtyDataEvent), `ptyExit: 'pty:exit'` (PtyExitEvent).
Export `PUSH_CHANNELS = [IPC.teamEvent, IPC.accountsChanged, IPC.accountsSignInStatus, IPC.ptyData, IPC.ptyExit] as const`.
Keep the compile-time exhaustiveness list in sync.

`ConsoleApi` additions:
```ts
accounts: { ...existing, checkSignIn(dir): Promise<SignInStatus>, scan(), linkDetected(req), saveProfile(p), removeProfile(id),
  setRules(r), setSafety(s), setLimitPolicy(p), resolveFolder(folder), checkLaunch(folder, accountId), reopenSignIn(dir),
  onChanged(cb: (s: AccountsSnapshot) => void): () => void, onSignInStatus(cb: (s: SignInStatus) => void): () => void }
pty: { spawn(req), write(id, data), resize(id, cols, rows), kill(id), list(), getBuffer(id),
  onData(cb: (e: PtyDataEvent) => void): () => void, onExit(cb: (e: PtyExitEvent) => void): () => void }
app: { getVersion(), pickFolder(): Promise<string | null>, getDefaultCwd(): Promise<string> }
```
Preload: implement all via `invoke` / an `on(channel)` helper that returns an unsubscribe (same pattern as `team.onEvent`). Keep the preload sandbox-safe (only `electron` + inlined constants).

### Main-internal interfaces (canonical text; NOT created by T01)
Ownership so no task waits on a same-wave file:
- `DirEntry`, `ReadFs`, `WriteFs`, `HostEnv`, `DisplayFields` → **T02** creates `src/main/contracts.ts` (no `@shared` imports).
- `PtyClaudeRequest`, `PtySpawnOutcome`, `PtyManagerApi` → **T04** creates `src/main/pty/types.ts` (imports `PtyPurpose`, `PtyInfo` from `@shared/types`).
- `FileWatcher`, `WatchFile` → **T07** exports them from `src/main/accounts/signIn.ts`.
```ts
export interface DirEntry { name: string; isDirectory(): boolean; isFile(): boolean }
export interface ReadFs {
  readFile(path: string): Promise<string>            // utf8; rejects ENOENT
  readdir(path: string): Promise<DirEntry[]>
  exists(path: string): Promise<boolean>
  mtimeMs(path: string): Promise<number | null>      // null when missing
}
export interface WriteFs extends ReadFs {
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>                 // recursive
}
export interface HostEnv { home: string; platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; appData?: string }
export interface DisplayFields { signedIn: boolean; email?: string; org?: string; missing?: boolean; unreadable?: boolean }
export interface PtyClaudeRequest { purpose: PtyPurpose; cwd: string; configDirAbs: string | null; args?: string[]; cols?: number; rows?: number; accountId?: string; configDirDisplay: string }
export type PtySpawnOutcome = { ok: true; id: string } | { ok: false; reason: 'pty-unavailable' | 'claude-not-found' | 'spawn-failed' }
export interface PtyManagerApi {
  available(): Promise<boolean>
  spawnClaude(req: PtyClaudeRequest): Promise<PtySpawnOutcome>
  write(id: string, data: string): boolean
  resize(id: string, cols: number, rows: number): boolean
  kill(id: string): boolean
  buffer(id: string): string
  list(): PtyInfo[]
  onData(cb: (id: string, data: string) => void): () => void
  onExit(cb: (id: string, exitCode: number) => void): () => void
  disposeAll(): void
}
export interface FileWatcher { close(): void }
export type WatchFile = (absFile: string, onChange: () => void) => FileWatcher
```
`configDirAbs: null` means "default account: leave CLAUDE_CONFIG_DIR unset".

### handlers.ts (stubs only)
Add an entry for every new invoke channel: mutations → `{ ok: false, reason: 'not-implemented' }`; `accounts:scan` → mock snapshot;
`resolve-folder` → `{ accountId: 'ask', ruleIndex: -1 }`; `check-launch` → `{ allowed: false, warnings: [], blockedReason: 'pty-unavailable', matched: { accountId: 'ask', ruleIndex: -1 } }`;
`pty:list` → `[]`; `pty:get-buffer` → `''`; `app:pick-folder` → `null`; `app:get-default-cwd` → `''`;
`check-sign-in` → `{ configDir, step: 'waiting' }`. Validate argument types like Phase 1 (`invalid-args`). T07 replaces these.

### TerminalView stub (contract T08 implements, T09 imports)
```tsx
export interface TerminalViewProps { ptyId: string; ariaLabel?: string; className?: string; interactive?: boolean /* default true */ }
export function TerminalView(props: TerminalViewProps): JSX.Element  // stub: <div className="ac-term" data-pty-id={ptyId} role="region" aria-label={ariaLabel ?? 'Terminal'} />
```

### Config
- electron.vite.config.ts main: `build: { externalizeDeps: { include: ['node-pty'] } }` (electron-vite 6 externalizes only `dependencies`; node-pty is optional).
- electron-builder.yml: `npmRebuild: false` (rebuild fails on winpty; N-API prebuilds are used); keep `asarUnpack: node_modules/node-pty/**`.
- scripts/check-pty.mjs: spawn `node_modules/electron/dist/electron(.exe)` with `ELECTRON_RUN_AS_NODE=1` running an inline CJS script (write it to `os.tmpdir()`) that requires `node-pty` from the repo, spawns `cmd.exe /d /c echo agent-console-pty-ok` (win32) or `sh -c 'echo agent-console-pty-ok'`, with ELECTRON_RUN_AS_NODE deleted from the child env, and exits 0 iff the marker is seen within 15 s. Print one line: `node-pty OK (prebuilt|build)` or the error.
- Do NOT run `npm run rebuild:pty` (verified: fails and deletes build/Release/conpty).

### Tests
ipcContract.test.ts: channels unique; naming pattern; `INVOKE_CHANNELS` = all channels minus `PUSH_CHANNELS`; every ConsoleApi group method has a channel (spot list).
ipcHandlers.test.ts: keep Phase 1 cases passing; update the check-sign-in expectation; one case per new stub returns the stub shape.

## Acceptance commands
- npm run typecheck
- npm test
- npm run build
- npm run check:pty

## Done when
- All acceptance commands pass
- Only owned files changed
