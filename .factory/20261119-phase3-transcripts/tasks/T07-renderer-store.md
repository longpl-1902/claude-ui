# T07 - Renderer store: live team, demo toggle, sessions, usage, ticking status

- Wave: 3
- Depends on: T01 (api and types, teamDefaults), T04 (deriveLiveStatus)
- Spec refs: R-07, R-11; plan Architecture "Empty vs demo"
- Tests: tests/renderer/store.test.ts, tests/renderer/app.test.tsx (this task owns them), plus the seed edits listed below

## Goal
The renderer stops showing mock agents as if they were real. The store starts with an empty live snapshot, hydrates from
`team:getSnapshot` and the `team:changed` push, keeps the session list and the selection, and merges tokens-today per account.
It derives statuses on a 5 s clock from `Agent.runtime` (falling back to the Phase 1 event derivation for demo data). Demo data
is only an explicit toggle.

## Owned files
- modify: src/renderer/src/store/useConsoleStore.ts
- modify: src/renderer/src/App.tsx
- create: tests/renderer/seedTeam.ts (test helper: `seedDemoTeam()` sets team = mock with `source: 'demo'`, teamMode 'demo', and selects 'be')
- modify: tests/renderer/store.test.ts, tests/renderer/app.test.tsx
- modify (seed lines in `beforeEach` only, plus `window.api` mock namespaces if needed): tests/renderer/teamView.test.tsx,
  tests/renderer/teamCenter.test.tsx, tests/renderer/inspector.test.tsx, tests/renderer/teamSections.test.tsx

## Read-only context
- src/shared/ipc.ts, src/shared/types.ts, src/shared/teamDefaults.ts, src/shared/liveStatus.ts, src/shared/status.ts, src/shared/mock/team.ts
- tests/renderer/seedAccounts.ts (the Phase 2 seed pattern)

## Notes
- New state: `teamMode: 'live' | 'demo'`, `liveTeam: TeamSnapshot` (the last live snapshot, kept while demo is shown), `sessions: SessionSummary[]`,
  `selection: TeamSelection` (default `{mode:'auto'}`), `usageToday: UsageToday | null`, `nowMs: number`.
- `initialData().team = structuredClone(EMPTY_TEAM_SNAPSHOT)` and `selectedAgentId = LEAD_ID`. The mock is never in the initial state.
- Actions (names exact):
  - `hydrateTeam(s)`: stores `liveTeam = s`. If teamMode is 'live', it also sets `team = s`. If selectedAgentId is not in `s.agents`, it selects `LEAD_ID` when
    present, else the first agent, else `LEAD_ID`.
  - `showDemo()`: `team = structuredClone(mockTeamSnapshot)` with `source:'demo'`, teamMode 'demo', and selects the first mock agent.
  - `exitDemo()`: teamMode 'live', `team = liveTeam`, and re-selects per the hydrate rule.
  - `refreshSessions()`: `api.transcripts.listSessions()` -> sessions.
  - `selectSession(sel: TeamSelection)`: sets selection, calls `api.transcripts.select(sel)`, then hydrateTeam(result), and exits demo.
  - `setSessions(list)`, `applyUsage(u)`, `tick(nowMs?)` (sets `nowMs = nowMs ?? Date.now()`).
  - Every api call is guarded like `callApi` (a missing api is a no-op; a rejection never throws; transcripts errors go to a new `teamError?: string`).
- `useAgentStatuses()`: for each agent, `agent.runtime ? deriveLiveStatus(agent.runtime, nowMs).status : deriveAgentStatus(team.events, agent.id, team.now)`.
  It is memoised on `[team, nowMs]`. Also add `useAgentStatusInfo(id): { status; reason?: string }`, where reason = `reasonLabel(...)` for live agents.
- `useTeamCounters()` keeps its shape.
- Selectors: `selectSelectedAgent` keeps the signature `(s) => Agent` but returns `PLACEHOLDER_AGENT` when the team has no agents (no `!` crash).
  Add `selectSelectedAgentOrNull(s): Agent | null`. Add `selectTokensToday(accountId): (s) => { headline: number; cacheRead: number } | undefined`,
  using `tokenHeadline` from teamDefaults and `usageToday.byAccount[accountId]`.
- `submitConsole` is unchanged (the prompt stays non-functional in Phase 3).
- App.tsx: on mount, call `team.getSnapshot()` -> hydrateTeam, `transcripts.getSelection()` -> selection, `refreshSessions()`, and `usage.getToday()` -> applyUsage.
  Subscribe to `team.onChanged(hydrateTeam)`, `transcripts.onSessionsChanged(setSessions)` and `usage.onChanged(applyUsage)` (optional-chained like the existing
  accounts subscriptions). Start `setInterval(tick, 5000)`. Clean up all of it on unmount.
- Existing renderer tests assume the mock team on first render. Add `seedDemoTeam()` to each affected file's `beforeEach` (next to `seedAccounts`). Do not
  change their assertions. Store tests cover: an empty initial state, the hydrate re-select rules, demo on/off keeping liveTeam, the live status via runtime with
  fake timers, the placeholder selector, the tokens selector, and that a push arriving during demo does not replace the demo view.
- Tests may use `!` for `noUncheckedIndexedAccess`.

## Acceptance commands
- npm test -- tests/renderer
- npm run typecheck
- npm test

## Done when
- All acceptance commands pass (the full suite green)
- Only owned files changed
