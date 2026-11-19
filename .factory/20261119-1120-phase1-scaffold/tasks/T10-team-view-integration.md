# T10 - Team view integration, responsive pass, screen and app smoke tests

- Wave: 5
- Depends on: T04, T06, T07, T08
- Spec refs: R-13, R-14, R-15, R-16, R-18
- Tests: tests/renderer/teamView.test.tsx, tests/renderer/app.test.tsx

## Goal
Make the assembled Team view behave as one screen:
- The column layout collapses cleanly on narrow windows.
- Keyboard focus order is sensible.
- Smoke tests render the whole Team view and the App navigation.

This task also runs the final offline / no-remote-asset check for Phase 1.

## Owned files
- modify: src/renderer/src/screens/TeamView.tsx
- modify: src/renderer/src/screens/TeamView.css
- create: tests/renderer/teamView.test.tsx
- create: tests/renderer/app.test.tsx

## Read-only context
- docs/design/team-view.mockup.html lines 381-614 (whole page), 410-412 / 448 / 538 (flex-basis values)
- every component under src/renderer/src/components/team and src/renderer/src/components/inspector (do not modify them)
- src/renderer/src/App.tsx, src/renderer/src/store/useConsoleStore.ts

## Notes
- Do not modify any section component. If a section breaks the integration, report it as a FIX for the owning task: T06, T07 or T08.
- Responsive rules, in TeamView.css:
  - Keep the mockup's flex-basis values (240 / 560 / 360).
  - Below 1100px wide, the inspector wraps under the center column at full width. Use `border-left: 0` and `border-top: 1px solid var(--ac-border)` there.
  - Below 760px, the left column also takes full width, with `border-right: 0` and a `border-bottom`.
  - The header wraps (it already uses flex-wrap in T06).
  - The center column must never cause horizontal page scroll; the timeline scrolls internally.
- Add a visually hidden "Skip to agents" link as the first element. It targets the AgentGrid section, with an `id="ac-agents"` wrapper placed in TeamView around `<AgentGrid/>`.
- **teamView.test.tsx** (jsdom):
  - Mock xterm as in T07, call `resetConsoleStore()`, and render `<TeamView/>`.
  - Assert the key texts from every section: 'Agent Console', 'Worktrees', 'Shared tasks', 'File overlap:', 'Team', 'lead', 'api-designer', 'backend-impl', 'ui-builder', 'test-writer', 'reviewer', 'Timeline', 'Lead console', 'Assigned task', 'Message agent' and 'Stop'.
  - Status labels: 'Running' appears at least 3 times, and 'Waiting', 'Needs you' and 'Done' appear.
  - Click the ui-builder card: the inspector shows '#4 Sheet panel UI'.
- **app.test.tsx** (jsdom):
  - Render `<App/>` with `window.api` undefined. It renders the Team view without errors.
  - Click the account chip (role button, name /Account: Company/): 'Claude accounts' is shown.
  - Click 'Team view': the Team view is back.
  - With `window.api` set to a stub whose `team.getSnapshot` resolves to a modified snapshot (teamName 'from-ipc'), 'team: from-ipc' appears after waiting.
- Final checks, to record in the report:
  - Run `npm run build`, then grep `out/` for `https://` and `fonts.g`. List any hits.
  - Grep `src/` for `fetch(`, `http://` and `https://`.
  - Check that `src/main/index.ts` loads the dev URL only when not packaged.
  - Manually resize the window to 1440, 1000 and 700 px wide.

## Acceptance commands
- npm test
- npm run typecheck
- npm run build

## Done when
- The full test suite, typecheck and build pass.
- The grep results are reported.
- A manual side-by-side with team-view.mockup.html at 1440x1260 is noted.
- Only owned files changed.
