# T28 - Composer: slash palette, @-mentions, image attach, question and plan cards

- Wave: 11
- Depends on: T26, T27
- Spec refs: R-27, R-29, R-31
- Tests: tests/renderer/composer.test.tsx

## Goal
Bring the prompt to VS Code level: a slash palette with descriptions and sources, @-mention file/folder picker, image
paste/drop/attach, Ctrl+Enter option, and dedicated cards for AskUserQuestion and ExitPlanMode prompts.

## Owned files
- modify: src/renderer/src/components/team/LeadConsole.tsx (replace the prompt form with `<Composer/>`)
- create: src/renderer/src/components/team/Composer.tsx
- create: src/renderer/src/components/team/SlashPalette.tsx
- create: src/renderer/src/components/team/MentionPicker.tsx
- modify: src/renderer/src/components/team/PermissionCard.tsx (dispatch to question/plan variants)
- create: src/renderer/src/components/team/QuestionCard.tsx
- create: tests/renderer/composer.test.tsx
- modify (cases broken only): tests/renderer/leadControl.test.tsx

## Read-only context
- src/renderer/src/store/{useDetailsStore,useControlStore,useConsoleStore}.ts, src/shared/agentMessage.ts, plan.md PD1-PD8

## Notes
- Composer: multi-line textarea (Enter sends, Shift+Enter newline; setting "Ctrl+Enter to send" in localStorage
  'ac.ctrlEnterSend'), keeps `#ac-prompt` id, routing via `routeConsoleInput`; with images -> `sendRich`.
  Prompt history: Up/Down on an empty/at-start caret cycles this session's previous sends (in memory).
- SlashPalette (on `/` at start): `selectCommands(controlId)` grouped by source (Built-in, Project, User, Skills,
  Plugins, MCP - source refined by matching names against the catalog list if loaded), each row name + argumentHint +
  description; filter by prefix/substring; keyboard Up/Down/Tab/Enter/Esc; `aria-activedescendant` listbox.
- MentionPicker (on `@` at a word start, except when the text looks like `@agent` routing - agent names win when they
  match): `fileSuggestions(controlId | null, cwd, query)`; inserting `@<relative path>` (folders end with `/`).
  ASSUMPTION (PD5): the CLI expands `@path` in stream-json prompts as in the terminal.
- Images: paste (clipboard image), drag-drop, and an "Attach image" button (file input accept png/jpeg/gif/webp);
  chips with thumbnail + remove; limits from T23 with a clear error; images are only sent with the user's Send.
- QuestionCard (permission prompt whose toolName is AskUserQuestion): render each question (header, options with
  descriptions, multi-select checkboxes when `multiSelect`, an "Other" free-text) -> `answer(id, requestId, {behavior:
  'allow', answers: {[question]: label(s) comma-joined}})`; "Dismiss" -> deny "User dismissed the question".
- Plan card (toolName ExitPlanMode): render `input.plan` as plain preformatted text (no HTML injection), buttons
  "Approve plan" (allow), "Approve + auto-accept edits" (allow then `setMode(id,'acceptEdits')`), "Keep planning" (deny
  with the optional feedback text as message).
Tests: palette grouping/keyboard, mention insert, `@agent` still routes, image paste -> sendRich with 1 image, size
error, question answers payload, plan approve/keep-planning payloads, nothing sent without Enter/click.

## Acceptance commands
- npm test -- tests/renderer/composer.test.tsx tests/renderer/leadControl.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.
