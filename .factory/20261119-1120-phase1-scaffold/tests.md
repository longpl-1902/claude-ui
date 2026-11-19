# Tests: 20261119-1120-phase1-scaffold

Run all: `npm test` (vitest run). Single file: `npm test -- tests/shared/status.test.ts`.
Renderer test files start with `// @vitest-environment jsdom` and `import './jestDom'` (see Environment note).

## Test files

| File | Task | Covers | Tests (approx.) |
|---|---|---|---|
| tests/shared/status.test.ts | T02 | R-04: rules 1-7, ordering (error then tool_start, stop beats open tool), unsorted input, no mutation, eventsForAgent, opts.recentMs, now as Date/number/string | 28 |
| tests/shared/format.test.ts | T02 | R-05: formatTokens, formatElapsed, sumTokens, teamCounters | 6 |
| tests/shared/mock.test.ts | T02 | R-05, R-17: agents, worktrees, tasks, overlaps, console, events, derived statuses, counters 6/3/1/1.12M, referential invariants, accounts snapshot, shared modules free of node/electron/network imports | 25 |
| tests/main/ipcHandlers.test.ts | T05 | R-03, R-17: one handler per INVOKE_CHANNELS, clone-on-call snapshots, not-implemented / invalid-args / version, handlers.ts has no fs/net/child_process, index.ts wiring | 17 |
| tests/renderer/ui.test.tsx | T03 | R-06, R-18: StatusPill labels + pulse, Button, Avatar, Icons, theme/colors vs tokens.css, tokens present, focus-visible, reduced motion, local fonts, no remote URL | 33 |
| tests/renderer/store.test.ts | T04 | R-07, R-13: initial state, navigate, select, tabs, console submit + IPC send, hydrate, account actions, sign-in flow, reset, derived hooks | 22 |
| tests/renderer/teamSections.test.tsx | T06 | R-08, R-09, R-13: header texts, counters, buttons, chip navigates, color edge, worktrees, shared tasks | 19 |
| tests/renderer/teamCenter.test.tsx | T07 | R-10: overlap banner, agent cards + selection, timeline, lead console, raw terminal toggle, RawTerminalPane (xterm mocked) | 18 |
| tests/renderer/inspector.test.tsx | T08 | R-11: header, stats, tabs (a11y, arrows), files/messages/activity, failed class, actions | 14 |
| tests/renderer/accountsView.test.tsx | T09 | R-12, R-15, R-13, R-17(no fake %): all sections, sign-in flow, link, policy radios, safety checkboxes, default, back link | 17 |
| tests/renderer/teamView.test.tsx | T10 | R-15, R-14 (static CSS only): full team view smoke, landmarks, selection, skip link, breakpoints | 7 |
| tests/renderer/app.test.tsx | T10 | R-13, R-15, R-03: App without api, navigation both ways, hydrate from window.api, rejecting api | 4 |
| tests/renderer/jestDom.ts | helper | not a test: registers jest-dom matchers (see below) | - |

T01 tests (tests/sanity.test.ts, tests/shared/ipcContract.test.ts) are unchanged and still pass.

## Manual (not automated)
- R-01 window security (contextIsolation, sandbox, CSP, navigation block): review src/main/index.ts.
- R-02 dependencies declared once: review package.json.
- R-14 responsive collapse visually: resize the window under 1100 px and under 700 px. Only the CSS breakpoints are checked statically.
- R-16 visual match to both mockups at 1440x1260 / 1440x1900.
- R-18 / R-06 final grep: `out/` has no `https://` or `fonts.g`; `.woff2` files present; app works offline.
- Keyboard focus order, visible focus, reduced motion in a real window; contrast of faint tokens.

## Current status
All 12 new test files fail at collection because the production modules do not exist yet (`@shared/status`, `@shared/format`, `@shared/mock`, `src/main/ipc/handlers`, `@renderer/*`). No syntax errors. T01 tests pass (5).

## Environment note: jest-dom under Git Bash
`import '@testing-library/jest-dom/vitest'` breaks when the shell cwd has a lowercase drive letter (Git Bash `cd /d/personal/claude-ui`): `Invalid Chai property: toHaveAttribute`, because jest-dom's own `import 'vitest'` resolves to a second vitest copy that the config alias does not cover (it is an external dependency). It works from PowerShell (`D:\`).
Fix used, with no config change: renderer tests import `tests/renderer/jestDom.ts`, which calls `expect.extend(matchers)` with `@testing-library/jest-dom/matchers` on the aliased `vitest`. Verified with a throwaway test passing under both Git Bash and PowerShell.

## Assumptions the implementers must satisfy (read from task Notes, tests are strict on these)
- `TeamView` is a named export of screens/TeamView.tsx; `App` is the default export of App.tsx; `AccountsView`, `Inspector`, etc. are named exports.
- Events in mock use `Z` timestamps on 2026-11-19 (matching `now`), teammates have `parentAgentId: 'lead'` and `worktree` = their branch on every event.
- formatTokens(1125000) is `1.12M` (truncate or round-half-even, not round-half-up).
- TeamHeader sets the account color inline on the `<header>` style (`border-top: 3px ...`); switched off when `showAccountColorEdge` is false.
- Inspector failed result: the result element or an ancestor has a class containing `failed`.
- Timeline lane segments carry `title={kind}` and inline `left` / `width` in `%`.
- Sign-in steps are `<ol><li>` (3 items) with exactly one `aria-current="step"`.
- TeamView.css has `@media (max-width: 1100px)` and `@media (max-width: 760px)` and the three flex shorthands `1 1 240px`, `999 1 560px`, `1 1 360px`.
- Skip link: `<a href="#ac-agents">Skip to agents</a>` is the first link or button in TeamView.
