# Report: Agent Console - Phase 1

## What was built
Electron + electron-vite + React 18 + TypeScript (strict) desktop app, local only (no web target, no CDN, fonts bundled).
- Secure window: contextIsolation, sandbox, nodeIntegration off, navigation and window.open blocked, typed preload bridge.
- Shared types (AgentEvent as in spec), typed IPC contract, main-process handlers serving mock data.
- Design tokens, local Inter / JetBrains Mono, UI primitives (Button, StatusPill, Avatar, icons).
- Team view: header (account chip, 3 px account-colour edge, counters, Pause all, New teammate), worktrees + shared tasks,
  overlap banner, agent cards, 20-min timeline, lead console with raw-terminal placeholder, inspector (Activity / Files / Messages, actions).
  Fills the window above 1100 px with internally scrolling columns; stacks below 1100 / 760 px.
- Accounts screen: detected logins, 3-step sign-in panel, privacy line, account cards (no fake usage %, "Tokens used today"),
  folder rules table, safety toggles, usage-limit policy, running sessions.
- Derived agent status (running / waiting / needs-you / done), Zustand store, navigation.

## Task status
| Task | Status | Rounds |
|---|---|---|
| T01 scaffold / config | PASS | 3 Sonnet fixes + 2 Opus escalations (Windows drive-letter case, ELECTRON_RUN_AS_NODE, electron binary, dev-only CSP) |
| T02 mock data, status, format | PASS | 1 |
| T03 design system | PASS | 2 |
| T04 store + shell | PASS | 1 |
| T05 IPC handlers | PASS | 1 |
| T06 header + left column | PASS | 2 |
| T07 center column | PASS | 2 |
| T08 inspector | PASS | 2 (+1 follow-up) |
| T09 accounts screen | PASS | 2 |
| T10 team view integration | PASS | 2 |

## Tests
verify-2: build PASS (bundle check: one React, production CSP connect-src 'self'), 15 files / 210 tests PASS from Git Bash (d:\) and PowerShell (D:\), typecheck PASS, built app launches without renderer errors. review-2: PASS.

## Not verified automatically (manual)
- R-14 window resize behaviour (note: at 600 px height the inspector's fixed parts may clip).
- R-16 side-by-side visual match with the mockups (Team view checked by screenshot; Accounts screen not screenshotted).
- R-18 running fully offline.

## Open issues / notes for later phases
- Always use `npm test` / `npm run dev|build|preview` (wrappers normalise the cwd); plain `npx vitest` from a lowercase d:\ path breaks.
- Phase 2: strip ELECTRON_RUN_AS_NODE when spawning `claude`; run `npm run rebuild:pty` (VS 2026 C++ tools present).
- Phase 3b added to spec: stream-json session control (prompts, slash commands, permission Allow/Deny, resume).
- tests/renderer/jestDom.ts is a now-redundant workaround (harmless).

## How to run
    npm install
    npm run dev        # development window with hot reload
    npm test           # 210 tests
    npm run build && npm run preview
