# T10 - Inspector on live data (Activity, Files, Messages, empty states) and real "Tokens used today"

- Wave: 4
- Depends on: T07 (store selectors `selectSelectedAgentOrNull`, `useAgentStatusInfo`, `selectTokensToday`)
- Spec refs: R-13, R-09 (display); spec Screen 1 inspector, Screen 2 account cards
- Tests: tests/renderer/inspectorLive.test.tsx (create), tests/renderer/inspector.test.tsx (only cases broken by the change)

## Goal
The inspector shows the selected live agent safely, including when there is no agent at all. Activity marks failures and
open calls. Files lists the changed files with +/-. Messages shows the task, the result and SendMessage traffic, with
honest empty texts. The Accounts cards show real tokens used today, with cache reads shown separately.

## Owned files
- modify: src/renderer/src/components/inspector/Inspector.tsx
- modify: src/renderer/src/components/inspector/ActivityTab.tsx
- modify: src/renderer/src/components/inspector/FilesTab.tsx
- modify: src/renderer/src/components/inspector/MessagesTab.tsx
- modify: src/renderer/src/components/accounts/AccountCards.tsx
- create: tests/renderer/inspectorLive.test.tsx
- modify: tests/renderer/inspector.test.tsx (only cases broken by the change)

## Read-only context
- src/renderer/src/store/useConsoleStore.ts (after T07), src/shared/types.ts, src/shared/teamDefaults.ts, src/shared/format.ts
- src/renderer/src/components/inspector/inspector.css (you may not need changes; if you do, add it to the report as a needed scope change instead of editing)

## Notes
- **Inspector:** use `selectSelectedAgentOrNull`. When it is null, render the aside with the heading "Inspector" and "Select an agent" (or "No agents yet" when
  the team has none). Do not render the stats or tabs then. The status pill uses `useAgentStatusInfo` and puts the reason in its `title`. Header extras in live mode:
  the model, plus `cwd` (mono, truncated with a title tooltip). The task title stays as-is. In live mode, the worktree row shows `⎇ ${agent.worktree || '—'}` and the
  "Open worktree" action stays (it is NOT_IMPLEMENTED in main; unchanged).
- **Activity:** the existing list. Items with `result === '…'` show the muted text "running…". Failed items stay red (existing). Empty -> "No tool calls yet".
- **Files:** each row is the path (mono), `+added` in green and `−removed` in red, from `agent.files`. Empty -> "No file changes from Edit/Write yet". Keep the
  "Open full diff against main" button but disable it with the title "Diffs arrive in Phase 5" when `team.source !== 'demo'`.
- **Messages:** the existing in/out rendering. Empty -> "No messages. Shows the agent's task, its result, and SendMessage traffic." (Claude Code transcripts have no
  mailbox; the plan's Verified fact 13.)
- **AccountCards:** replace the tokens-today value. Use `selectTokensToday(a.id)`: undefined -> '—', else `formatTokens(headline)` plus, when cacheRead > 0, a
  muted ` +${formatTokens(cacheRead)} cached`, with the title "input + output + cache writes; cache reads shown separately". Do not touch any other part of the card.
- Tests: an empty team -> no crash and the placeholder text; a live agent with an open activity item, a failed item, files with +/-, the messages in/out, the tooltip reason;
  the account card with usage, without usage, and with cacheRead.
- Tests may use `!` for `noUncheckedIndexedAccess`.

## Acceptance commands
- npm test -- tests/renderer/inspectorLive.test.tsx tests/renderer/inspector.test.tsx tests/renderer/accountsManage.test.tsx tests/renderer/accountsView.test.tsx
- npm run typecheck
- npm test

## Done when
- All acceptance commands pass
- Only owned files changed
