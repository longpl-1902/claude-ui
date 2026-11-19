# Tests (written before implementation)

Run one file: `npm test -- <file>`. Run everything: `npm test`. (Never raw `npx vitest`.)

| File | Task | IDs | Tests |
|---|---|---|---|
| tests/main/accounts/memoryFs.ts | T02 helper | - | `createMemoryFs(files, dirs?, { caseInsensitive? })`; extras: `writes`, `ops`, `reads`, `setFile`, `has`, `content`, `fileKeys` |
| tests/main/accounts/safeFs.test.ts | T02 | R-05 | 8 |
| tests/main/accounts/paths.test.ts | T02 | R-02, R-03, R-07 | ~45 |
| tests/main/accounts/jsonc.test.ts | T02 | R-04 | 9 |
| tests/main/accounts/claudeJson.test.ts | T02 | R-03, R-05 | 12 |
| tests/main/accounts/vscodeSettings.test.ts | T02 | R-02 | 15 |
| tests/main/noCredentials.test.ts | T02 | R-05 | 3 |
| tests/shared/folderRules.test.ts | T03 | R-07 | ~20 |
| tests/shared/safety.test.ts | T03 | R-08 | 15 |
| tests/main/pty/claudeBinary.test.ts | T04 | R-09 | 11 |
| tests/main/pty/childEnv.test.ts | T04 | R-09 | ~30 |
| tests/main/pty/ptyManager.test.ts | T04 | R-09 | 18 |
| tests/main/accounts/detect.test.ts | T05 | R-02, R-03, R-05, R-14 | 21 |
| tests/main/accounts/profileStore.test.ts | T05 | R-06, R-14 | 21 |
| tests/main/accounts/signIn.test.ts | T07 | R-10, R-14 | 22 |
| tests/main/accounts/accountsService.test.ts | T07 | R-02, R-03, R-06..R-09, R-12..R-14 | 32 |
| tests/shared/ipcContract.test.ts (appended) | T01 | R-01 | 30 cases (18 invoke + 4 push channels, PUSH_CHANNELS, INVOKE = all - PUSH, naming, preload references) |

## Not written here
Renderer tests (R-11, R-12 UI, R-13 UI) belong to T06, T08, T09, T10. `tests/main/ipcHandlers.test.ts` belongs to T07/T01.

## Manual (cannot be automated)
- R-09 real node-pty load: `npm run check:pty`.
- R-10 real login: browser opens, panel reaches Ready, Check now works (plan "Test strategy" manual step 3).
- R-14 mtime of `%APPDATA%/Code/User/settings.json` and `~/.claude/settings.json` unchanged after a session.

## Notes for implementers
- The existing case "INVOKE_CHANNELS covers every channel except teamEvent" in ipcContract.test.ts will break when T01 adds the four push channels (it expects exactly one excluded). T01 must change it to use `PUSH_CHANNELS` (the new R-01 cases already cover that rule).
- Tests assume `readdir`-derived names and `fs.reads` only; `memoryFs` is case-insensitive for win32 fixtures.
- paths.ts functions that join with `path.win32` may return backslashes; tests compare after `\` -> `/` except `toDisplayPath` (must be `/`) and posix cases.
- Assumed shapes not spelled in the task Notes: `vscodeUserDirs` returns `string[]`; `scanVscode` findings carry `file`; `loadAccountsFile` adds a warning when a corrupt file is moved aside; `signIn.status(unknownDir)` returns `{ step: 'none' }`; `removeProfile`/`setDefault` of an unknown id return `ok: false`; `saveProfile` rejects an empty name or a non-hex color.

## Current state
All new files fail on import resolution (module not found) only. `noCredentials.test.ts`: 1 of 3 fails (safeFs.ts missing), the other 2 pass trivially. ipcContract: 26 new cases fail (undefined channels / missing preload references), 4 pass.
