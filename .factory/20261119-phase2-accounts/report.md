# Phase 2 report: Accounts

Status: **done, waiting for user review.** Branch `main`, not pushed.

## What was built
- **Detection** (main): `~/.claude` plus `~/.claude-*` dirs that pass a marker check, `.claude.json` email and org only,
  VS Code user, profile and workspace settings (`claudeCode.environmentVariables`, legacy key), `env` in `~/.claude/settings.json`.
  Workspace-level findings are shown with a warning, because VS Code ignores this machine-scoped setting there.
- **Profiles** in `<userData>/accounts.json`: schema-validated, atomic save. A file that cannot be loaded, or loads with
  dropped entries, is copied to `accounts.json.corrupt-<ts>` first.
- **Folder rules**: glob to account, first match wins, "Ask me" fallback. Supports `~`, `*`, `**`, `?` and a plain-path prefix,
  and is case-insensitive on Windows.
- **Safety**: an account locked while a session runs in that folder tree; a warning and confirm before a personal account
  opens a company folder. The main process enforces both, with the check and the spawn run as one step.
- **Pty**: the real `claude.exe` is resolved behind the npm shim. The child env strips `ELECTRON_RUN_AS_NODE` and the inherited
  Claude Code session vars. `CLAUDE_CONFIG_DIR` is unset for the default account and absolute otherwise. A ring buffer with
  byte offsets prevents duplicate output on reattach. Everything is killed on quit.
- **Sign-in**: `claude auth login` runs in a pty and chokidar watches the dir; the credentials file is ignored. Check now,
  Open browser again and Cancel are available, with an optional terminal.
- **UI**: the Accounts screen uses real data (detected logins, 3-step sign-in, cards with add/rename/color/default/remove,
  rules editor, safety toggles, limit policy, running now, error banner). The header chip shows the real account or
  "No account". The lead console's Raw terminal starts a real `claude`.

## Tasks
| Task | Rounds | Result |
|---|---|---|
| T01 contract, T02 parsers, T03 rules and safety, T04 pty | 1 | PASS |
| T05 detect and store | 2 (lossy-load backup) | PASS |
| T06 renderer store | 2 (chip truncation, rollback) + orchestrator one-liner (aria-label) | PASS |
| T07 service wiring | 2 (sign-in rules, dirty re-run, relative dir, refresh on done, launch race) | PASS |
| T08 terminal view | 2 (select height, reattach offsets) | PASS |
| T09 detected and sign-in UI | 2 (aria-live scope, account lookup) | PASS |
| T10 manage UI | 2 (single add button, rule focus) + orchestrator one-liner (NUL byte) | PASS |

Orchestrator test-file fixes: non-null assertions for `noUncheckedIndexedAccess` and deduplicated contract types.

## Checks
- `npm test`: 32 files, 601 tests pass (lowercase and uppercase drive path). `npm run typecheck` is clean.
  `npm run build` passes the bundle check. `npm run check:pty` passes.
- The built app was run on the user's PC twice:
  - Detection found `~/.claude` (email and org, CLI and VS Code extension) and skipped `~/.claude-server-commander`.
  - "Use this" linked the account.
  - Raw terminal ran real Claude Code 2.1.309 on that account, with the lock shown. Stop worked, and nothing was left running.
  - The profile persisted across restart. After the fixes the header stays on one row and the launcher select is a single line.

## Spec differences (reality wins, per hard rule 2)
1. Sign-in uses `claude auth login`, not `/login` inside `claude`.
2. The default account's `.claude.json` is `~/.claude.json`, so the default account runs with `CLAUDE_CONFIG_DIR` unset.
3. `claudeCode.environmentVariables` is machine-scoped, so VS Code ignores it in workspace settings. It is shown with a warning.
4. `~/.claude-*` needs a marker check (`~/.claude-server-commander` is not a Claude dir).
5. `npm run rebuild:pty` fails (winpty build error). node-pty 1.1.0 prebuilt binaries work under Electron 45, so don't run it.
6. `claude auth status --json` would write files into a config dir, so it is not used.
7. The plan name exists (`planDisplayName`) but stays hidden (user decision).
8. The VS Code extension runs its own bundled claude (2.1.326); the app launches the npm CLI (2.1.309). This matters for Phase 3b.

## Still manual (for the user)
- A real sign-in for a new folder: Accounts, "+ Add account" with a new folder (e.g. `~/.claude-personal`), then Sign in,
  the browser, and Check now.
- Confirm that VS Code and Claude settings files are unchanged after using the app (the R-14 mtime check).

## Notes for later phases
- A broken `accounts.json` that is never saved over gets a new `.corrupt-` copy on every start (low).
- Tokens today shows "—" until the Phase 3 transcripts.
