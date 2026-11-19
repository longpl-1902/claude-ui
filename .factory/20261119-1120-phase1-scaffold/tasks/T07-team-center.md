# T07 - Overlap banner, agent cards, timeline, lead console with raw-terminal placeholder

- Wave: 4
- Depends on: T04
- Spec refs: R-10, R-16
- Tests: tests/renderer/teamCenter.test.tsx

## Goal
Build the Team view center column to match the mockup:
- The overlap warning banner.
- The agent cards grid, where clicking a card selects that agent.
- The 20-minute timeline swimlanes with legend.
- The lead console, with the event stream, a prompt input and a "Raw terminal" toggle. The toggle reveals an xterm placeholder pane (no pty in Phase 1).

## Owned files
- modify: src/renderer/src/components/team/OverlapBanner.tsx
- modify: src/renderer/src/components/team/AgentGrid.tsx
- create: src/renderer/src/components/team/AgentCard.tsx
- modify: src/renderer/src/components/team/Timeline.tsx
- modify: src/renderer/src/components/team/LeadConsole.tsx
- create: src/renderer/src/components/team/RawTerminalPane.tsx
- create: src/renderer/src/components/team/teamCenter.css
- create: tests/renderer/teamCenter.test.tsx

## Read-only context
- docs/design/team-view.mockup.html lines 376-378 (pulse and card hover), 450-454 (banner), 456-484 (cards), 486-513 (timeline), 515-535 (lead console), 668-692 (card state colors: selected border = accent, bg #1A2030, laneText)
- src/renderer/src/store/useConsoleStore.ts, src/renderer/src/theme/colors.ts, src/renderer/src/components/ui/*
- src/shared/format.ts

## Notes
- Keep the T04 export names and the no-props signatures for OverlapBanner, AgentGrid, Timeline and LeadConsole.
- **OverlapBanner**:
  - Renders nothing when `team.overlaps` is empty.
  - For each overlap: a `role="alert"` box with warn bg, border and text. It contains WarningIcon, then "File overlap: `<mono>{path}</mono>` is being edited by {names joined ' and '} in different worktrees.", then a Button (variant ghost, warn border) "Compare diffs" as a no-op.
- **AgentGrid**:
  - h1 "Team" (18px 600) with the hint "Click an agent to inspect what it is doing".
  - Grid: `repeat(auto-fill, minmax(260px, 1fr))`, gap 12.
  - Maps agents to `<AgentCard>`.
- **AgentCard**: `export function AgentCard({ agent, status, selected, onSelect }: { agent: Agent; status: AgentStatus; selected: boolean; onSelect(id: string): void })`.
  - A `<button type="button" aria-pressed={selected}>`. Border is accent when selected, otherwise `--ac-border-card`. Background is bg-selected when selected, otherwise bg-card. Radius 10, padding 14, gap 10.
  - Row 1: Avatar (30, rounded), name (600, 14px), role (11px subtle, ellipsis), and `<StatusPill status>`.
  - Row 2: a mono box with inset bg, border-inset and radius 6. It shows `current.tool` in `toolColor(tool)`, then the target, with ellipsis.
  - Row 3, at 11px subtle: `⎇ {worktree}` (mono, branch color), `formatElapsed`, `{formatTokens} tok`, `{toolCalls} calls`.
  - Hover border: `--ac-border-hover`.
- **Timeline**:
  - A section card. The header has "Timeline", "last 20 min", a spacer and the legend from `TIMELINE_LEGEND`.
  - One row per agent: a 110px mono name, in text color when selected and muted otherwise, and an 18px lane with bg inset and radius 4.
  - Each segment is absolutely positioned with `left: startPct%` and `width: widthPct%`, colored by `SEGMENT_COLORS[kind]`, with `title={kind}`.
  - The tick row comes from `team.timelineTicks`.
  - The wrapper uses `overflow-x: auto` with an inner min-width of 560.
  - The lane container has `role="img"` and an `aria-label` of `{name} activity, last 20 minutes`.
- **LeadConsole**:
  - A section with bg-console and radius 10.
  - Header bar (bg-panel): an amber dot, "Lead console", "all team events, newest last", a spacer, and a toggle Button (secondary, sm) "Raw terminal" with `aria-pressed={rawTerminalOpen}` that calls `toggleRawTerminal`.
  - Body:
    - When `rawTerminalOpen` is false: the event lines in mono 12px, line-height 1.5. Each line has the time (faint), `who` (96px, ellipsis, colored), and the text.
      - `who` colors: 'you' uses the accent, an agent id uses that agent's avatarColor. The display name is 'you' or the agent name.
    - When `rawTerminalOpen` is true: `<RawTerminalPane/>`.
  - Footer, a `<form onSubmit>`:
    - A `<label htmlFor="ac-prompt">›</label>` in the accent.
    - `<input id="ac-prompt" aria-label="Message the lead" placeholder="Message the lead, @agent to talk to a teammate, / for commands">`, bound to `consoleDraft` and `setConsoleDraft`.
    - An "Enter" kbd hint.
    - Submitting calls `submitConsole`.
  - When the draft starts with '/', show a small list of commands below the input (`/pause`, `/stop`, `/status`) as static hints.
- **RawTerminalPane**:
  - `export function RawTerminalPane()`. In `useEffect`, dynamically `import('@xterm/xterm')` and `@xterm/addon-fit`, and also import `@xterm/xterm/css/xterm.css`.
  - Create a `Terminal` with `{ theme: { background: '#0B0C0E', foreground: '#E6E7EA' }, fontFamily: 'JetBrains Mono', fontSize: 12, disableStdin: true }`. Open it in a div and fit it. Write "Agent Console raw terminal (placeholder)\r\nThe live lead session terminal arrives in Phase 2.\r\n".
  - Dispose on unmount.
  - Also render visible fallback text, "Raw terminal: placeholder until Phase 2", for screen readers and tests.
  - Height is 280px.
  - Do not import node-pty or IPC.
- Get statuses from `useAgentStatuses()` and selection from `selectedAgentId` / `selectAgent`.
- Test (jsdom):
  - Add `vi.mock('@xterm/xterm', ...)` and `vi.mock('@xterm/addon-fit', ...)` as simple class stubs, and mock the xterm CSS.
  - Call `resetConsoleStore()`.
  - Expect the texts 'File overlap:', 'src/Api/SheetDto.cs', 'Compare diffs', the 6 agent names, 'Needs you', 'dotnet test --filter "Category=Export"', 'Timeline', 'Thinking', 'Read / Grep' and 'Lead console'.
  - Click the test-writer card: the store `selectedAgentId` becomes 'test', and that card has `aria-pressed="true"`.
  - Type 'hi' plus Enter: a new line 'hi' appears.
  - Click "Raw terminal": 'Raw terminal: placeholder until Phase 2' is visible and the event list is hidden.

## Acceptance commands
- npm test -- tests/renderer/teamCenter.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass.
- A manual visual check against mockup lines 450-535 is noted in the report.
- Only owned files changed.
