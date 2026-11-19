# T02 - Main parsers: credential guard, paths, JSONC, .claude.json display fields, VS Code settings

- Wave: 1
- Depends on: none (T02 creates `src/main/contracts.ts` itself; it must not import `@shared` types that T01 adds)
- Spec refs: R-02, R-03, R-04, R-05; plan Verified facts 2, 3, 4, 6, 8, 9
- Tests: tests/main/accounts/{safeFs,paths,jsonc,claudeJson,vscodeSettings}.test.ts, tests/main/noCredentials.test.ts

## Goal
Pure, injectable building blocks for account detection. Nothing here touches the real home dir in tests,
and nothing can ever open a credentials file.

## Owned files
- create: src/main/contracts.ts
- create: src/main/accounts/safeFs.ts
- create: src/main/accounts/paths.ts
- create: src/main/accounts/jsonc.ts
- create: src/main/accounts/claudeJson.ts
- create: src/main/accounts/vscodeSettings.ts
- create: tests/main/accounts/safeFs.test.ts
- create: tests/main/accounts/paths.test.ts
- create: tests/main/accounts/jsonc.test.ts
- create: tests/main/accounts/claudeJson.test.ts
- create: tests/main/accounts/vscodeSettings.test.ts
- create: tests/main/noCredentials.test.ts
- create: tests/main/accounts/memoryFs.ts (test helper)

## Read-only context
- .factory/20261119-phase2-accounts/plan.md (Verified facts)
- .factory/20261119-phase2-accounts/tasks/T01-contract-config.md (contracts.ts shapes)

## Notes
### src/main/contracts.ts (types only; exact text)
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
```
Also provide `export function createMemoryFs(files: Record<string, string>, dirs?: string[]): WriteFs` in
`tests/main/accounts/memoryFs.ts` (test helper, owned here; T05/T07 reuse it). Paths compared after `\`→`/`;
`readdir` derives entries from the file/dir keys; records writes in `memoryFs.writes: string[]`.

### safeFs.ts
- `export const DENIED_BASENAMES = ['.credentials.json'] as const` - the ONLY place in src/ allowed to spell this name.
- `export class CredentialAccessError extends Error {}`
- `export function isDeniedPath(p: string): boolean` - basename, case-insensitive, both separators.
- `export function createSafeFs(inner: WriteFs): WriteFs` - every method throws/rejects `CredentialAccessError` for a denied path (readdir itself is allowed; it only returns names).
- `export const nodeFs: WriteFs` - adapter over `node:fs/promises` (`readFile` utf8, `readdir` withFileTypes, `exists` via `access`, `mtimeMs` via `stat` → null on ENOENT, `mkdir` recursive).
- `export const safeNodeFs = createSafeFs(nodeFs)`.

### paths.ts (pure; pass `home` and `platform` in)
- `expandHome(p, home)`: `~`, `~/x`, `~\x`, `$HOME/x`, `%USERPROFILE%\x` (case-insensitive) → absolute; others unchanged.
- `toDisplayPath(abs, home, platform)`: forward slashes; under home → `~/...`; home itself → `~`.
- `normalizeForCompare(p, platform)`: forward slashes, collapse `//`, drop trailing `/`, lowercase on win32 and darwin.
- `samePath(a, b, home, platform)`.
- `isAbsoluteFor(p, platform)` (win32: `C:/`, `C:\`, UNC).
- `isDefaultConfigDir(dir, home, platform)`: same as `<home>/.claude`.
- `claudeJsonPathFor(dir, home, platform)`: default dir → `<home>/.claude.json`; else `<abs dir>/.claude.json`. `legacyConfigJsonPathFor(dir, ...)` → `<abs dir>/.config.json` (also `<home>/.claude/.config.json` for default).
- `vscodeUserDirs(host)`: win32 `<appData>/Code/User`, `<appData>/Code - Insiders/User` (appData = host.appData ?? env.APPDATA ?? `<home>/AppData/Roaming`); darwin `~/Library/Application Support/{Code,Code - Insiders}/User`; linux `${XDG_CONFIG_HOME ?? ~/.config}/{Code,Code - Insiders}/User`.
- `fileUriToPath(uri, platform)`: `file:///d%3A/learn/x` → `d:/learn/x` (win32 drops the leading slash); non-`file:` schemes → null.
Join with `path.posix`/`path.win32` according to `platform` (tests run both).

### jsonc.ts
`export function parseJsonc(text: string): unknown` - strip BOM, `//` line and `/* */` block comments outside strings (respect `\"` escapes), remove trailing commas before `}`/`]`, then `JSON.parse`. On failure throw `new JsoncError('Invalid JSONC')` with NO slice of the input in the message (V8 JSON errors include text; catch and replace). Empty/whitespace-only → `{}` (VS Code treats an empty settings file as empty).

### claudeJson.ts
- `export function parseDisplayFields(text: string): DisplayFields` - strict `JSON.parse` in try/catch → on error `{ signedIn: false, unreadable: true }`. Return ONLY `{ signedIn, email?, org? }`: `email = oauthAccount.emailAddress` if non-empty string; `org = oauthAccount.organizationName` if non-empty string; `signedIn = email !== undefined`. Never copy other fields, never include the parse error message.
- `export async function readDisplayFields(fs: ReadFs, dir: string, home: string, platform): Promise<DisplayFields>` - read `claudeJsonPathFor`; if missing, try the legacy `.config.json`; if both missing → `{ signedIn: false, missing: true }`.
- Never log the file text or the parsed object.

### vscodeSettings.ts
- `export const ENV_SETTING_KEYS = ['claudeCode.environmentVariables', 'claude-code.environmentVariables']` (second is legacy, see Verified facts 8).
- `export function extractConfigDirValues(settings: unknown, platform): string[]` - for each key, if the value is an array, collect `value` of items whose `name` equals `CLAUDE_CONFIG_DIR` (case-insensitive on win32) and whose `value` is a non-empty string. Also accept the nested shape `{ claudeCode: { environmentVariables: [...] } }`. Ignore everything else.
- `export function extractClaudeSettingsEnvDir(settings: unknown): string | undefined` - `settings.env.CLAUDE_CONFIG_DIR` if string (for `~/.claude/settings.json`; strict JSON but parse with parseJsonc for tolerance).
- `export interface VscodeFinding { value: string; file: string; scope: 'user' | 'user-profile' | 'workspace' | 'workspace-file'; ignoredByVsCode: boolean }`
- `export async function scanVscode(fs: ReadFs, host: HostEnv, opts?: { extraFolders?: string[]; maxWorkspaces?: number /* default 200 */ }): Promise<{ findings: VscodeFinding[]; extensionInstalled: boolean; extensionVersion?: string }>`
  - user: `<userDir>/settings.json` and `<userDir>/profiles/*/settings.json`.
  - workspaces: from `<userDir>/globalStorage/storage.json` → keys of `profileAssociations.workspaces`, `backupWorkspaces.folders[].folderUri`, `backupWorkspaces.workspaces[].configURIPath`, plus `opts.extraFolders`; dedupe with `samePath`. Folder → `<folder>/.vscode/settings.json` (scope `workspace`); a `.code-workspace` file → its `settings` object (scope `workspace-file`). Workspace scopes set `ignoredByVsCode: true` (machine-scoped setting).
  - extension: any dir `<home>/.vscode/extensions/anthropic.claude-code-<ver>[-platform]`; version parsed from the name.
  - Every read is try/catch: missing/invalid files are skipped silently (never throw).

### tests/main/noCredentials.test.ts
Read every file under `src/` (node fs, recursive) and assert that the string `.credentials.json` (and `credentials.json`) appears only in `src/main/accounts/safeFs.ts`. Also assert no file under `src/` contains `keychain` / `security find-generic-password`.

### Test cases (minimum)
- jsonc: line and block comments, `"https://x//y"` string kept, escaped quotes, trailing commas in object/array, BOM, empty file, invalid → JsoncError whose message excludes the input.
- claudeJson: full fixture with fake `oauthAccount.accessToken: 'FAKE-TOKEN'` and other keys → result keys ⊆ {signedIn,email,org}, and `JSON.stringify(result)` does not contain `FAKE`; no oauthAccount → signedIn false; empty email → false; malformed → unreadable; default dir reads `<home>/.claude.json` not `<home>/.claude/.claude.json` (fixture has a stub at the latter, as on the real PC); legacy fallback.
- paths: win32 + posix tables for expandHome, toDisplayPath, samePath case rules, fileUriToPath (`%3A`, spaces `%20`, non-file).
- safeFs: reading `X/.credentials.json`, `X\\.CREDENTIALS.JSON` → CredentialAccessError and the inner fs is never called (spy).
- vscodeSettings: user JSONC with comments → finding; profile settings; workspace finding flagged ignored; legacy key; wrong shapes ignored; storage.json URIs decoded; extension version parsed; missing files → empty result.

## Acceptance commands
- npm test -- tests/main/accounts tests/main/noCredentials.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
