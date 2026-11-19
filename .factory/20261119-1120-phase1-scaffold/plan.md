# Plan: Agent Console - Phase 1 (scaffold, tokens, both screens on mock data, typed IPC skeleton)

## Goal
When this run is done, `npm run dev` opens an Electron window titled "Agent Console". It shows the Team view
and the Accounts screen, built in React from mock data and visually close to
`docs/design/team-view.mockup.html` and `docs/design/accounts.mockup.html`. A typed preload bridge
and main-process IPC handlers exist. In this phase the handlers return the same mock data. Phases 2-5
replace them with real services. No real data sources, no pty, no network calls.

Requirements:
- R-01 Electron + electron-vite + React 18 + TypeScript strict project. `npm run build` and `npm run typecheck` pass. The window uses contextIsolation on, nodeIntegration off and sandbox on, blocks navigation and window.open, and sets a CSP.
- R-02 Every Phase 1 dependency is declared once, in wave 1: react, zustand, @xterm/xterm, chokidar, node-pty (optional), vitest, testing-library, jsdom, electron-builder, @fontsource fonts. No later task adds dependencies.
- R-03 Shared types, including `AgentEvent` exactly as in spec.md, a typed IPC channel contract, a typed `window.api` preload bridge, and main handlers registered for every invoke channel, returning mock data or `{ ok: false, reason: 'not-implemented' }`.
- R-04 `deriveAgentStatus()` returns running / waiting / needs-you / done from AgentEvents (rules in T02 Notes), with unit tests.
- R-05 The mock data module reproduces the mockups' agents, worktrees, tasks, console log, overlap, accounts, detected logins, rules and sessions. Tests check that it conforms to the types and invariants.
- R-06 Design tokens are CSS custom properties. Inter and JetBrains Mono are bundled locally via @fontsource, with no CDN. Focus is visible. `prefers-reduced-motion` disables the pulse. Every status color is paired with a text label.
- R-07 A Zustand store holds the current screen, the selected agent, the inspector tab, the raw-terminal toggle and the Accounts UI state, plus selectors. Unit tests cover it.
- R-08 Team header: app name, repo / team, account chip (click opens Accounts), 3 px top border in the account color, counters (agents, running, needs you, tokens), and the "Pause all" and "+ New teammate" buttons.
- R-09 Team left column: the Worktrees list (amber border on overlap) and Shared tasks with their state.
- R-10 Team center: the overlap banner with "Compare diffs", the agent cards grid (auto-fill, min 260 px, click selects), the Timeline swimlanes with legend, and the Lead console (event stream, prompt input, raw-terminal toggle with an xterm placeholder pane).
- R-11 Inspector: header and stats, assigned task and worktree, the Activity / Files / Messages tabs, and the Message agent / Open worktree / Pause / Stop actions.
- R-12 Accounts screen: Detected logins, the 3-step sign-in flow panel, the privacy line, account cards, the folder rules table, the Safety toggles, the usage-limit policy and Running now.
- R-13 Navigation: the account chip goes to Accounts, and the "Team view" back link returns. There is no router library; the screen lives in the store.
- R-14 The 3 columns collapse on narrow windows (flex-wrap basis 240 / 560 / 360 px, as in the mockup).
- R-15 Render smoke tests of both screens check that the key texts are present and that interactions switch state.
- R-16 Visual match with the mockups: manual.
- R-17 No network calls to Claude services, and no reading of config dirs or credentials, in Phase 1.
- R-18 Local desktop app only (user clarification): Electron on the user's Windows PC, never a web app. There is no web or browser build target and no hosting. The production renderer is loaded from the packaged files with `loadFile`. The Vite dev server URL is used only under `npm run dev` (`ELECTRON_RENDERER_URL`). There are no CDN or remote assets: fonts, icons and scripts are all bundled locally. The app works fully offline, and the CSP allows only `'self'` (plus `ws:`/`http://localhost:*` connect in dev only).

## Stack
- Electron (current stable), electron-vite, Vite, @vitejs/plugin-react, React 18.3, TypeScript strict, and Zustand 5. The stack was mandated by the user, so it does not need confirmation.
- Renderer terminal: @xterm/xterm (placeholder only). Main: node-pty in `optionalDependencies` (not imported in Phase 1). chokidar is declared for Phase 3.
- Tests: vitest, jsdom, @testing-library/react, @testing-library/jest-dom and @testing-library/user-event. Renderer test files opt into jsdom with a `// @vitest-environment jsdom` docblock. The default environment is node.
- Packaging: electron-builder, with config in `electron-builder.yml`. @electron/rebuild is used for node-pty through a manual script, not a postinstall step.
- Commands: build `npm run build` (electron-vite build), test `npm test` (vitest run), typecheck `npm run typecheck` (tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json), and dev `npm run dev`.
- Path aliases (identical in tsconfigs, electron.vite.config.ts and vitest.config.ts): `@shared/*` maps to `src/shared/*` and `@renderer/*` maps to `src/renderer/src/*`.

## Architecture
- **main** (`src/main`): creates the secure BrowserWindow and calls `registerIpcHandlers(ipcMain)` from `src/main/ipc/handlers.ts`. The handlers are a plain object keyed by the channel constants, so tests call them without Electron. The Phase 1 services are mock-backed.
- **preload** (`src/preload/index.ts`): `contextBridge.exposeInMainWorld('api', api)`, where `api: ConsoleApi` is built only from `ipcRenderer.invoke` / `on` with channel constants from `@shared/ipc`. It must be sandbox-safe: it imports only `electron` and type-only shared imports, and the constants are inlined by the bundler.
- **shared** (`src/shared`): `types.ts` (domain plus AgentEvent), `ipc.ts` (channels, ConsoleApi, invoke map), `status.ts` (deriveAgentStatus), `format.ts` (tokens / elapsed formatting) and `mock/` (teamSnapshot, accountsSnapshot). It is pure TS with no DOM or Node imports.
- **renderer** (`src/renderer/src`): `App.tsx` reads `screen` from the store and renders `<TeamView/>` or `<AccountsView/>`. On mount it calls `window.api?.team.getSnapshot()` and `hydrateTeam` (guarded, so tests run without api). The store is seeded synchronously from `@shared/mock`, so tests and first paint need no IPC.
- Styling: `styles/tokens.css` (all custom properties) and `styles/global.css` (reset, fonts, focus, pulse, reduced motion). Each component folder has one co-located `.css` file with `ac-`-prefixed classes. Inline `style` is used only for data-driven colors and percentages, such as avatar colors and timeline segment left/width.
- UI primitives (`components/ui`): Button, StatusPill, Avatar and Icons. All screen tasks use them.

## File tree
```
package.json, package-lock.json, electron.vite.config.ts, electron-builder.yml,
tsconfig.json, tsconfig.node.json, tsconfig.web.json, vitest.config.ts, .gitignore(mod)      T01
src/main/index.ts                                                                            T01, mod T05
src/main/ipc/handlers.ts                                                                     T05
src/preload/index.ts, src/preload/index.d.ts                                                 T01
src/shared/types.ts, src/shared/ipc.ts                                                       T01
src/shared/status.ts, src/shared/format.ts, src/shared/mock/team.ts, src/shared/mock/accounts.ts, src/shared/mock/index.ts  T02
src/renderer/index.html, src/renderer/src/main.tsx                                           T01, main.tsx mod T03
src/renderer/src/App.tsx                                                                     T01 (placeholder), mod T04
src/renderer/src/styles/tokens.css, styles/global.css, theme/colors.ts                       T03
src/renderer/src/components/ui/{Button,StatusPill,Avatar,Icons}.tsx, ui.css                  T03
src/renderer/src/store/useConsoleStore.ts                                                    T04
src/renderer/src/screens/TeamView.tsx, screens/TeamView.css                                  T04 (layout + stubs wiring), mod T10
src/renderer/src/screens/AccountsView.tsx, screens/AccountsView.css                          T04 (stub), mod T09
src/renderer/src/components/team/{TeamHeader,WorktreeList,SharedTaskList}.tsx + teamLeft.css T04 stubs -> T06
src/renderer/src/components/team/{OverlapBanner,AgentGrid,AgentCard,Timeline,LeadConsole,RawTerminalPane}.tsx + teamCenter.css  T04 stubs -> T07
src/renderer/src/components/inspector/{Inspector,ActivityTab,FilesTab,MessagesTab}.tsx + inspector.css T04 stubs -> T08
src/renderer/src/components/accounts/{AccountsHeader,DetectedLogins,AccountCards,FolderRules,AccountPolicies,RunningNow}.tsx  T09
(AccountsView.css is created by T09; team AgentCard.tsx / RawTerminalPane.tsx by T07; inspector tabs by T08)
tests/shared/{status,format,mock}.test.ts                                                    T02
tests/shared/ipcContract.test.ts, tests/sanity.test.ts                                       T01
tests/main/ipcHandlers.test.ts                                                               T05
tests/renderer/ui.test.tsx                                                                   T03
tests/renderer/store.test.ts                                                                 T04
tests/renderer/teamSections.test.tsx                                                         T06
tests/renderer/teamCenter.test.tsx                                                           T07
tests/renderer/inspector.test.tsx                                                            T08
tests/renderer/accountsView.test.tsx                                                         T09
tests/renderer/teamView.test.tsx, tests/renderer/app.test.tsx                                T10
```
T04 creates stubs for the section component files at the agreed paths and export names, so TeamView compiles. Each wave-4 task then replaces its own stubs. The stub contract is in T04 Notes.

## Waves
| Wave | Tasks | Why this order |
|---|---|---|
| 1 | T01 | Single owner of package.json, the lockfile, configs, the secure Electron shell, shared types and the IPC contract. Everything else needs node_modules and the types. |
| 2 | T02, T03 | Domain (mock data, status, format) and the design system are independent, and both need only T01. |
| 3 | T04, T05 | The store, app shell and stubs need the mock data (T02) and the primitives (T03). The main IPC handlers need the mock data. |
| 4 | T06, T07, T08 | Team view sections: disjoint component files that replace the T04 stubs. |
| 5 | T09, T10 | Accounts screen (one owner for every accounts file). Team view final layout plus screen and app smoke tests, after all team sections exist. |

## Acceptance map
| Criterion | Task(s) | Test file |
|---|---|---|
| R-01 | T01 | tests/sanity.test.ts, `npm run build`, `npm run typecheck`; window security: manual review of src/main/index.ts |
| R-02 | T01 | manual: package.json review (no later task touches it) |
| R-03 | T01, T05 | tests/shared/ipcContract.test.ts, tests/main/ipcHandlers.test.ts |
| R-04 | T02 | tests/shared/status.test.ts |
| R-05 | T02 | tests/shared/mock.test.ts, tests/shared/format.test.ts |
| R-06 | T03 | tests/renderer/ui.test.tsx (StatusPill label); fonts not from CDN: manual grep of build output for `fonts.g` |
| R-07 | T04 | tests/renderer/store.test.ts |
| R-08 | T06 | tests/renderer/teamSections.test.tsx |
| R-09 | T06 | tests/renderer/teamSections.test.tsx |
| R-10 | T07 | tests/renderer/teamCenter.test.tsx |
| R-11 | T08 | tests/renderer/inspector.test.tsx |
| R-12 | T09 | tests/renderer/accountsView.test.tsx |
| R-13 | T04, T06, T09, T10 | tests/renderer/app.test.tsx |
| R-14 | T04, T10 | manual (resize the window to under 1100 px and under 700 px) |
| R-15 | T09, T10 | tests/renderer/accountsView.test.tsx, tests/renderer/teamView.test.tsx |
| R-16 | all UI tasks | manual: side-by-side with the mockups at 1440x1260 / 1440x1900 |
| R-17 | T05 | tests/main/ipcHandlers.test.ts (handlers import only mock); manual grep for `fetch(`/`https://` in src |
| R-18 | T01, T03 | tests/sanity.test.ts (asserts index.html CSP has no remote origins); manual: grep `out/` for `http`s URLs, run the built app with network disabled |

## Test strategy
- Automatic (vitest): status derivation rules (one case per rule, plus ordering), the format helpers, mock data invariants (ids unique, every agent has events, the derived status of each mock agent equals the mockup status, counters are 6 / 3 / 1 / 1.12M, every worktree agentId exists), the IPC contract (every channel is unique and every ConsoleApi method maps to a channel), main handler registration and responses, store actions and selectors, render tests of each section and both screens (key texts, click selects an agent, tab switching, raw-terminal toggle shows the placeholder, sign-in flow steps, navigation).
- xterm is never mounted in jsdom tests. The RawTerminalPane test mocks `@xterm/xterm` with `vi.mock`.
- Manual: visual match to the mockups, responsive collapse, keyboard focus order and visible focus, reduced motion, `npm run dev` launches, and contrast of the faint text tokens.

## Risks
- **node-pty native build on Windows** (needs VS Build Tools / Python). It is in `optionalDependencies` and not imported, so `npm install` must succeed even if the build fails. Early check: T01 runs `npm install` and records whether node-pty built, then reports to the user without blocking.
- **Sandboxed preload with electron-vite**: a sandboxed preload cannot `require` local chunks. Early check: T01 runs `npm run build`, confirms `out/preload/index.js` (or `.cjs`) has no `require("./` of chunks, and `npm run dev` shows `window.api` defined in DevTools.
- **Version drift** (electron-vite major, vitest 3 vs 4, @testing-library/react 16 with React 18). Early check: T01 picks versions with `npm view <pkg> version peerDependencies` and pins exact versions. typecheck plus the sanity test must pass before handoff.
- **Fonts**: @fontsource CSS imports must resolve through Vite in the renderer, and the CSP must allow `font-src 'self' data:`. Early check: T03 runs `npm run build` and greps `out/renderer` for `.woff2` files and for no `fonts.googleapis`.
- **Contrast**: mockup faint text (#6E7580 timestamps on #0B0C0E, #5C636E separators) is near or below 4.5:1. T03 nudges these tokens up (see T03 Notes). Checked by hand.
- **Stub replacement**: wave-4 tasks must keep the export names and props from T04 Notes, or TeamView breaks. Early check: each wave-4 task runs `npm run typecheck`.

## Assumptions and spec gaps
- ASSUMPTION (status rules): spec.md states the derived-status rules only loosely. T02 Notes fix exact rules, including a 60 s "recent activity" window and `status` events with `result` in {blocked, idle, waiting} or {permission, notification}. Phase 3/4 must verify these against real hook and transcript payloads.
- SPEC GAP (usage): the accounts mockup shows usage % bars ("Current session 42%", "This week 61%"), but the spec says "Do not fake limit percentages". The plan follows the spec. The usage bars are dropped, and a "Tokens today" line (mock values) replaces them. Plan is hidden when unknown: the mockup's "[COMPANY PLAN]" placeholder is treated as unavailable.
- ASSUMPTION (folder rules): the spec puts `folderRules[]` on each profile, but the UI shows one ordered table. The plan keeps `AccountProfile.folderRules` per spec and adds an ordered `AccountsSnapshot.rules` list, ending with an "Ask me" fallback.
- ASSUMPTION: unwired buttons (Pause all, + New teammate, Compare diffs, Add worktree, Scan again, Add account, Add rule, Rename & color, Sign in again, Open browser again) are real focusable buttons. They call the matching IPC stub where one exists and otherwise do nothing in Phase 1.
- ASSUMPTION: the mockup's initial Accounts state is used, with Company detected but not yet linked ("Use this") and Personal needing sign-in. The default account is Company and the selected agent is backend-impl.

## Later
- Phase 2: account detection (`~/.claude*`, `.claude.json` display fields, VS Code settings scan), profiles in userData, folder rules matching, launching `claude` in node-pty with `CLAUDE_CONFIG_DIR`, a real sign-in flow, and a real xterm raw terminal attached to the lead pty. Also run electron-rebuild for node-pty.
- Phase 3: chokidar transcript watcher and incremental JSONL parser into AgentEvent, plus the lead / teammate tree feeding the cards, inspector and console live. Parser tests.
- Phase 4: hook installer with a JSON preview and Uninstall, a 127.0.0.1 event server with a per-launch token, and the `agent-console-hook` script. Tests.
- Phase 5: git worktree / status / rev-list / diff polling, overlap detection with tests, and real timeline swimlanes.
- Phase 6: empty and error states, keyboard shortcuts, Windows packaging, and the README.
