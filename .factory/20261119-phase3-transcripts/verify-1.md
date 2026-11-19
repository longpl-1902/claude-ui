# Verify round 1: PASS

Branch main, HEAD 68da493. Working tree clean before and after the run (no commit made).

| Check | Command | Result |
|---|---|---|
| Tests (lowercase path) | `cd /d/personal/claude-ui && npm test` | pass: 43/43 files, 1054/1054 tests, exit 0 |
| Tests (uppercase path) | `cd /D/personal/claude-ui && npm test` | pass: 43/43 files, 1054/1054 tests, exit 0 |
| Typecheck | `npm run typecheck` (node, web, tests tsconfigs) | pass, exit 0 |
| Build + bundle check | `npm run build` | pass, exit 0; check-bundle: OK (1 React copy, connect-src 'self') |
| PTY check | `npm run check:pty` | pass, exit 0; node-pty OK (prebuilt) |
| Grep (a) no src writes into ~/.claude or Claude/VS Code settings | grep of writeFile/mkdir/rename/unlink/etc. in src | pass: write calls only in `src/main/accounts/profileStore.ts` (accounts.json, its .tmp and .corrupt-* copies, all in userData) and the `safeFs.ts` wrapper. VS Code settings and `~/.claude` are read-only (`vscodeSettings.ts`, `detect.ts`, `transcriptFs.ts`). |
| Grep (b) `.credentials.json` named only in safeFs.ts | grep of literal and of `credentials` | pass: literal `.credentials.json` appears only at `src/main/accounts/safeFs.ts:5`. Other src hits are comments that say "credentials" without the file name. |
| Grep (c) no src file opens registry `.key` files | grep of `.key` and `^\d+\.json$` | pass: `sessionIndex.ts:165` and `transcriptFs.ts:36` use `^\d+\.json$` allowlist; `transcriptFs.ts:34` rejects `.key`. The `.key` hits in `signIn.ts` are Map keys, not files. |
| Grep (d) no real identity in transcript fixtures | `git grep -nw` for real user, project and company names in tests/fixtures and tests/main/transcripts | pass: zero matches. Tracked fixtures are only `tests/fixtures/transcripts/builders.ts` and `trees.ts`, which use `C:/Users/u/...` and invented ids. |
| Skipped or todo tests | grep of `.skip(`, `.todo(`, `xit(`, `xdescribe(` in tests | none |

## Failures by task
None.

## Informational (not failures)
- `acme` appears in pre-existing non-transcript files: `src/shared/mock/accounts.ts`, `src/shared/mock/team.ts`, `tests/shared/folderRules.test.ts`, `tests/shared/mock.test.ts`, plus `docs/design/*.html` and older account/profile tests. These are mock/test data and sit outside the rule's scope (tests/fixtures/transcripts/**). Check manually whether it is intended before any public push.
- Not covered by these commands: the Manual steps in tests.md (real fs.watch latency, real session switch, nothing modified under ~/.claude) and the orchestrator-findings-1.md items O-1 to O-6. The orchestrator note says the fs.watch latency check is still open.
- The app's own pty runs `claude`, which can write inside CLAUDE_CONFIG_DIR when the user signs in. This is the CLI's write, not src code, so check (a) does not cover it.
- Not run, per instructions: `npm run rebuild:pty`, real claude login, GUI launch.
