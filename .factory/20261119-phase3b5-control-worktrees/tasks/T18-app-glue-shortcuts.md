# T18 - App glue: store init, project -> git watch, needs-you merge, keyboard shortcuts

- Wave: 7
- Depends on: T12, T14, T15
- Spec refs: R-05, R-20 (shortcuts), spec Phase 6 "keyboard shortcuts"
- Tests: tests/renderer/shortcuts.test.tsx, tests/renderer/store.test.ts, tests/renderer/app.test.tsx

## Goal
Initialise the new stores, keep the git watcher on the selected project, fold pending permission prompts into the
team's needs-you status, and add the D12 keyboard shortcuts with a help overlay.

## Owned files
- modify: src/renderer/src/App.tsx
- modify: src/renderer/src/store/useConsoleStore.ts
- create: src/renderer/src/hooks/useShortcuts.ts
- create: src/renderer/src/components/ui/ShortcutsHelp.tsx
- create: tests/renderer/shortcuts.test.tsx
- modify: src/renderer/src/components/team/LeadConsole.tsx, src/renderer/src/components/team/AgentGrid.tsx (scroll-memory ref + console filter persistence only)
- modify: tests/renderer/store.test.ts, tests/renderer/app.test.tsx (new cases; fix only cases broken by the change)

## Read-only context
- src/renderer/src/store/{useControlStore,useWorkspaceStore}.ts (T12), src/renderer/src/components/ui/Dialog.tsx (T14)
- src/renderer/src/components/team/LeadConsole.tsx (T15: `#ac-prompt`), plan.md Decision D12

## Notes
- App.tsx: call `useControlStore.getState().init()` and `useWorkspaceStore.getState().init()` once (cleanup on
  unmount); effect: selected project -> `watch(root)` where root = the current `SessionProject.root` when `git` is
  true, else the team `cwd` (git may still answer) or null in demo. Mount `useShortcuts()` and `<ShortcutsHelp/>`.
- useConsoleStore: `submitConsole` keeps demo behaviour only and no longer calls `window.api.agent.sendMessage`
  (live sending moved to LeadConsole/T15). Add selector `selectNeedsYouCount(state, pendingByControl)` or a hook
  `useNeedsYouCount()` that adds the control store's pending prompts for the controlled session to the agent
  needs-you count (header uses it - T17 reads `selectPendingPermissionCount` directly, so just export the merged
  helper and use it in the existing counter selector if one exists here). Add `shortcutsOpen: boolean` +
  `setShortcutsOpen(v)`. Add `selectAdjacentAgent(dir: 1 | -1)` action (tree order, wraps).
- **UX M5 per-project view state:** `perProject: Record<projectKey, { selection: TeamSelection; selectedAgentId:
  string; inspectorTab: InspectorTab; consoleDraft: string; consoleFilter: string; scroll: { console: number; grid:
  number } }>`, saved on change and restored by `setProject(key)`; persisted to localStorage 'ac.viewState'
  (try/catch, max 50 projects). Export `useScrollMemory(kind: 'console' | 'grid')` (ref callback restoring/saving
  scrollTop for the current project) and wire it into LeadConsole.tsx and AgentGrid.tsx.
  **Auto never switches under the user:** when the console draft becomes non-empty (or a permission card / inbox row
  has focus) while selection is auto, call `selectSession({mode:'session', accountId, sessionId})` for the current
  session and set `autoHeld`; when the draft is sent/cleared (and no card focused), restore `{mode:'auto', projectKey}`.
  Test both transitions and that the project switch restores agent/tab/draft.
- useShortcuts (single keydown listener on window; ignore when `event.isComposing`; text inputs only receive Ctrl
  combos and Esc): Ctrl+L focus `#ac-prompt`; Ctrl+Shift+T / Ctrl+Shift+A navigate team / accounts; Ctrl+B / Ctrl+I toggle the
  left / right column (useLayoutStore, T14); Ctrl+` toggle raw terminal;
  Ctrl+. interrupt the controlled session bound to the team (via useControlStore; no-op otherwise; **never sends**);
  Alt+ArrowUp / Alt+ArrowDown previous / next agent; `?` outside inputs opens help; Esc closes help. Export the table
  `SHORTCUTS: { keys: string; action: string }[]` (used by help and README in T19). It also lists T22's keys
  (Ctrl+K switcher, Ctrl+1..9 pinned projects, Ctrl+J / Ctrl+Shift+J next/previous needs-you, inbox A/D/Enter/Esc),
  which T22 binds in its own listener - do not bind them here.
- ShortcutsHelp: Dialog listing SHORTCUTS with `<kbd>`.
Tests: each shortcut dispatches the right action, typing in an input does not trigger `?`/Alt shortcuts, Ctrl+. calls
interrupt only when busy, help opens/closes, App inits stores and watches the project root (mocked api).

## Acceptance commands
- npm test -- tests/renderer
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.
