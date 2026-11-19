# T08 - Inspector panel (selected agent)

- Wave: 4
- Depends on: T04
- Spec refs: R-11, R-16
- Tests: tests/renderer/inspector.test.tsx

## Goal
Replace the Inspector stub with the right-column inspector for the selected agent. It contains:
- The header and status pill.
- Three stat tiles.
- The assigned task and worktree.
- Accessible Activity / Files / Messages tabs.
- The action buttons.

## Owned files
- modify: src/renderer/src/components/inspector/Inspector.tsx
- create: src/renderer/src/components/inspector/ActivityTab.tsx
- create: src/renderer/src/components/inspector/FilesTab.tsx
- create: src/renderer/src/components/inspector/MessagesTab.tsx
- create: src/renderer/src/components/inspector/inspector.css
- create: tests/renderer/inspector.test.tsx

## Read-only context
- docs/design/team-view.mockup.html lines 538-613 (inspector), 667 (failure result color), 679-686 (event, file, msg and tab mapping)
- src/renderer/src/store/useConsoleStore.ts, src/renderer/src/theme/colors.ts, src/renderer/src/components/ui/*
- src/shared/format.ts

## Notes
- Keep `export function Inspector()` with no props. It reads `selectSelectedAgent`, `useAgentStatuses()`, `inspectorTab` and `setInspectorTab`.
- Header:
  - Avatar (40, rounded).
  - The name at 16px 600, with `{role} · {model}` at 12px subtle under it.
  - A StatusPill.
- Stat tiles in a 3-column grid, with card bg and radius 8. The labels are "Elapsed", "Tokens" and "Tool calls", and the values are 15px 600, using the format helpers.
- Assigned task box: "Assigned task" (11px subtle), `taskTitle` (13px), and `⎇ {worktree}` (mono 11px, branch color).
- Tabs:
  - A `role="tablist"` containing three `role="tab"` buttons: Activity, Files and Messages. Each has `aria-selected`, `aria-controls` and an id.
  - The active tab has a 2px accent bottom border and text color; the others are subtle.
  - Arrow Left and Right move between tabs (roving tabindex).
  - The panel is `role="tabpanel"`.
- **ActivityTab** `({ items }: { items: ActivityItem[] })`:
  - An `<ol>`. Each item uses a grid of 58px / 14px / 1fr.
  - Columns: the time (mono 11px dim), a 9px dot in `toolColor(tool)` with a vertical 1px connector, and then the content.
  - The content is the tool (colored, 500) plus the target in mono 12px, then the result at 12px. The result is in the needs-you color when `failed`, otherwise subtle.
- **FilesTab** `({ files }: { files: ChangedFile[] })`:
  - Rows: the path in mono, `+{added}` in the done color and `−{removed}` in the needs-you color. Use a real U+2212 minus sign.
  - When the list is empty, show "No files changed yet."
  - Then a link-styled button "Open full diff against main" (no-op).
- **MessagesTab** `({ messages }: { messages: MailboxMessage[] })`:
  - Cards with `{direction === 'in' ? 'from' : 'to'} {peer}` (soft) · `{time}`, then the text at 13px, line-height 1.45.
- A flex spacer, then the actions in a 2x2 grid of lg Buttons:
  - "Message agent": focuses `#ac-prompt` and sets the draft to `@{name} `.
  - "Open worktree": calls `window.api?.worktree.openInEditor(worktree)`.
  - "Pause": calls `window.api?.agent.pause(id)`.
  - "Stop": variant danger; calls `window.api?.agent.stop(id)`.
  - Guard every `window.api` call.
- Test (jsdom):
  - Call `resetConsoleStore()`. The default selection is backend-impl.
  - Expect 'backend-impl', 'Server + Revit export · Sonnet', '17m 05s', '241k', '31', '#3 Export endpoints' and 'dotnet test --filter "Category=Export"'.
  - Click the Files tab: 'src/Services/SheetExportService.cs', '+96' and '−20' appear.
  - Click Messages: 'to lead' and 'Export endpoints compile against SheetDto v1' appear.
  - Select 'rev' via the store and open Files: 'No files changed yet.' appears.
  - Select 'test' and open Activity: the result 'FAIL · SheetDto_RoundTrip, Export_ToExcel' is rendered with the failed class.
  - Press ArrowRight on the focused Activity tab: Files becomes selected.

## Acceptance commands
- npm test -- tests/renderer/inspector.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass.
- A manual visual check against mockup lines 538-613 is noted in the report.
- Only owned files changed.
