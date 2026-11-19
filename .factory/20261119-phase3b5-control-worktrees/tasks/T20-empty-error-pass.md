# T20 - Empty states and error messages pass

- Wave: 8
- Depends on: T15, T16, T17, T18, T22
- Spec refs: R-20, spec Phase 6 "empty states and error messages"
- Tests: tests/renderer/emptyStates.test.tsx

## Goal
One consistent, accessible error/empty presentation across the new surfaces, with plain-language messages for every
failure reason the main process returns.

## Owned files
- create: src/renderer/src/components/ui/ErrorBanner.tsx
- create: src/renderer/src/components/ui/reasonText.ts
- modify: src/renderer/src/components/team/AgentGrid.tsx (also UX S3)
- modify: src/renderer/src/components/team/AgentCard.tsx (UX S3 compact row + shortened target)
- modify: src/renderer/src/components/team/LeadConsole.tsx
- modify: src/renderer/src/components/team/WorktreeList.tsx
- modify: src/renderer/src/components/team/HooksDialog.tsx
- create: tests/renderer/emptyStates.test.tsx
- modify (only assertions on copy you changed): tests/renderer/{leadControl,workspacePanels,hooksDialog,teamCenter,teamLive,teamView}.test.tsx

## Read-only context
- src/renderer/src/components/accounts/* (existing error banner styling to match), src/renderer/src/components/ui/ui.css
- All reason strings: T01 types (LaunchBlock, ControlStartResult.reason), T07 ('claude-not-found', 'spawn-failed'),
  T10 ('app-owned', 'not-registered', 'not-running', 'unexpected-process', 'invalid-path', 'opened-folder',
  'no-project', 'node-not-found', 'invalid-json'), T04 ('changed-since-preview', 'expired', 'nothing-to-do',
  'not-object'), T13 ('session-live-elsewhere', 'nothing-running').

## Notes
- `reasonText(reason?: string): string` maps every reason above to one sentence with the next step (e.g.
  'node-not-found' -> "Node.js was not found on PATH. Install Node 18+ to use hooks, then reopen this dialog.");
  unknown -> "Something went wrong (<reason>)."
- `ErrorBanner({ message, onDismiss?, action? })`: `role="alert"`, dismiss button with aria-label, danger tokens,
  contrast >= 4.5:1.
- Apply: LeadConsole control errors/notices of level error + start failures; WorktreeList workspace.error and
  per-card errors (short) with the full text in title; HooksDialog hooksError + status reason; AgentGrid live empty
  state copy ("No agents yet - start a session or pick one above") and waiting-for-session copy. Do not change
  behaviour or layout otherwise.
UX S3 (grid that scales): AgentGrid sorts by need (needs-you, running, waiting, done; tree indent kept), collapses
finished sub-agents into one row "N done · X tok · Show" (expands inline), and a density toggle Comfortable /
Compact (compact = one 32 px row: status dot, name, current tool + shortened target, tokens, elapsed), persisted in
localStorage 'ac.gridDensity'. Keep T18's scroll-memory ref.
Tests: reasonText covers every listed reason (table test, no fallback text for known reasons); banners render with
role alert and dismiss; each surface shows the mapped message for a mocked failure.

## Acceptance commands
- npm test -- tests/renderer
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.
