# T33 — Chat as a first-class view + copy everywhere (user request, 2026-11-19)

User: "component chat nhìn hơi nhỏ quá. có phương án nào dễ làm việc hơn không" (the chat is too small; make it easier to
work with) and earlier "đã có tính năng copy … chưa" (copy features).

Wave 8 (with T19, T20). T28 (wave 11) later adds palette / @-mentions / images / question & plan cards INTO the
composer this task creates — design the composer with clear extension points (slots/props) for that.

## Behaviour
1. **Center view tabs "Team | Chat"** (role=tablist) above the center column. Team = today's grid + timeline + lead
   console. Chat = a full-height conversation view of the selected session (live transcript lines + controlled-session
   stream). Remembered per project (T18's per-project state may store it; until then a module-level store with
   localStorage try/catch). Shortcut Ctrl+Shift+C toggles Team/Chat (document in the ? help list T18 builds; expose
   `useCenterViewStore.toggle()` for T18 to bind; if T18 already merged, bind it in its shortcut hook only if you own
   it — otherwise note it).
2. **Chat view layout:** readable column (max-width ~ 860 px, centered, grows with window), 14–15 px body text,
   clear speaker separation (you / lead / agent name), timestamps subtle. Claude replies render a safe Markdown subset
   → React elements (NO dangerouslySetInnerHTML, no raw HTML passthrough): headings, paragraphs, bold/italic, inline
   code, fenced code blocks (monospace, horizontal scroll inside the block only, language label, Copy button), lists,
   blockquotes, tables (scroll inside), links (http/https only → open in the default browser via a main-process IPC
   that calls shell.openExternal; anything else rendered as text). Tool calls collapse to one line "▸ Bash  npm test"
   expandable to show input/result (displayPath, truncated with "show more"). Permission cards (existing
   PermissionCard) render inline in the stream at the point they occurred and also stay pinned above the composer while
   pending. Streaming partial text appears in place. Auto-scroll only when already at bottom; a "↓ New messages" pill
   otherwise.
3. **Composer:** multi-line textarea that auto-grows (min 2 lines, max ~40 % of the view, then scrolls), Enter sends,
   Shift+Enter newline, Esc blurs; shows target ("to lead" / "to @name") and session state; disabled with the existing
   reasons for external sessions; reuses useControlStore.send (R-19 unchanged: nothing sent without the user's
   explicit Enter/Send). Extension slots for T28: `toolbar`, `beforeInput` (chips/attachments), `onPaste` hook,
   `suggestions` popover anchor.
4. **Maximize the lead console** in Team view: a maximize button in its header + double-click on the header +
   Ctrl+Shift+M → console fills the center column (grid/timeline hidden), Esc or the button restores. (Different from
   Chat view: keeps the compact console style for quick monitoring.)
5. **Copy everywhere:**
   - Main process: a standard context menu on right-click (Cut/Copy/Paste/Select all, enabled per
     `params.editFlags`; "Copy link" for links) via `webContents.on('context-menu')` — no spellcheck service calls.
   - Hover copy buttons (icon button with aria-label "Copy …", visible on hover AND keyboard focus) on: chat messages,
     code blocks, tool inputs/results, console lines, file paths (Files tab, worktree cards), session ids, the external
     stop dialog's pid. Uses `navigator.clipboard.writeText`; a small "Copied" toast/inline confirmation (aria-live).
   - Text in console/chat/activity is selectable (no user-select:none there).
6. **Responsive:** Chat column full width under 900 px; composer stays docked; tabs never wrap badly.

## Owned files
src/renderer/src/components/chat/** (new: ChatView, Markdown, Composer, ToolCallRow, CopyButton, chat.css),
src/renderer/src/store/useCenterViewStore.ts (new), src/renderer/src/screens/TeamView.tsx/.css (tabs + maximize only),
src/renderer/src/components/team/LeadConsole.tsx (maximize button + copy buttons on lines only),
src/main/contextMenu.ts (new) + its registration line in src/main/index.ts, the `app:open-external` IPC channel
(src/shared/ipc.ts, types if needed, preload, handlers — http/https validated), tests:
tests/renderer/{chatView,markdown,composer,copy}.test.tsx, tests/main/contextMenu.test.ts, contract case.
Do not touch T19/T20 files (README/packaging/empty-state components) in the same wave.

## Acceptance
- Markdown tests: every supported construct; `<script>`/raw HTML rendered as literal text; javascript:/file: links not
  clickable; long code scrolls inside its block.
- Composer: Enter sends once, Shift+Enter newline, disabled states, never sends on mount/paste (R-19).
- Copy: buttons copy exact text (mock clipboard), keyboard reachable; context menu builds the right items from editFlags.
- Maximize + Chat tab toggling + persistence; narrow-width case.
- `npm test`, `npm run typecheck`, `npm run build` green. No new dependencies.
