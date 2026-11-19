# T07 - Accounts service, sign-in controller, real IPC handlers, main wiring

- Wave: 3
- Depends on: T01, T02, T03, T04, T05
- Spec refs: R-01, R-08, R-10, R-14; spec "Accounts → Sign in", "Account safety"; Hard rules 1-3
- Tests: tests/main/accounts/signIn.test.ts, tests/main/accounts/accountsService.test.ts, tests/main/ipcHandlers.test.ts

## Goal
Compose detection, the profile store, folder rules, safety and the pty manager into one accounts service.
Implement the sign-in controller (`claude auth login` in a pty, a chokidar watch on `.claude.json`). Replace the
Phase 1 and T01 stub handlers with real ones. Wire everything in `src/main/index.ts`, with pushes to the renderer.

## Owned files
- create: src/main/accounts/signIn.ts
- create: src/main/accounts/accountsService.ts
- modify: src/main/ipc/handlers.ts
- modify: src/main/index.ts
- create: tests/main/accounts/signIn.test.ts
- create: tests/main/accounts/accountsService.test.ts
- modify: tests/main/ipcHandlers.test.ts

## Read-only context
- src/main/contracts.ts, src/main/accounts/*.ts (T02, T05), src/main/pty/*.ts (T04)
- src/shared/{types,ipc,accountsDefaults,folderRules,safety}.ts
- tests/main/accounts/memoryFs.ts
- plan.md Verified facts 1, 2, 5, 6

## Notes
### signIn.ts
```ts
export interface FileWatcher { close(): void }
export type WatchFile = (absFile: string, onChange: () => void) => FileWatcher
export function createChokidarWatchFile(): WatchFile   // real impl (see below)
export interface SignInController {
  start(configDir: string): Promise<OkResult>; check(configDir: string): Promise<SignInStatus>
  reopen(configDir: string): Promise<OkResult>; cancel(configDir: string): Promise<OkResult>
  status(configDir: string): SignInStatus; onStatus(cb: (s: SignInStatus) => void): () => void; disposeAll(): void
}
export function createSignInController(deps: { pty: PtyManagerApi; fs: ReadFs; host: HostEnv; watchFile: WatchFile }): SignInController
```
- `start(dir)`: `dir` is the display form from the renderer. Resolve it with `expandHome`. It must be absolute (else `{ok:false, reason:'invalid-folder'}`). `configDirAbs = isDefaultConfigDir ? null : abs`. If a login for the dir is already active, return ok. Record a baseline (`mtimeMs` of `claudeJsonPathFor`, plus the display fields). Spawn `pty.spawnClaude({ purpose: 'login', cwd: host.home, configDirAbs, configDirDisplay: dir, args: ['auth', 'login'] })`. On failure → step `error` with the reason. Otherwise watch `claudeJsonPathFor(...)` and set step `waiting` with the ptyId.
- Evaluate on a watcher change, on pty exit and in `check()`: read the display fields. **done** when the email is non-empty AND (the file mtime > baseline mtime OR the pty exited with 0 OR the baseline had no email). An exit ≠ 0 without done → `error`, `reason: 'login-exited'`. Keep the pty alive after done (the CLI exits by itself). Close the watcher on done, error or cancel. Emit `onStatus` on every step change.
- `reopen` = kill the current pty, then start again (a new browser tab with a fresh PKCE flow).
- `cancel` kills the pty, closes the watcher and sets step `none`.
- Do not mkdir the config dir. The CLI creates it (manual check below). Never run `claude auth status` (Verified facts 5).
- `createChokidarWatchFile`: `chokidar.watch(dirname(file), { depth: 0, ignoreInitial: true, atomic: true, ignored: (p) => isDeniedPath(p) || (p !== dir && basename(p) !== basename(file)) })` → on `add`/`change` with the matching basename, call onChange. If the dir does not exist yet, watch its parent with depth 1 filtered to the same file path. Use `isDeniedPath` from safeFs (no new spelling of the credentials file name, because noCredentials.test enforces it).

### accountsService.ts
```ts
export interface AccountsService {
  snapshot(): Promise<AccountsSnapshot>; scan(): Promise<AccountsSnapshot>
  linkDetected(r: LinkDetectedRequest): Promise<OkWithId>; saveProfile(p: ProfileInput): Promise<OkWithId>; removeProfile(id: string): Promise<OkResult>
  setDefault(id: string): Promise<OkResult>; setRules(r: FolderRule[]): Promise<OkResult>; setSafety(s: SafetySettings): Promise<OkResult>; setLimitPolicy(p: LimitPolicy): Promise<OkResult>
  resolveFolder(folder: string): Promise<FolderResolution>; checkLaunch(folder: string, accountId: string): Promise<LaunchCheck>
  launchClaude(req: PtySpawnRequest): Promise<PtySpawnResult>
  signIn: SignInController; onChanged(cb: (s: AccountsSnapshot) => void): () => void
}
export function createAccountsService(deps: { fs: WriteFs; host: HostEnv; userDataDir: string; pty: PtyManagerApi; watchFile: WatchFile; claudeFound: () => boolean }): AccountsService
```
- Lazy-load the AccountsFile on first use. Cache the last `detectLogins` result. `scan()` re-runs it, passing the static prefixes of the rule patterns as `extraWorkspaceFolders`: the part before the first glob char, expanded, only when absolute.
- `snapshot()`: `accounts` = profiles plus display fields (from detection, or `readDisplayFields` for a profile dir not in detection). `signedIn` comes from the display fields. `plan`/`tokensToday` stay undefined (Verified facts 4, 14). `locked` = lock toggle on and a running `claude` pty for this account. `isDefaultDir` is set too. `detected` = `toDetectedLogin` for each dir. `rules` = the stored list. `activeAccountId` = the account of the newest running claude pty, else defaultAccountId, else ''. `sessions` = the running `claude` ptys (`teamName` = basename of cwd, `agentCount: 1`, `path` in display form, `ptyId`). `ptyAvailable` = `await pty.available()`. `claudeFound` = `deps.claudeFound()`.
- Mutations validate their input, save through profileStore, and then emit `changed` with a fresh snapshot. `linkDetected`: when `accountId` is given, set that profile's configDir. Otherwise create a profile (name = the org, or `Account N`, the next ACCOUNT_COLORS entry, `makeProfileId`). The first profile becomes the default. `removeProfile` also removes its rules and clears the default if needed. `setRules` drops rules for unknown accounts and fallback patterns.
- `checkLaunch`: build `checkLaunch` from @shared/safety with `match = { home, caseInsensitive: platform !== 'linux' }`, the profiles, the stored rules and safety, and the running claude ptys as sessions (display→abs paths).
- `launchClaude(req)`: validate that cwd is an absolute existing dir (`fs.exists`), else `invalid-folder`. Run checkLaunch: not allowed → `{ok:false, reason: blockedReason}`. Warnings without `req.confirmed` → `{ok:false, reason:'needs-confirmation', warnings}`. Then `pty.spawnClaude({ purpose: 'claude', cwd, configDirAbs, configDirDisplay, accountId, cols, rows })`, map the outcome, and emit `changed`. Also emit `changed` on any pty exit (sessions and locks update).
- **Writes:** only `saveAccountsFile` into `userDataDir`. Test this with the memoryFs `writes`.

### handlers.ts
`createHandlers(deps: { version?: string; accounts?: AccountsService; pty?: PtyManagerApi; pickFolder?: () => Promise<string | null>; defaultCwd?: () => string })`.
With no `accounts` dep, keep the mock behaviour so that the Phase 1 tests can still construct handlers without deps. With deps: every `accounts:*` handler delegates (sign-in → `accounts.signIn.*`). `pty:spawn` → `accounts.launchClaude`. `pty:write/resize/kill/list/get-buffer` → pty. `app:pick-folder` / `app:get-default-cwd` → deps. Validate argument shapes: strings, finite positive ints for cols/rows (clamp 20..500 / 5..200), an object shape for requests, and a `data` string ≤ 64 KiB. Return `invalid-args` on a mismatch. Renderer input never chooses a command or arguments.

### index.ts
Build `host = { home: os.homedir(), platform: process.platform, env: process.env, appData: process.env.APPDATA }`, `fs = safeNodeFs`, `pty = createPtyManager({ loadPty: loadNodePty, resolveClaude: () => resolveClaudeCommand({..., exists: existsSync}), baseEnv: process.env, platform })`, and `accounts = createAccountsService({ ..., userDataDir: app.getPath('userData'), watchFile: createChokidarWatchFile() })`. Forward `accounts.onChanged` → `IPC.accountsChanged`, `signIn.onStatus` → `IPC.accountsSignInStatus`, `pty.onData` → `IPC.ptyData` and `pty.onExit` → `IPC.ptyExit`, all to every live window's `webContents.send`. Coalesce `pty:data` per id within one 16 ms tick. `pickFolder` = `dialog.showOpenDialog(win, { properties: ['openDirectory'] })`. `defaultCwd` = `app.isPackaged ? home : (process.env.INIT_CWD ?? process.cwd())`. On `before-quit` → `pty.disposeAll(); accounts.signIn.disposeAll()`. Keep all the Phase 1 window security settings unchanged.

### Tests
- signIn (fake pty, fake watchFile you trigger by hand, memoryFs whose file content and mtime you mutate): start spawns `['auth','login']` with configDirAbs (null for `~/.claude`). A change that has no email stays waiting. A change that has an email → done, emitted once, watcher closed. A dir already signed in at baseline → done only after an mtime bump or exit 0. Exit 1 → error. check() re-reads. reopen kills and respawns. cancel. A relative dir → invalid-folder. pty-unavailable → error.
- accountsService: snapshot from fixtures (an email shown, no plan, tokensToday undefined). linkDetected creates a profile and sets the default. saveProfile/removeProfile cascade. setRules filtering. checkLaunch cases are delegated. launchClaude: invalid folder, locked, needs-confirmation then confirmed → spawned with the right configDirAbs. A session appears in the snapshot and locks the account. The changed event is emitted. Writes are only under userDataDir.
- ipcHandlers: the Phase 1 mock-mode cases still pass. Delegation for each new channel with a fake service. invalid-args for bad shapes. cols/rows clamping. Oversized write data rejected.

### Manual checks (record the results in your report)
1. `npm run dev`. The Accounts snapshot over IPC shows `~/.claude` with the real email (do not paste the email into the report: write "email present: yes").
2. Start a sign-in for a scratch dir under the scratchpad/temp (not the home dir), check that the browser opens and that the pty shows the URL or a paste-code prompt, then Cancel. Confirm whether the CLI created the dir.

## Acceptance commands
- npm test
- npm run typecheck
- npm run build
- grep -lE "require\(\"node-pty\"\)|import\(\"node-pty\"\)" out/main/*.js   (node-pty stays external; and `grep -L conpty_console_list out/main/*.js` shows it is not inlined)
- npm run check:pty

## Done when
- All acceptance commands pass
- Only owned files changed
