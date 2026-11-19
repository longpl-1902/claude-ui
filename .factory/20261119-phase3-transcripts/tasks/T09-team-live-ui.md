# T09 - Team view live UI: session picker, LIVE/DEMO badge, empty state, live cards and console, Phase 5 placeholders

- Wave: 4
- Depends on: T07 (store: teamMode, sessions, selection, showDemo/exitDemo/selectSession, useAgentStatusInfo)
- Spec refs: R-12; spec Screen 1 header, center column, lead console
- Tests: tests/renderer/teamLive.test.tsx (create), tests/renderer/teamSections.test.tsx (header cases only)

## Goal
The Team view works on live data. The header shows which session is shown and lets the user pick another one or go back to Auto.
A LIVE or DEMO badge makes the data source obvious. With no session there is a clear empty state with "Show demo data". Agent cards
appear in tree order with a status tooltip. The lead console streams the live events. Phase 5 sections show placeholders instead of fake data in live mode.

## Owned files
- modify: src/renderer/src/components/team/TeamHeader.tsx
- modify: src/renderer/src/components/team/AgentGrid.tsx
- modify: src/renderer/src/components/team/LeadConsole.tsx
- modify: src/renderer/src/components/team/WorktreeList.tsx, SharedTaskList.tsx, Timeline.tsx (live-mode placeholder only)
- modify: src/renderer/src/components/team/teamCenter.css (and teamLeft.css if needed for the placeholder style)
- create: tests/renderer/teamLive.test.tsx
- modify: tests/renderer/teamSections.test.tsx (only cases broken by the header change)

## Read-only context
- src/renderer/src/store/useConsoleStore.ts (after T07), src/shared/types.ts, src/shared/liveStatus.ts, src/shared/format.ts
- docs/design/team-view.mockup.html (keep the visual language), src/renderer/src/components/ui/*

## Notes
- **Header:** keep the existing layout, chip and counters. After the team name, add:
  - A badge `LIVE` (accent) when `team.source === 'live'`, or `DEMO` (muted, with the text "demo data") when teamMode is 'demo'. Nothing when empty.
  - A native `<select aria-label="Session">`: the first option "Auto (latest)" (value `auto`), then one option per `sessions` entry:
    `${title ?? sessionId.slice(0,8)} · ${basename(cwd ?? projectDir)} · ${relative mtime}` and ` · live` when `live`. The value is `${accountId}|${sessionId}`.
    onChange -> `selectSession(...)`. The selected value comes from the store `selection`. The repo/team name shows `team.repo`/`team.teamName` (both already exist).
  - In demo mode, a "Back to live" button -> `exitDemo()`.
  - `historyTruncated` -> a small muted note "older history not loaded".
- **Grid empty states** (`team.agents.length === 0` and teamMode 'live'):
  - `team.waitingForSession` -> "Waiting for the session to start… Claude writes its transcript after the first prompt."
  - Otherwise: "No Claude Code session found" with one line of help ("Start `claude` from the Raw terminal, or open a project in VS Code with Claude Code.") and a
    `Show demo data` button -> `showDemo()`.
  - It is a real `<button>`, keyboard reachable, with visible focus (the existing Button component).
- **Cards:** keep AgentCard unchanged. AgentGrid renders `team.agents` in the given order (main already sends tree order). Wrap each card in a container with
  `title={reason}` from `useAgentStatusInfo(agent.id)` and `style={{ marginLeft: depth ? 12 * min(depth, 3) : 0 }}` only in live mode
  (or a CSS class `ac-card--child`, the implementer's choice, with no layout jump in the auto-fill grid; a left border accent is fine).
- **Lead console:** it already renders `team.console`. Add a muted hint next to the prompt input in live mode: "Sending prompts arrives in Phase 3b". The input
  stays enabled (the existing behaviour). Auto-scroll to the newest line when the user is already at the bottom (do not steal the scroll otherwise).
- **Phase 5 placeholders:** in live mode (`team.source !== 'demo'`), WorktreeList/SharedTaskList/Timeline render their heading plus a muted line
  "Worktrees arrive in Phase 5" / "Shared tasks arrive in Phase 5" / "Timeline arrives in Phase 5". In demo mode they render exactly as today.
  OverlapBanner already renders nothing for an empty `overlaps` (verify; do not modify).
- Tests (teamLive.test.tsx) with a mocked `window.api` and the store seeded with a small live snapshot built inline (2-3 agents with runtime):
  the badge, the picker options and the onChange call, the empty state plus the demo button switching to DEMO and back, the waiting state, the placeholders in live
  mode and the mock sections in demo, the console lines, and the status tooltip text.
- Tests may use `!` for `noUncheckedIndexedAccess`.

## Acceptance commands
- npm test -- tests/renderer/teamLive.test.tsx tests/renderer/teamSections.test.tsx tests/renderer/teamCenter.test.tsx tests/renderer/teamView.test.tsx
- npm run typecheck
- npm test

## Done when
- All acceptance commands pass
- Only owned files changed
