# T22 - Project rail, global "Needs you" inbox, quick switcher

- Wave: 7
- Depends on: T01, T12, T13, T14, T17, T21
- Spec refs: R-22, R-23, R-25 (UX M1, M2, S1 keyboard part)
- Tests: tests/renderer/projectRail.test.tsx, tests/renderer/inbox.test.tsx, tests/renderer/attentionStore.test.ts

## Goal
A slim project rail (replaces the header Project `<select>`) with per-project worst-state badges, account stripe and
pins; a header "N need you" button opening a global inbox with honest actions; a Ctrl+K project switcher and
Ctrl+1-9 / Ctrl+J navigation.

## Owned files
- create: src/renderer/src/store/useAttentionStore.ts
- create: src/renderer/src/components/rail/ProjectRail.tsx
- create: src/renderer/src/components/rail/NeedsYouInbox.tsx
- create: src/renderer/src/components/rail/ProjectSwitcher.tsx
- create: src/renderer/src/components/rail/rail.css
- modify: src/renderer/src/screens/TeamView.tsx (mount the rail as the first column; nothing else)
- modify: src/renderer/src/components/team/TeamHeader.tsx (remove the Project select, add the inbox button + global tokens figure)
- create: tests/renderer/projectRail.test.tsx, tests/renderer/inbox.test.tsx, tests/renderer/attentionStore.test.ts
- modify (header cases broken by the change only): tests/renderer/teamSections.test.tsx

## Read-only context
- src/renderer/src/store/{useConsoleStore,useControlStore,useLayoutStore}.ts; T18 runs in parallel and makes
  `setProject(key)` restore per-project view state - call only `setProject`, `selectSession`, `selectAgent`.
- src/shared/types.ts (AttentionSnapshot, AttentionItem, ProjectStatus), plan.md "UX debate", D13-D16

## Notes
- useAttentionStore: `{ snapshot, pins: string[] (localStorage 'ac.pinnedProjects', try/catch), prefs, init(),
  pin(key), unpin(key), mute(key, on), setDnd(on), focusItem(id) }`; `init` subscribes `attention.onChanged` and
  `attention.onFocus` (notification click -> focusItem). `ProjectRail` calls `init()` in a mount effect (App.tsx is T18's file this wave). `focusItem`: `setProject(item.projectKey)`, then
  `selectSession({mode:'session', accountId, sessionId})` only if that session is not already viewed, then
  `selectAgent(agentId)`. Also pushes `viewedProjectKey` to main via `attention.setPrefs` whenever the project changes.
- ProjectRail: collapsible (56 px icons / 200 px, toggled by its own button; width persisted 'ac.railExpanded');
  rows: initials avatar, name, left account stripe (account colour; split stripe + warning icon when
  `mixedAccounts`), badge worst-state-wins: red needs-you count > amber running (pulse only when reduced-motion is
  off) > blue waiting > none; hover/title: live sessions, running, tokens today. Order: pinned (fixed order), then
  others by lastActivity **frozen while the pointer is over the rail** (no jumping); no-live + idle > 24 h under a
  collapsed "Idle (n)". Click switches project; context menu (also via Shift+F10 / menu key): Pin/Unpin, Mute
  notifications, Open in VS Code (`worktree.openInEditor(root)`). `role="navigation"`, list with aria-current.
- NeedsYouInbox: header button `● N need you` (count = all items, global; red when > 0, `aria-haspopup="dialog"`);
  popover lists items oldest first: project, account dot, agent, reason text, waiting time ("12m", ticking with
  nowMs). Actions: app-controlled permission -> **Allow**, **Allow for this session** (only when
  `canAllowSession`), **Deny** via `useControlStore.answer` (does not switch project); question/plan of a controlled
  session -> **Go to** (answering happens in the lead console); external -> **Go to** + **Open in VS Code** with the
  label "external - answer in VS Code or its terminal". Keyboard: rows focusable, A allow / D deny on the focused row
  only, Enter go to, Esc close. DND toggle at the bottom.
- Header: the old session-scoped counter is labelled "in this session"; add "Tokens today: X" (all accounts, from
  usageToday) with per-project breakdown in its title (from rail data).
- ProjectSwitcher (Ctrl+K): Dialog with a filter input over projects (name/root) and their live sessions; Enter
  switches. Own keydown listener for Ctrl+K, Ctrl+1..9 (pinned order), Ctrl+J / Ctrl+Shift+J (next/previous
  attention item -> focusItem). Ignore when `event.isComposing`.
- Never auto-switch the viewed project on new items (UX rule); never auto-answer.
Tests: badge precedence, pin order stable, idle group, mixed-account warning, inbox actions per ownership (no Allow
for external), Allow calls answer without switching project, focusItem flow, Ctrl+K/1-9/J.

## Acceptance commands
- npm test -- tests/renderer
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum (final UX decisions)
See plan.md "Final decisions after the UX rebuttal" F1–F4 — items assigned to T22 are part of this task's scope and acceptance.

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.

## Addendum (orchestrator)
Also implement the <1100px merged left drawer (rail + worktrees/tasks) that T14 left undone — see orchestrator-notes.md.
