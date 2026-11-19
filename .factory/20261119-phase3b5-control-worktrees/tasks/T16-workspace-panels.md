# T16 - Worktree cards, overlap banner + Compare diffs, shared tasks, timeline swimlanes

- Wave: 6
- Depends on: T03, T09, T12, T14
- Spec refs: R-09, R-10, R-11, R-12, spec "Left column" / "Center column"
- Tests: tests/renderer/workspacePanels.test.tsx

## Goal
Replace the Phase 5 placeholders with live data: worktree cards (branch, path, agents, changed files, ahead/behind,
amber when overlapping), the overlap banner naming file + agents with "Compare diffs", the shared task list with
states, and per-agent timeline swimlanes over the last 20 minutes with a legend. Demo mode keeps the mock rendering.

## Owned files
- modify: src/renderer/src/components/team/WorktreeList.tsx
- modify: src/renderer/src/components/team/SharedTaskList.tsx
- modify: src/renderer/src/components/team/Timeline.tsx
- modify: src/renderer/src/components/team/OverlapBanner.tsx
- create: src/renderer/src/components/team/CompareDiffsDialog.tsx
- modify: src/renderer/src/components/team/teamLeft.css
- create: tests/renderer/workspacePanels.test.tsx
(Do NOT edit tests/renderer/teamSections.test.tsx - T17 owns it this wave: demo-mode worktree/task rendering must
keep its current text/markup so those cases pass unchanged. tests/renderer/teamLive.test.tsx is frozen this wave.)

## Read-only context
- src/renderer/src/store/useWorkspaceStore.ts (`selectWorktreeViews`, compare), useConsoleStore.ts (team, nowMs, teamMode, selectAgent)
- src/renderer/src/components/ui/Dialog.tsx (T14), src/shared/types.ts, mockups docs/design/team-view.mockup.html

## Notes
- Live data source: `team` for tasks/spans/agents; `workspace` for worktrees via `selectWorktreeViews(workspace,
  team.agents, platform)`. Demo: `team.worktrees/overlaps/tasks/agents[].timeline` as today.
- WorktreeList: card per worktree (main first): branch (mono), short path (title = full path), agent avatars (click
  selects the agent), "N changed", "+ahead / -behind" (hidden when null), error text in muted red, amber border +
  "overlaps <branches>" when `overlapsWith` non-empty; "Open" button -> `window.api.worktree.openInEditor(path)`.
  Empty: no git project -> "Pick a git project to see worktrees"; loading -> skeleton text.
- OverlapBanner: one banner listing up to 3 files ("src/a.ts changed in feat/x (Alice) and feat/y (Bob)") + "+N more";
  "Compare diffs" -> `openCompare(path)` for the first file (a select inside the dialog switches files).
  CompareDiffsDialog: Dialog with one column per worktree diff (mono, `+`/`-` coloured lines, "truncated" note),
  loading/error states; Esc closes.
- SharedTaskList: rows `#id title`, owner name, state pill: done (green), in progress (blue), pending ("to do", muted),
  blocked ("blocked by #n", amber), failing ("failing ×n", red). Sorted: in progress, failing, blocked, pending, done.
  Empty live: "No tasks in this session (TaskCreate / TodoWrite)".
- Timeline: one lane per agent (tree order), segments from `agent.spans` with pct over [nowMs - 20 min, nowMs]
  (open spans end at nowMs), legend think/read/edit/bash/wait/error with the existing colour tokens, ticks every 5 min
  (`-20m … now`), segment title "<kind> 12:03:10-12:03:40". `prefers-reduced-motion` respected (no transitions).
  Empty: "No activity in the last 20 minutes".
  UX S3: lanes only for the lead + agents not done (and any needs-you); finished agents collapse into one row
  "N finished" with a "Show finished" toggle (default off). Worktree card paths use `shortenPath` (T02).
- Keep all panels keyboard reachable; buttons are real `<button>`s.
Tests: cards with agents/ahead/behind/error, overlap amber + banner text + compare dialog open/close (mock store),
task states and order, timeline pct maths with a fixed nowMs, demo mode still renders mock.

## Acceptance commands
- npm test -- tests/renderer/workspacePanels.test.tsx tests/renderer/teamSections.test.tsx tests/renderer/teamLive.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
