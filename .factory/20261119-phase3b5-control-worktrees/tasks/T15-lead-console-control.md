# T15 - Lead console drives the session: start/resume, prompt, typing row, permission cards

- Wave: 5
- Depends on: T02, T12
- Spec refs: R-05, R-06, R-19, spec Phase 3b + "Lead console"
- Tests: tests/renderer/leadControl.test.tsx

## Goal
The lead console becomes the control surface for app-controlled sessions while staying the transcript event stream:
a control bar (start / resume / continue / fork, model, permission mode, Interrupt, Stop), the prompt with slash
autocomplete and `@agent` routing, a transient typing row, and permission cards with Allow / Deny.

## Owned files
- modify: src/renderer/src/components/team/LeadConsole.tsx
- create: src/renderer/src/components/team/ControlBar.tsx
- create: src/renderer/src/components/team/PermissionCard.tsx
- modify: src/renderer/src/components/team/teamCenter.css
- create: tests/renderer/leadControl.test.tsx
- modify (only cases broken by the change): tests/renderer/teamCenter.test.tsx, tests/renderer/teamLive.test.tsx

## Read-only context
- src/renderer/src/store/useControlStore.ts (T12), src/renderer/src/store/useConsoleStore.ts (team, sessions, selection, accounts)
- src/renderer/src/components/team/RawTerminalPane.tsx (folder pick, account resolution, needs-confirmation flow - reuse the same UX)
- src/shared/agentMessage.ts (T02), plan.md Decisions D1, D2, D5-D8

## Notes
- Binding: `control = selectControlForSession(team.sessionId)` ?? `selectDraftControl` (a draft not yet bound).
  Modes of the prompt area:
  1. **Controlled** (control exists, not exited): prompt enabled; Enter -> `routeConsoleInput(draft, team.agents)` ->
     `send(control.id, route.text)`; errors shown inline (`unknown-agent`, `too-long`). Slash list = `control.slashCommands`
     filtered by prefix (keyboard: ArrowUp/Down, Tab completes, Esc closes); before the first send (draft) show the
     static list from `COMMANDS` fallback with a note "full list after the session starts".
  2. **External live session** selected (team.source live, session not controlled): prompt disabled, text "This
     session runs in <VS Code|a terminal>. Agent Console cannot type into it." + buttons "Fork here" (always) and
     "Resume here" (only when the session summary is not `live`).
  3. **No session / ended**: "Start a session" button opens the ControlBar start form.
  Demo mode keeps today's behaviour (`submitConsole`).
- ControlBar: state chip (draft/starting/idle/busy/exited + queued count), Model select (D8 list; Custom shows a text
  input validated with the same regex), Mode select (D8), Interrupt (busy only, `aria-keyshortcuts="Control+."`), Stop.
  Start form (shown when `useControlStore.startForm.open`, prefilled from it; the header's "+ New session" opens it): folder (pick button via `app.pickFolder`, default the selected project root), account (resolved like
  RawTerminalPane, `ask` -> select), option radio New / Continue latest in folder / Resume selected session / Fork
  selected session -> `start(req)`; `needs-confirmation` -> warn + "Start anyway" (confirmed:true);
  `session-live-elsewhere` -> message suggesting Fork. Start never sends a prompt (R-19): the prompt placeholder then
  says "Type the first message to start Claude".
- Typing row: when `streams[control.id].typing` exists, render one console line `who=lead` with the partial text and
  an aria-live="polite" "typing" indicator; `thinking` shows "thinking..." muted. Notices render as muted/red lines.
- PermissionCard (pinned above the prompt, one per pending prompt, oldest first): title "<displayName> wants to run",
  mono preview (`inputPreview`, max 12 lines with "show more"), decisionReason, buttons Allow (primary) / Deny (danger,
  optional message input on Shift+click -> small text field); `role="alertdialog"` not modal, `aria-labelledby`.
- UX S4: filter chips above the log: **Messages & asks** (default: user/assistant text, questions, permission asks,
  errors, task done), Tools, Errors, All (state exposed as a prop/default so T18 can persist it per project);
  console lines are single-line with click-to-expand, paths shortened with `shortenPathsInText` (T02,
  root = project root / team cwd), full text in `title`.
- UX S5 / D4: ControlBar has a secondary action "Ask lead to start a teammate" that only prefills the prompt
  (`Start a teammate with the Agent tool (name: "", task: )`) and focuses it; never sends. The Interrupt button is
  labelled "Interrupt lead (<project name>)".
- Raw terminal toggle stays exactly as is.
- tests/renderer/teamLive.test.tsx housekeeping (you own it this wave; nobody may touch it in wave 6): replace the
  "Phase 3b hint" cases with the new prompt states, and **delete** the obsolete `R-12 Phase 5 placeholders` describe
  block and the header case asserting `title 'Arrives in Phase 4'` - T16/T17 cover the replacements in their own files.
Tests: draft start does not call send; first Enter calls send once with the routed text; `@name` formatting;
unknown agent error; slash autocomplete keyboard; external session disables prompt and shows Fork/Resume rules;
permission Allow/Deny call `answer`; Interrupt only when busy; typing row appears/disappears.

## Acceptance commands
- npm test -- tests/renderer/leadControl.test.tsx tests/renderer/teamCenter.test.tsx tests/renderer/teamLive.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
