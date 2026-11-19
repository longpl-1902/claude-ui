# T06 - Team header, Worktrees list, Shared tasks

- Wave: 4
- Depends on: T04
- Spec refs: R-08, R-09, R-13, R-16
- Tests: tests/renderer/teamSections.test.tsx

## Goal
Replace the T04 stubs for TeamHeader, WorktreeList and SharedTaskList with components that match the mockup, driven by the store.

## Owned files
- modify: src/renderer/src/components/team/TeamHeader.tsx
- modify: src/renderer/src/components/team/WorktreeList.tsx
- modify: src/renderer/src/components/team/SharedTaskList.tsx
- create: src/renderer/src/components/team/teamLeft.css (styles for the header and the left column)
- create: tests/renderer/teamSections.test.tsx

## Read-only context
- docs/design/team-view.mockup.html lines 383-408 (header), 412-446 (left aside: Worktrees 413-432, Shared tasks 434-445), 693-707 (worktree and task display values)
- src/renderer/src/store/useConsoleStore.ts (API in T04 Notes)
- src/renderer/src/components/ui/*, src/renderer/src/theme/colors.ts, src/renderer/src/styles/tokens.css
- src/shared/format.ts

## Notes
- Keep the export names and the no-props signatures from T04.
- **TeamHeader** (`<header className="ac-header">`):
  - border-top is 3px, in the active account's color. Use `selectActiveAccount(s).color`, applied when `accounts.safety.showAccountColorEdge` is true; otherwise use `--ac-border`.
  - Contents, in order:
    - TerminalIcon in accent, then "Agent Console" (700, 15px).
    - Mono `{repo}` / `team: {teamName}`.
    - The account chip, a `<button>`: circle avatar with the initial, the account name and the email in subtle text, then ChevronDown. Its aria-label is `Account: {name}. Manage accounts`, and `onClick={() => navigate('accounts')}`.
    - A spacer.
    - Counters from `useTeamCounters()`: "6 agents", "3 running" (running color), "1 needs you" (needs-you color), "Tokens 1.12M".
    - Buttons: "Pause all" (secondary; calls `window.api?.team.pauseAll()`) and "+ New teammate" (primary, no-op).
- **WorktreeList**:
  - An h2 "Worktrees" (11px uppercase, letter-spacing 1px, muted), plus an icon Button "+" with aria-label "Add worktree".
  - One card per worktree:
    - BranchIcon and the branch in mono 12px 500, with ellipsis.
    - The path in mono 11px subtle.
    - A meta row: agent names joined ', ' (map agentIds to names), ' · ', then the state.
  - State text:
    - With `overlapsWith`: `overlaps {overlapsWith[0]}`, in running/amber color, and the card border uses `--ac-warn-border` (#5A3E1E).
    - With `changedFiles === 0`: 'clean' in the done color.
    - Otherwise: `{n} file(s) · ↑{ahead}` in text-soft. Use singular 'file' for 1, and omit ' · ↑0'.
- **SharedTaskList**:
  - An h2 "Shared tasks".
  - Each row: a 10px square with radius 3 and a 1.5px border in the state color; filled when done. Then the title `#{id} {title}` at 13px, and a meta line at 11px.
  - Meta per state:
    - done: `Done · {owner}` (subtle).
    - in_progress: `In progress · {owner}`; square in the running color.
    - blocked: `Blocked by #{blockedBy} · {owner}`; waiting color for both the square and the meta.
    - failing: `{failingCount} failing · {owner}`; needs-you color.
  - The owner is the agent name.
  - Render as a `<ul>` list.
- Use CSS classes in teamLeft.css. Use inline style only for data colors.
- Test (jsdom):
  - Call `resetConsoleStore()`, then render each component.
  - Expect the texts 'Agent Console', 'acme/sheet-automation', 'team: sheet-export', 'you@company.com', '6' and 'agents', '1.12M', 'Pause all', '+ New teammate', 'feat/api-schema', 'overlaps feat/api-schema', 'clean', '#4 Sheet panel UI', 'Blocked by #2 · ui-builder' and '2 failing · test-writer'.
  - Clicking the account chip sets the store screen to 'accounts'.

## Acceptance commands
- npm test -- tests/renderer/teamSections.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass.
- A manual visual check against mockup lines 383-446 is noted in the report.
- Only owned files changed.
