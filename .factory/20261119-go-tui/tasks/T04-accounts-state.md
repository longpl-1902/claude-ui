# T04 — accounts, pathx, safefs, statefile (wave 1)

## Goal
Account detection and profiles, path helpers, the credential-safe file layer, and the
multi-instance-safe app state (atomic writes + session locks). Standard library only
(`golang.org/x/sys/windows` allowed in statefile for process create time / MoveFileEx).

## Owns
`internal/pathx/**`, `internal/safefs/**`, `internal/statefile/**`, `internal/accounts/**`.

## Reference
`src/main/accounts/{paths,claudeJson,detect,jsonc,vscodeSettings,profileStore,safeFs,signIn}.ts`,
`src/shared/{folderRules,safety,displayPath,accountsDefaults}.ts`; tests
`tests/main/accounts/*.test.ts`, `tests/shared/{folderRules,safety,displayPath}.test.ts`,
`tests/main/noCredentials.test.ts`.

## Steps
1. `pathx`: `ExpandHome`, `NormalizeForCompare` (Windows: lowercase, `/`, UNC kept), `Same`,
   `Display` (`~/...`), `IsAbs` (drive or UNC), `IsSameOrNested`.
2. `safefs`: `IsDenied(path)` (basename `.credentials.json`, any `*.key`), allow-list
   `IsReadable(path)` per spec §6.1, `ReadFile`, `ReadDir`, `Stat`, `ReadRange`, `Open` that
   return `ErrDenied` for denied paths. The string `.credentials.json` appears **only** in this
   package. Implements `transcript.ByteReader`-shaped methods (no import of transcript; T07 adapts).
3. `statefile`:
   - `Dirs()` → `%APPDATA%\ac`, `%LOCALAPPDATA%\ac`, `locks\` (created on demand).
   - `WriteJSONAtomic(path, v)`: temp file in the same dir (`<name>.tmp-<pid>-<rand>`), write,
     `Sync`, close, rename with replace (MoveFileEx REPLACE_EXISTING|WRITE_THROUGH), retry 5×
     with backoff on sharing violations, remove temp on failure.
   - `Update(path, func(*T) error)`: read latest → mutate → atomic write, guarded by an
     exclusive lock file `<path>.lock` (O_EXCL, stale after 10 s or dead pid) so concurrent
     instances do not lose each other's edits.
   - `ReadJSON(path, *T) error` tolerant of missing/partial files (returns `ErrNotExist` /
     keeps caller's value on parse error).
   - Session locks: `AcquireSession(id) (Lock, error)`, `Lock.Release()`, `Owner(id) (pid int, live bool)`;
     file `{pid, created, account}`; stale if pid dead or process create time differs; takeover =
     remove + O_EXCL retry (exactly one winner). Injected `procInfo(pid) (created time.Time, alive bool)`
     for tests.
4. `accounts`:
   - `ParseDisplayFields([]byte) Display{SignedIn, Email, Org, Unreadable}` — only those fields.
   - `ReadDisplay(dir, home)` with the default-dir rule (`~/.claude` → `~/.claude.json`) and
     `.config.json` fallback; via safefs.
   - `Detect(home, env, appData) []Detected` (markers, `~/.claude-*`, env `CLAUDE_CONFIG_DIR`,
     VS Code user `settings.json` JSONC with `claudeCode.environmentVariables`; warnings for
     relative / default-dir cases). Port `jsonc.ts` (comments, trailing commas).
   - `Config{Accounts []Profile; Rules []Rule; Prefs Prefs}` and `State{LastAccount; LastAccountAt}`
     load/save via statefile (`config.json` in APPDATA, `state.json` in LOCALAPPDATA).
     `Prefs`: `ClaudePath, Editor string; ListDays int; Mouse, Toast bool; WarnPersonalInCompany,
     LockAccountPerFolder bool; AlwaysUseAccount string`.
   - Folder rules: `MatchFolder(rules, folder, home)` (port glob semantics incl. `**`,
     fallback `*`/"anything else" skipped). Safety: `CheckLaunch(...)` port.
   - `ChooseStartup(flagAccount string, cfg, state, detected) (id string, showPicker bool, err error)`
     — the 4-step rule of spec §4.3.
   - `SignInCmd(claudePath, dirAbs string, hasAuthLogin bool) *exec.Cmd` (env via a minimal
     copy of the strip list or by accepting a ready env from the caller — do not import
     `control`).
   - Accent colours: default palette of 6 distinct colours, assigned by order when a profile has none.

## Tests to port / write
- `paths.test.ts`, `claudeJson.test.ts` (incl. "never touches the credentials file"),
  `detect.test.ts`, `jsonc.test.ts`, `vscodeSettings.test.ts`, `profileStore.test.ts`,
  `folderRules.test.ts`, `safety.test.ts`, `displayPath.test.ts`, `safeFs.test.ts` → Go tables,
  using `t.TempDir()` homes.
- `noCredentials`: a test walks the repo (`../../`) and fails if any `.go` file outside
  `internal/safefs` contains `.credentials.json`, or any file mentions keychain / `security
  find-generic-password` / `CredRead`.
- **New**: atomic write — 8 goroutines + 2 child processes (re-exec test binary) doing
  `Update` 200× each on one file: final JSON valid and holds all increments; a reader looping
  during writes never sees a parse error. Session lock — acquire, second acquire fails with
  owner pid, stale by dead pid, stale by pid reuse (created time mismatch), 20 goroutines race
  for a stale lock → exactly one winner, release removes only our own lock.
- `ChooseStartup` table (flag, always-use, single account, picker with lastAccount preselect,
  unknown flag account).

## Acceptance
`go vet ./...` · `go test -race ./internal/pathx/... ./internal/safefs/... ./internal/statefile/... ./internal/accounts/...` ·
`go build ./...` · `gofmt -l .` empty.
