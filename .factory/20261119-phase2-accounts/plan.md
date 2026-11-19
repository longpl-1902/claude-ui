# Plan: Agent Console - Phase 2 (Accounts: detection, profiles, folder rules, pty launch, sign-in)

## Goal
When this run is done, the Accounts screen and the header account chip show real data. The main process
detects the Claude config dirs on this PC and reads only the email and organization name from each matching
`.claude.json`. It also scans VS Code settings for `CLAUDE_CONFIG_DIR`. Account profiles, folder rules, safety
toggles and the limit policy persist as JSON in userData. `claude` runs in a real node-pty with the right config
dir and shows in the lead console's raw xterm. The sign-in panel drives `claude auth login` in a pty and detects
completion by watching `.claude.json`. Team, agent and timeline data stay mock (Phase 3+). Nothing is written into
Claude or VS Code settings.

Requirements:
- R-01 Typed IPC contract v2: account mutations, folder resolution, launch check, sign-in (start / check / reopen / cancel, plus a status push), pty (spawn / write / resize / kill / list / buffer, plus data and exit pushes) and app (pick folder, default cwd). The preload exposes all of it. A contract test covers every channel.
- R-02 Detection: the default `~/.claude`, plus `~/.claude-*` dirs that pass the marker heuristic (`~/.claude-server-commander` is excluded). Config dirs named in VS Code user, profile and workspace settings, in Claude `~/.claude/settings.json` `env`, and in the app's own `CLAUDE_CONFIG_DIR`. The results are merged per dir with their source labels and warnings.
- R-03 Display fields: only `oauthAccount.emailAddress` and `oauthAccount.organizationName` are read, from the correct `.claude.json` path (see Verified facts 2). `signedIn` is true when emailAddress is a non-empty string. No other field leaves the parser, and parse errors never include file content.
- R-04 JSONC parser for VS Code settings: `//` and `/* */` comments, trailing commas, a BOM, and strings containing `//` are all handled. Unit tests cover these cases.
- R-05 Credential guard: every fs access in the accounts code goes through `safeFs`, which refuses any path whose basename is `.credentials.json`. The watchers ignore that file. A test greps `src/` to prove that no other code names it.
- R-06 Profile store: `<userData>/accounts.json` holds `AccountsFile` v1. Loading validates the schema, drops bad entries with warnings, falls back to defaults when the file is missing, and moves a corrupt file aside. Saving is atomic. Unit tests cover all of this.
- R-07 Folder rules: glob to account, first match wins, with an "Ask me" fallback. Supports `~`, `*`, `**`, `?` and a plain-path prefix. Matching is case-insensitive on win32 and darwin and normalizes separators. Unit tests cover it.
- R-08 Safety: `checkLaunch` blocks a different account in a folder whose running session is locked, when the lock toggle is on. It warns when a personal account opens a folder matched to a company account, when the warn toggle is on. A warned launch needs `confirmed: true`. Unit tests cover it.
- R-09 Pty: node-pty is loaded lazily (the app still runs without it). The child env has ELECTRON_RUN_AS_NODE and the inherited Claude Code session vars removed. CLAUDE_CONFIG_DIR is set to an absolute dir, and is left unset for the default account. The real `claude.exe` is resolved behind the npm `.cmd` shim. There is a ring buffer and kill-all on quit. Unit tests use a fake pty.
- R-10 Sign-in: the main process spawns `claude auth login` in a pty for the dir and watches that dir's `.claude.json` with chokidar. The sign-in is done when the file changed after start and has an email, or the process exited 0 and the file has an email. A non-zero exit without an email is an error. Check now re-reads the file. Open browser again respawns the login. Cancel kills it. Unit tests use fakes.
- R-11 The renderer store has no fake account data at first paint. It hydrates from IPC and subscribes to the pushes. The header chip shows the real active account, or "No account". Unit tests cover the store.
- R-12 Accounts screen on real data: Detected logins (Scan again, Use this, Sign in, source labels, warnings), the 3-step sign-in panel (Check now, Open browser again, Cancel, plus a terminal toggle for the paste-code fallback) and the privacy line. Account cards show plan hidden, tokens today "—", a lock badge, Set as default, Sign in again, and Rename & color with a kind field. The folder rules table has add, remove and reorder, with a fixed "Anything else -> Ask me" row. Safety toggles and the limit policy persist. Running now lists real pty sessions. Plus "+ Add account".
- R-13 Raw terminal: the lead console toggle shows a folder, the account it resolves to (or an "Ask me" picker), the safety warnings, and Start `claude`. It attaches a live, interactive xterm to the pty and keeps the session when the pane is toggled.
- R-14 No writes to Claude or VS Code settings. The only writes are to `<userData>/accounts.json`. Checked by a test with a recording fs plus review.
- R-15 Every parser and matcher has vitest tests in `tests/`. The existing 210 tests keep passing, or are updated by the task that owns the changed behaviour.

## Verified facts / spec mismatches
Checked on this PC on 2026-11-19: CLI 2.1.309 (`@anthropic-ai/claude-code`, global npm, native `bin/claude.exe`) and the VS Code extension `anthropic.claude-code-2.1.326-win32-x64`.

1. **Login command (MISMATCH).** The spec says to let the CLI run `/login` inside an interactive `claude`. Reality: there is a non-interactive subcommand `claude auth login [--claudeai|--console|--sso|--email <e>]`, plus `claude auth status [--json|--text]` and `claude auth logout`. The plan uses `claude auth login` in a pty. It opens the browser itself and has a "Paste code here" fallback, so the pty stays interactive. An interactive `claude` in a fresh dir would first show onboarding. `setup-token` (a long-lived token) is not used.
2. **Where `.claude.json` lives (MISMATCH with the naive reading of the spec).** The CLI code is `join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude' + suffix + '.json')`, where the suffix is '' for prod (`-staging-oauth`, `-local-oauth` and `-custom-oauth` exist for other environments). A legacy `<configDir>/.config.json` is also read. So:
   - default (env unset): `~/.claude.json` in home;
   - `CLAUDE_CONFIG_DIR=X`: `X/.claude.json`.
   **Trap:** `~/.claude/.claude.json` exists on this PC as an 11-key stub with no `oauthAccount`. The default account must therefore be launched with CLAUDE_CONFIG_DIR **unset** and read from `~/.claude.json`. If a VS Code setting points CLAUDE_CONFIG_DIR at `~/.claude` explicitly, that session uses the stub file, and detection shows a warning.
3. **CLAUDE_CONFIG_DIR must be absolute.** The CLI warns that the "configuration home (CLAUDE_CONFIG_DIR) is not an absolute path" and resolves relative values against three folders. We always expand `~` and pass an absolute path.
4. **`oauthAccount` fields (verified key names and types only).** `emailAddress` (string) and `organizationName` (string) exist. Other keys: accountUuid, organizationUuid, displayName, fullName, billingType, **planDisplayName**, organizationType, organizationRole, rate-limit tiers. **USER DECISION:** the spec says to show the plan "only if available", and `planDisplayName` is available. But the privacy line promises "reads only the email and organization name". The plan keeps the plan **hidden** and does not read it. Say the word to read `planDisplayName` and update the privacy line.
5. **`claude auth status --json`** prints loggedIn, authMethod, email, orgName, subscriptionType and configDirectory. It exits 1 when logged out and **writes** `.claude.json` plus `backups/` into an empty config dir. That breaks the no-writes rule, so Phase 2 does not call it. Completion is detected only by reading the file.
6. **Credentials.** They are stored in `<configDir>/.credentials.json` on Windows and Linux (present in `~/.claude`), in the macOS keychain (the service name gets a sha256(configDir) suffix when CLAUDE_CONFIG_DIR is set), or in Windows Credential Manager when `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`. We never open, stat or watch any of them. `.credentials.json` is not used as a detection marker.
7. **`~/.claude-*` dirs on this PC.** Only `~/.claude-server-commander` exists (config.json, feature-flags.json, tool-history.jsonl, a .log, *.tmp), and it is not a Claude dir. **Marker heuristic:** a dir counts when it contains `.claude.json`, or ≥2 of {settings.json, projects/, history.jsonl, sessions/, todos/, statsig/, shell-snapshots/, file-history/, plugins/, ide/}. The check uses names from `readdir` only.
8. **VS Code setting (MISMATCH).** The setting is `claudeCode.environmentVariables`: an array of `{ "name": string, "value": string }` with **scope "machine"**. VS Code ignores machine-scoped settings in workspace `.vscode/settings.json` and in `.code-workspace` files. So the spec's "found in `.vscode/settings.json`" source has no effect in VS Code. We still scan it and label it "ignored by VS Code (machine-scoped setting)". The extension also migrates a legacy global key `claude-code.environmentVariables`, which we read too. The extension's own description says "Prefer setting environment variables in Claude's settings.json", so we also scan `env.CLAUDE_CONFIG_DIR` in `~/.claude/settings.json`.
9. **VS Code paths (Windows).** User settings live in `%APPDATA%/Code/User/settings.json` (present, 248 B, no claudeCode env set today) and in `%APPDATA%/Code/User/profiles/*/settings.json` (none today). Insiders uses `Code - Insiders`. Known workspaces come from `%APPDATA%/Code/User/globalStorage/storage.json`: `profileAssociations.workspaces` keys (24 `file:///d%3A/...` URIs) and `backupWorkspaces.folders[].folderUri` / `.workspaces[].configURIPath`. The files are JSONC, so the plan uses a hand-written tolerant parser and adds no dependency.
10. **node-pty (MISMATCH with "run `npm run rebuild:pty` first").** node-pty 1.1.0 ships N-API prebuilds (`prebuilds/win32-x64/{pty,conpty}.node` plus `conpty/`). They load and spawn under Electron 45's runtime with no rebuild (verified with a ConPTY spawn under `ELECTRON_RUN_AS_NODE=1 electron.exe`). `npm run rebuild:pty` **fails** with the known winpty `GetCommitHash.bat` gyp error, and it deleted `node_modules/node-pty/build/Release/conpty`. That is harmless, because the prebuild is used, and `npm ci` restores it. Plan: do not run rebuild. Add `npm run check:pty` (a smoke spawn), set electron-builder `npmRebuild: false`, and keep `asarUnpack` for node-pty.
11. **electron-vite 6 externalizes only `dependencies`, not `optionalDependencies`.** Without changes, node-pty would be bundled and break. T01 adds `build.externalizeDeps: { include: ['node-pty'] }` to the main config. Main loads node-pty lazily inside a try/catch.
12. **The `claude` command on Windows** is the npm shim `claude.cmd` (plus an sh script) in `%APPDATA%/npm`. The real binary is `%APPDATA%/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`. The native installer path is `~/.local/bin/claude.exe`. The resolver prefers a real `.exe` and falls back to `cmd.exe /d /s /c <shim>`.
13. **Inherited Claude Code session env (NEW).** When Agent Console is started from a Claude Code or VS Code session (typical in dev), it inherits these vars: `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PID`, `CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_CODE_EMIT_STARTUP_TIMING`, `CLAUDE_CODE_STARTUP_FAILURE_RESULTS`, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`, `CLAUDE_CODE_QUESTION_PREVIEW_FORMAT`, `CLAUDE_CODE_ENABLE_TASKS`, `MCP_CONNECTION_NONBLOCKING` and `ELECTRON_RUN_AS_NODE`. The child env strips this exact denylist. User-level vars such as `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and `ANTHROPIC_*` are kept.
14. **Usage and plan.** There is no usage source in Phase 2, so "Tokens used today" shows "—". There are no fake percentages.

## Stack
Unchanged from Phase 1: Electron 45, electron-vite 6, React 18.3, TS strict, Zustand 5, @xterm/xterm 6 + addon-fit, chokidar 4, node-pty 1.1.0 (optional, prebuilt), vitest 5, testing-library.
**No new dependencies.** JSONC parsing and glob matching are hand-written and tested.
Commands: test `npm test` (single file: `npm test -- tests/x.test.ts`), lint/typecheck `npm run typecheck`, build `npm run build`, new `npm run check:pty`.

## Architecture
- **shared (pure)**: `types.ts` and `ipc.ts` (contract v2, T01). `accountsDefaults.ts` (DEFAULT_SAFETY, EMPTY_ACCOUNTS_SNAPSHOT, ACCOUNT_COLORS, T01). `folderRules.ts` (`globToRegExp`, `matchFolder`) and `safety.ts` (`checkLaunch`), both T03 and used by main and renderer.
- **Main internal interfaces**, written out in T01 Notes so the parallel main tasks agree without talking. They are owned where they are first needed. T02 owns `src/main/contracts.ts` (`ReadFs`, `WriteFs`, `HostEnv`, `DisplayFields`). T04 owns `src/main/pty/types.ts` (`PtyManagerApi`). T07 owns `WatchFile`, which lives in `signIn.ts`.
- **main/accounts**: `safeFs.ts` (credential guard and node fs adapter), `paths.ts`, `jsonc.ts`, `claudeJson.ts` and `vscodeSettings.ts` (T02). `detect.ts` and `profileStore.ts` (T05). `signIn.ts` and `accountsService.ts` (T07). The service composes the store, detection, display fields, the pty manager and the sign-in controller, and emits `changed`.
- **main/pty**: `claudeBinary.ts`, `childEnv.ts` and `ptyManager.ts` (T04). Data flows main to renderer through `pty:data` pushes. The renderer cannot choose the command; it can only ask for `claude` in a folder for an account.
- **main/ipc/handlers.ts** and **main/index.ts** (T07): `createHandlers(deps)` with real services (still a plain object for tests). index.ts builds the real deps (userData path, nodeFs, chokidar watcher, electron `dialog`) and forwards the pushes to `webContents.send`.
- **renderer**: the store (T06) starts with EMPTY_ACCOUNTS_SNAPSHOT. App subscribes to `accounts:changed` and `accounts:sign-in-status`. `components/terminal/TerminalView.tsx` (T08; T01 ships the stub) binds xterm to a ptyId. RawTerminalPane (T08). Accounts components are split between T09 (Detected logins and sign-in) and T10 (cards, rules, policies, running now, add account).
- Data rule: the only file the app writes is `<userData>/accounts.json` (plus a `.tmp` and a `.corrupt-<ts>` copy). Claude and VS Code files are read-only.

## File tree
```
package.json (scripts only), electron.vite.config.ts, electron-builder.yml, scripts/check-pty.mjs        T01
src/shared/types.ts, src/shared/ipc.ts, src/shared/accountsDefaults.ts                                  T01
src/preload/index.ts                                                                                    T01
src/main/ipc/handlers.ts                                                                                T01 (stubs) -> T07 (real)
src/renderer/src/components/terminal/TerminalView.tsx                                                   T01 (stub) -> T08 (real)
tests/shared/ipcContract.test.ts, tests/main/ipcHandlers.test.ts                                        T01 -> ipcHandlers T07
src/main/contracts.ts (ReadFs/WriteFs/HostEnv/DisplayFields)                                           T02
src/main/accounts/{safeFs,paths,jsonc,claudeJson,vscodeSettings}.ts                                     T02
tests/main/accounts/{safeFs,paths,jsonc,claudeJson,vscodeSettings}.test.ts, memoryFs.ts (helper),
tests/main/noCredentials.test.ts                                                                         T02
src/main/pty/types.ts (PtyManagerApi)                                                                   T04
src/shared/folderRules.ts, src/shared/safety.ts, tests/shared/{folderRules,safety}.test.ts               T03
src/main/pty/{claudeBinary,childEnv,ptyManager}.ts, tests/main/pty/{claudeBinary,childEnv,ptyManager}.test.ts  T04
src/main/accounts/{detect,profileStore}.ts, tests/main/accounts/{detect,profileStore}.test.ts            T05
src/renderer/src/store/useConsoleStore.ts, src/renderer/src/App.tsx, components/team/TeamHeader.tsx      T06
tests/renderer/seedAccounts.ts (new), tests/renderer/{store.test.ts,app.test.tsx,teamSections.test.tsx}  T06
tests/renderer/{accountsView,teamView,teamCenter,inspector}.test.tsx (beforeEach seed line only)        T06
src/main/accounts/{signIn,accountsService}.ts, src/main/index.ts                                        T07
tests/main/accounts/{signIn,accountsService}.test.ts, tests/main/ipcHandlers.test.ts                    T07
src/renderer/src/components/terminal/{TerminalView.tsx,terminal.css}                                    T08
src/renderer/src/components/team/RawTerminalPane.tsx, tests/renderer/terminal.test.tsx                  T08
tests/renderer/teamCenter.test.tsx (raw-terminal cases only)                                            T08
src/renderer/src/components/accounts/{DetectedLogins.tsx,SignInPanel.tsx,signIn.css}                    T09
tests/renderer/accountsView.test.tsx (rewritten: static + detected + sign-in)                          T09
src/renderer/src/components/accounts/{AccountCards,FolderRules,AccountPolicies,RunningNow,AccountEditor}.tsx, manage.css  T10
tests/renderer/accountsManage.test.tsx                                                                  T10
```

## Waves
| Wave | Tasks | Why this order |
|---|---|---|
| 1 | T01, T02, T03 | T01 is the single owner of the contract, preload, config, handler stubs and the TerminalView stub. T02 (main parsers plus `contracts.ts`) and T03 (shared rule and safety logic) are pure and import nothing that T01 adds. |
| 2 | T04, T05, T06 | The pty layer needs the contracts from T01. Detection and the profile store need the T02 parsers and the T01 types. The renderer store needs the T01 api types. All three own disjoint files. |
| 3 | T07, T08, T09 | The main service and IPC wiring need T02-T05. TerminalView and RawTerminalPane need the T06 store. Detected logins and sign-in need the T06 store and the TerminalView stub contract. |
| 4 | T10 | Cards, rules, policies and running now. T10 is last because T09 rewrites accountsView.test.tsx in wave 3, removing the card and policy cases that T10 re-adds in accountsManage.test.tsx. |

## Acceptance map
| Criterion | Task(s) | Test file |
|---|---|---|
| R-01 | T01, T07 | tests/shared/ipcContract.test.ts, tests/main/ipcHandlers.test.ts |
| R-02 | T02, T05 | tests/main/accounts/vscodeSettings.test.ts, tests/main/accounts/detect.test.ts |
| R-03 | T02 | tests/main/accounts/claudeJson.test.ts, tests/main/accounts/paths.test.ts |
| R-04 | T02 | tests/main/accounts/jsonc.test.ts |
| R-05 | T02 | tests/main/accounts/safeFs.test.ts, tests/main/noCredentials.test.ts |
| R-06 | T05 | tests/main/accounts/profileStore.test.ts |
| R-07 | T03 | tests/shared/folderRules.test.ts |
| R-08 | T03, T07 | tests/shared/safety.test.ts, tests/main/accounts/accountsService.test.ts |
| R-09 | T01, T04 | tests/main/pty/{claudeBinary,childEnv,ptyManager}.test.ts; `npm run check:pty` |
| R-10 | T07 | tests/main/accounts/signIn.test.ts; manual real sign-in (see Test strategy) |
| R-11 | T06 | tests/renderer/store.test.ts, tests/renderer/app.test.tsx, tests/renderer/teamSections.test.tsx |
| R-12 | T09, T10 | tests/renderer/accountsView.test.tsx, tests/renderer/accountsManage.test.tsx |
| R-13 | T08 | tests/renderer/terminal.test.tsx, tests/renderer/teamCenter.test.tsx |
| R-14 | T05, T07 | profileStore.test.ts + accountsService.test.ts (recording fs: writes only under the userData dir); manual review |
| R-15 | all | `npm test` |

## Test strategy
- Automatic: all pure modules (jsonc, paths, claudeJson, vscodeSettings, detect, profileStore, folderRules, safety, claudeBinary, childEnv) are tested with an in-memory `ReadFs` / `WriteFs` and an injected `HostEnv` (the home dir is a fake like `C:/Users/u`, on both win32 and posix variants). ptyManager, signIn and accountsService are tested with a fake pty module and a fake watcher. The renderer uses a mocked `window.api`, xterm is mocked as in Phase 1, and no xterm is ever mounted for real in jsdom.
- Fixture rule: test fixtures may contain fake `oauthAccount` siblings such as `"accessToken": "FAKE"` to prove they never leak. No test reads a real home dir.
- Manual (the orchestrator does this after wave 4, on this PC): (1) `npm run check:pty`. (2) `npm run dev`. Accounts shows `~/.claude` with the real email and org from `~/.claude.json`, and `~/.claude-server-commander` is absent. (3) Add a `~/.claude-personal` account, then Sign in. The browser opens and you finish the login. The panel reaches "Ready" without Check now, and Check now also works. (4) Raw terminal, then Start claude in a folder. The session is interactive, and toggling the pane keeps it. (5) Confirm that `%APPDATA%/Code/User/settings.json` and `~/.claude/settings.json` are unchanged (mtime).

## Risks
- **`claude auth login` behaviour in a pty is unverified** (we did not run a real login). Early check: in T07's manual step, spawn it with a scratch CLAUDE_CONFIG_DIR and watch for the browser and the "Paste code" prompt. Fallback: the panel shows the terminal, and the user can run `claude` then `/login` in the raw terminal.
- **The CLI may write `.claude.json` before login finishes** (for example firstStartTime), which would make "file changed" fire too early. Mitigation: `done` needs a non-empty `emailAddress`, not only a change, and the T07 tests cover a change without an email.
- **node-pty in the Electron main process** (not ELECTRON_RUN_AS_NODE) plus bundling. Early check: T01 runs `check:pty`. T07 greps `out/main` to confirm node-pty is required as an external and not inlined, then runs `npm run dev` and opens one pty.
- **Windows env key casing** (`Path` vs `PATH`, deleting vars case-insensitively). Covered by the T04 childEnv tests.
- **Store seed change breaks Phase 1 renderer tests.** T06 owns the seed-helper edits in every affected test file and must finish with the full `npm test` green.
- **chokidar on a single file that may not exist yet**, with atomic rename writes. T07 watches the parent dir at depth 0, filters by basename, and ignores `.credentials.json`. Tests use a fake watcher. The manual sign-in check verifies it for real.

## Assumptions and spec gaps
- ASSUMPTION (rule storage): one ordered global `rules` list in `accounts.json` is the source of truth, because first-match-wins needs a global order. `AccountProfile.folderRules` in the snapshot is derived from that list. The fallback "Anything else -> Ask me" is implicit and never stored.
- ASSUMPTION (account kind): the spec's "personal" / "company" warning needs a kind, so profiles get an optional `kind: 'company' | 'personal'`. It is set in Rename & color or Add account. With no kind set, the account gets no warning.
- ASSUMPTION (lock): "Team session" in Phase 2 means a running `claude` pty. When locked, a different account cannot start in the same folder tree while that session runs. The card shows "In use". Sign in again is disabled for a locked account.
- ASSUMPTION (plain path rule): a pattern without glob characters matches that folder and everything below it.
- ASSUMPTION ("Use this"): it creates a profile for the detected dir (name from the org or "Account N", next palette color, no kind) and links it. The user then edits the name, color and kind.
- ASSUMPTION (default cwd for the raw terminal): `INIT_CWD || process.cwd()` in dev and the home dir when packaged. Changed with "Change…" (an electron dialog).
- Limit policy "Switch account only for personal folders": stored and shown with a note only. It is enforced in Phase 3+, when usage data exists.

## Later
- Phase 3: transcripts give tokens today per account. Read `planDisplayName` if the user agrees.
- Phase 6: packaging check with `npmRebuild: false` plus node-pty prebuilds in asarUnpack. VS Code Insiders, VSCodium and Cursor settings paths beyond `Code` and `Code - Insiders`.

## User decisions (plan gate, 2026-11-19)
- Plan approved as written.
- planDisplayName: HIDDEN. Read only emailAddress + organizationName; privacy line unchanged.
- Workspace `.vscode/settings.json` CLAUDE_CONFIG_DIR findings: SHOW with a warning that VS Code ignores this machine-scoped setting at workspace level.
