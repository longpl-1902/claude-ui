# T05 - Config dir detection and profile store

- Wave: 2
- Depends on: T01 (types: DetectedLogin fields, AccountsFile, AccountProfile.kind; accountsDefaults), T02 (contracts, safeFs, paths, claudeJson, vscodeSettings, jsonc, memoryFs helper), T03 (isFallbackPattern)
- Spec refs: R-02, R-06, R-14; plan Verified facts 2, 7, 8
- Tests: tests/main/accounts/detect.test.ts, tests/main/accounts/profileStore.test.ts

## Goal
`detectLogins` finds every Claude config dir that is relevant on this PC, with sources and warnings, plus the
display fields for each. `profileStore` loads and saves `AccountsFile` in userData with validation and an
atomic write. Both are pure over the injected `ReadFs` / `WriteFs` / `HostEnv`.

## Owned files
- create: src/main/accounts/detect.ts
- create: src/main/accounts/profileStore.ts
- create: tests/main/accounts/detect.test.ts
- create: tests/main/accounts/profileStore.test.ts

## Read-only context
- src/main/contracts.ts, src/main/accounts/{paths,claudeJson,vscodeSettings,jsonc,safeFs}.ts (T02)
- tests/main/accounts/memoryFs.ts (T02)
- src/shared/types.ts, src/shared/accountsDefaults.ts (T01)
- plan.md Verified facts 2, 7, 8

## Notes
### detect.ts
```ts
export const CONFIG_DIR_MARKERS = ['settings.json','projects','history.jsonl','sessions','todos','statsig','shell-snapshots','file-history','plugins','ide'] as const
export function looksLikeClaudeConfigDir(entryNames: readonly string[]): boolean   // has '.claude.json' OR >= 2 markers
export interface DetectedDir {
  configDir: string        // display form (~/...)
  absPath: string
  isDefaultDir: boolean
  exists: boolean
  display: DisplayFields
  sources: string[]        // human labels, ordered, deduped
  warnings: string[]
}
export async function detectLogins(fs: ReadFs, host: HostEnv, opts?: { extraWorkspaceFolders?: string[] }): Promise<DetectedDir[]>
export function toDetectedLogin(d: DetectedDir, profiles: readonly AccountProfile[], home: string, platform: NodeJS.Platform): DetectedLogin   // links via samePath(profile.configDir, d.configDir)
```
Algorithm (all reads go through the given fs; the caller passes `safeNodeFs`):
1. Default: include `~/.claude` when the `~/.claude` dir or `~/.claude.json` exists. Sources: `'Claude Code CLI (default folder)'`, plus `'VS Code extension'` when `scanVscode` reports the extension installed and no *user*-scope finding overrides CLAUDE_CONFIG_DIR.
2. `readdir(home)`: each directory named `.claude-<something>` with `looksLikeClaudeConfigDir(readdir(dir) names)` → source `'Claude Code CLI (~/.claude-<x>)'`. Non-matching dirs (e.g. `.claude-server-commander`) are skipped silently. Note: `.credentials.json` is **not** a marker. Only use names; never open entries.
3. `scanVscode(fs, host, { extraFolders })` findings. Expand the value (`expandHome`). Source labels: user → `'VS Code user settings'`, user-profile → `'VS Code profile settings'`, workspace → `` `.vscode/settings.json in ${display(folder)}` ``, workspace-file → `` `${basename}.code-workspace` ``. When `ignoredByVsCode` is set, add the warning `'Set in workspace settings - VS Code ignores this machine-scoped setting there'`. Include the dir even if it does not exist (`exists: false`).
4. `~/.claude/settings.json` → `extractClaudeSettingsEnvDir` → source `'Claude settings env (~/.claude/settings.json)'`.
5. `host.env.CLAUDE_CONFIG_DIR` → source `'CLAUDE_CONFIG_DIR environment variable'`.
6. For each value: when it is not absolute after expansion, add the warning `'Not an absolute path - Claude Code resolves it relative to the current folder'` and keep the raw value as configDir. When an explicit source (3-5) points at the default `~/.claude`, add the warning `'CLAUDE_CONFIG_DIR points at ~/.claude, so Claude reads ~/.claude/.claude.json instead of ~/.claude.json'`.
7. Merge entries by `samePath`. Sources are concatenated. Display fields come from `readDisplayFields(fs, dir, home, platform)`, which does the default-dir special case.
8. Order: default first, then the rest alphabetically by configDir.

### profileStore.ts
```ts
export const ACCOUNTS_FILE_NAME = 'accounts.json'
export interface LoadResult { data: AccountsFile; warnings: string[]; recoveredFrom?: string }
export function validateAccountsFile(raw: unknown): { data: AccountsFile; warnings: string[] }
export async function loadAccountsFile(fs: WriteFs, dir: string, now?: () => Date): Promise<LoadResult>
export async function saveAccountsFile(fs: WriteFs, dir: string, data: AccountsFile): Promise<void>
export function makeProfileId(name: string, taken: readonly string[]): string   // slug [a-z0-9-], 'account' if empty, '-2', '-3' on clash
```
- Validation: `version` must be 1 (otherwise warn and use defaults). Profiles need a non-empty unique `id`, a `name` (trimmed, max 40), a `color` matching `/^#[0-9a-f]{6}$/i` (else the next ACCOUNT_COLORS entry), a non-empty `configDir`, and an optional `kind` in {company, personal}. Invalid profiles are dropped with a warning. Rules need a non-empty string `pattern`, an `accountId` that is an existing profile id or `'ask'`, and a `note` string. Fallback-pattern rules (`isFallbackPattern` from @shared/folderRules, T03) are dropped. `defaultAccountId` must be an existing id, else null. Each safety key must be a boolean, else the default. limitPolicy must be in {pause, wait, switch}, else 'pause'. `profile.folderRules` on load is re-derived from `rules` (`rules.filter(r => r.accountId === p.id)`).
- Load: a missing file returns `emptyAccountsFile()`. Unparsable JSON → rename to `accounts.json.corrupt-<yyyyMMdd-HHmmss>`, return defaults and `recoveredFrom`.
- Save: `mkdir(dir)`, write `accounts.json.tmp`, then `rename` over `accounts.json`. Pretty JSON (2 spaces). Write the derived `folderRules` into each profile for readability.
- The store writes ONLY inside `dir`. Test this with the memoryFs `writes` record.

### Tests (memoryFs; fake home `C:/Users/u`, platform win32; one posix case)
detect: default dir with `~/.claude.json` holding an email, plus the stub `~/.claude/.claude.json` with no email → shows the email from the home file. `.claude-server-commander` (config.json, feature-flags.json, tool-history.jsonl) excluded. `.claude-personal` with `settings.json` + `projects/` included and not signed in. A dir with only `.claude.json` included. VS Code user finding for a nonexistent dir → exists false, plus its source label. Workspace finding → warning. The env var source. A relative value warning. The explicit-default warning. Merging the same dir from two sources (case and slash differences). toDetectedLogin links a profile. Assert that no read path ends with the denied basename (wrap memoryFs in createSafeFs).
profileStore: missing → defaults. Round-trip. Each validation rule. Corrupt → renamed and defaults. Atomic write order (tmp then rename). Writes stay under dir. makeProfileId clashes.

## Acceptance commands
- npm test -- tests/main/accounts/detect.test.ts tests/main/accounts/profileStore.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
