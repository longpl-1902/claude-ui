# T08 - TerminalView (xterm and pty bridge) and the live RawTerminalPane

- Wave: 3
- Depends on: T01 (ConsoleApi.pty, TerminalView stub contract), T06 (store `leadPty`, `setLeadPty`, accounts snapshot)
- Spec refs: R-13; spec "Lead console raw-terminal toggle", Stack "xterm.js + node-pty"
- Tests: tests/renderer/terminal.test.tsx, tests/renderer/teamCenter.test.tsx (raw-terminal cases)

## Goal
A reusable `TerminalView` that attaches an interactive xterm to a main-process pty by id. The lead console's
RawTerminalPane becomes a real launcher: it picks a folder, shows the account that folder resolves to (or an
"Ask me" picker), shows the safety warnings, and starts `claude`. Then it shows the live terminal. The session
survives toggling the pane.

## Owned files
- modify: src/renderer/src/components/terminal/TerminalView.tsx (replace the T01 stub; keep the props exactly)
- create: src/renderer/src/components/terminal/terminal.css
- modify: src/renderer/src/components/team/RawTerminalPane.tsx
- create: tests/renderer/terminal.test.tsx
- modify: tests/renderer/teamCenter.test.tsx (only the Raw terminal / RawTerminalPane cases, lines ~173-198 in Phase 1)

## Read-only context
- src/shared/ipc.ts, src/shared/types.ts (PtySpawnRequest/Result, LaunchCheck, PtyDataEvent)
- src/renderer/src/store/useConsoleStore.ts (T06)
- src/renderer/src/components/team/LeadConsole.tsx, teamCenter.css (styles you may reuse, not edit)
- src/renderer/src/components/ui/{Button,Icons}.tsx

## Notes
### TerminalView
Props: `{ ptyId: string; ariaLabel?: string; className?: string; interactive?: boolean }` (from T01).
- Lazy-import `@xterm/xterm`, `@xterm/addon-fit` and the css, as Phase 1 did. Theme from the tokens (background #0B0C0E, foreground #E6E7EA), JetBrains Mono 12px, `disableStdin: !interactive`, `scrollback: 5000`, `convertEol: false`.
- Mount: `term.write(await api.pty.getBuffer(ptyId))`, then subscribe `api.pty.onData` filtered by ptyId → `term.write`. `term.onData(d => api.pty.write(ptyId, d))` when interactive. A `ResizeObserver` → `fit.fit()` → `api.pty.resize(ptyId, cols, rows)`, debounced 50 ms. `api.pty.onExit` for this id → write `\r\n[process exited with code N]\r\n` and set `data-exited="true"` on the container. Do not add props beyond the T01 contract.
- Unmount: unsubscribe and dispose xterm. **Never kill the pty on unmount** (the session must survive toggling).
- A ptyId change → reset and re-attach.
- Guard everything when `window.api` is missing (render the container only).

### RawTerminalPane
State (local plus store `leadPty`):
1. If `leadPty.ptyId` is set and that pty is alive (`api.pty.list()` contains it without `exitCode`) → render a header row (folder, account chip with its color, a "Stop" button → `api.pty.kill`, then `setLeadPty({})`) plus `<TerminalView ptyId=... ariaLabel="Lead session terminal" />`.
2. Otherwise render the launcher form:
   - Folder: text input (default `leadPty.folder` ?? `await api.app.getDefaultCwd()`) plus "Change…" → `api.app.pickFolder()`.
   - On folder change: `api.accounts.resolveFolder(folder)` → shows "Uses <Account> (rule: <pattern>)", or for `ask` a `<select>` of accounts labelled "Ask me: pick an account".
   - Start `claude`: `api.accounts.checkLaunch(folder, accountId)`. Blocked → an inline error (`account-locked`: "This folder already has a session on another account. Stop it first, or turn off the lock in Accounts."; `pty-unavailable`: "Terminal support (node-pty) is not available in this build."; `claude-not-found`: "Could not find the claude CLI on PATH."). Warnings → an inline confirm ("You are opening a company folder with a personal account." + "Open anyway" / "Cancel"). Then `api.pty.spawn({ cwd, accountId, cols: 120, rows: 30, confirmed })` → `setLeadPty({ ptyId, folder, accountId })`.
   - No accounts in the store → show "Add an account in Accounts first" plus a button that calls `navigate('accounts')`.
- Remove the Phase 1 placeholder text ("placeholder until Phase 2").

### Tests (mock `@xterm/xterm` like Phase 1; `window.api` = vi.fn mocks; never a real xterm)
- terminal.test: TerminalView writes the buffer, then data events for its id only. Typing calls `pty.write` (simulate via the mocked `term.onData` callback). Unmount disposes and does NOT call `pty.kill`. Exit sets `data-exited`. No `window.api` → no crash.
- RawTerminalPane: the launcher shows the resolved account; the ask → select path; blocked messages; warning confirm → spawn with `confirmed: true`; a spawn result sets `leadPty`; re-mount with a live `leadPty` shows the terminal, not the form; Stop kills and clears.
- teamCenter.test: update the two placeholder cases. The toggle now shows the launcher (or the "Add an account" hint when the store has no accounts).

## Acceptance commands
- npm test -- tests/renderer/terminal.test.tsx tests/renderer/teamCenter.test.tsx
- npm test
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
