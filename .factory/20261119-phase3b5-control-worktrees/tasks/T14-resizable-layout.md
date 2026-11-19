# T14 - Everything resizable: horizontal splitters, persisted heights, Dialog primitive

- Wave: 5
- Depends on: none (uses existing Splitter/usePanelWidths)
- Spec refs: R-13, request part D
- Tests: tests/renderer/splitter.test.tsx, tests/renderer/teamLayout.test.tsx, tests/renderer/dialog.test.tsx

## Goal
Add horizontal splitters between agent grid / timeline / lead console (center), worktrees / shared tasks (left) and
inspector top / tab panel (right), with the same mouse, keyboard, ARIA and persistence behaviour as the existing
column splitters. Also add a shared accessible `Dialog` used by T16/T17.

## Owned files
- modify: src/renderer/src/components/layout/Splitter.tsx
- modify: src/renderer/src/components/layout/splitter.css
- create: src/renderer/src/hooks/usePanelHeights.ts
- create: src/renderer/src/components/ui/Dialog.tsx
- create: src/renderer/src/store/useLayoutStore.ts (column collapse state, UX pushback item)
- modify: src/renderer/src/screens/TeamView.tsx
- modify: src/renderer/src/screens/TeamView.css
- modify: src/renderer/src/components/inspector/Inspector.tsx (layout props only, see Notes)
- modify: tests/renderer/splitter.test.tsx
- create: tests/renderer/teamLayout.test.tsx
- create: tests/renderer/dialog.test.tsx
- modify (only if broken by the layout change): tests/renderer/teamView.test.tsx, tests/renderer/inspector.test.tsx
  (NOT teamCenter/teamLive tests: T15 owns them this wave; keep LeadConsole/AgentGrid/Timeline markup untouched)

## Read-only context
- src/renderer/src/hooks/usePanelWidths.ts (pattern: clamp, localStorage try/catch, sanitize)
- src/renderer/src/components/inspector/Inspector.tsx (find the "top section" vs tab panel boundary)
- src/renderer/src/components/team/LeadConsole.tsx, AgentGrid.tsx, Timeline.tsx, WorktreeList.tsx, SharedTaskList.tsx

## Notes
- Splitter: new optional prop `orientation?: 'vertical' | 'horizontal'` (default 'vertical' = today). `side` widens to
  `'left' | 'right' | 'top' | 'bottom'` ('top' = the controlled pane is above the handle, grows with ArrowDown;
  'bottom' = below, grows with ArrowUp). Horizontal uses clientY, `aria-orientation="horizontal"`, row-resize cursor.
  Existing vertical behaviour and tests unchanged.
- usePanelHeights: `STORAGE_KEY = 'ac.panelHeights'`; panes and limits: `grid` (top of center, min 120, default 45% of
  center), `console` (bottom of center, min 120, default 240), timeline gets the rest (min 60); `worktrees` (top of
  left, min 80, default 50%); `inspectorTop` (top of right, min 120, default 260). Heights are px, clamped against the
  measured container height (ResizeObserver; jsdom fallback: window.innerHeight) so the other panes keep their mins.
  Returns `{ values, max(key), set(key, v), def(key) }`.
- TeamView: `.ac-team` becomes `height: 100vh` with columns filling the rest; each pane scrolls internally
  (`overflow: auto`, `min-height: 0`). Center: OverlapBanner (auto) + grid pane + splitter(top, controls grid) +
  timeline pane + splitter(bottom, controls console) + console pane. Left: WorktreeList pane + splitter + SharedTaskList.
  Right: Inspector gets two optional props `topHeight?: number` and `splitter?: ReactNode` and renders
  `[top section (header, stats, task, worktree, actions) with height topHeight, overflow auto][splitter][tabs + tab panel, flex 1]`.
  The splitter element and height state live in TeamView. This is the only Inspector.tsx change in T14 (T17 edits
  the actions in wave 6 and must keep these two props).
- Column collapse: `useLayoutStore` `{ leftCollapsed, rightCollapsed, toggleLeft(), toggleRight() }` persisted in
  localStorage 'ac.collapsed' (try/catch). Collapsed column renders a 32 px strip with an expand button
  (aria-expanded) and hides its splitter; the center grows. T18 binds Ctrl+B / Ctrl+I to the toggles.
  TeamView leaves a `<div className="ac-team__rail-slot" />` as the first column (empty, zero width) where T22
  mounts the project rail.
- Narrow windows (< 900 px wide): columns still wrap; vertical splitters hidden like today; horizontal splitters keep working.
- Dialog.tsx: `<Dialog open title onClose initialFocus? children footer?>` with `role="dialog"`, `aria-modal`,
  labelled by title, focus trap, Esc closes, restores focus to the opener, backdrop click closes; no portal library.
Tests: horizontal keyboard (ArrowUp/Down, Shift, Home/End, Enter reset, double-click reset), drag with clientY,
persistence round-trip, clamping to container, TeamView renders all splitters with labels ("Resize agent grid",
"Resize lead console", "Resize worktrees panel (height)", "Resize inspector details"), Dialog focus/Esc.

## Acceptance commands
- npm test -- tests/renderer
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
