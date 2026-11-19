# T32 declutter list (UX lead, step 1)

The built app (`out/`, main @ 4992e59) was run with `npm run preview` on real data, read-only. Nothing was sent, approved, installed or toggled, and the theme was set back to System at the end.

**How sizes are given.** The test machine has a single 1920x1080 monitor at **125 % scaling**, so window pixels are not CSS pixels. Every size below is a **CSS width**:
- A 1920x1080 window is about **1536** CSS px.
- A 1440x900 window is about **1152** CSS px.
- The minimum window is about **914** CSS px. The OS min-size stops anything narrower, so this is the "narrow" case.
- The widths for the 24" (about 1840) and the 27" (about 2200 to 2500) were emulated with Ctrl+- zoom on a full-screen window.

Screenshots are in `‹scratchpad›/t32/`. They hold private data, so do not commit them.

Status column for step 3: `todo` / `done` / `rejected (reason)`.

**Ownership.** No item touches `src/main/**`, `src/shared/ipc.ts`, preload, `main.tsx` or the window-kind switch in `App.tsx`. Where a root cause *might* live in main, the item says so and limits the fix to the renderer.

---

## P0: broken

### U1. The whole window goes blank at the widest layout (27" monitor)
- **Status:** done. Root cause found by test: a collapsed item (the "older history" icon) overwrote its own natural width, so the plan flipped between icon and text and the layout effect looped ("Maximum update depth exceeded"). useOverflowItems no longer records collapsed widths, skips a plan when its inputs are unchanged, and applies at most 2 commit-driven re-plans per frame. New ErrorBoundary ("Reload view") sits inside TeamView, AccountsView and ExtensionsView, and around the chat view (so the chat window is covered too). Needs a real 27" re-check.
- **What is wrong:**
  - With a full-screen window zoomed out to about 2200 to 2500 CSS px wide (about 1370 px tall), `#root` renders empty. The window shows only the background. The UIA tree has `Group id=root` with no children.
  - Ctrl+0 does not bring it back. Only Ctrl+R does.
  - It reproduced twice. 2200 px (one step less) renders fine.
  - There is no error boundary, so any render throw becomes a blank app. This is the user's 27" monitor.
- **Seen at:** dark theme, about 2400 CSS px.
- **Screenshots:**
  - `21-team-2400css-dark.png` and `23-team-2500css-dark.png` (blank)
  - `22-team-2200css-dark.png` (last good)
- **Fix:**
  1. Reproduce in a test at 2560x1440 (jsdom width plus a mocked `offsetWidth`) and find the throw.
  2. Prime suspect: `useOverflowItems`. It runs `measure()` in a `useLayoutEffect` on *every* commit. When every header item fits, `k` can flip between 0 and 1: the "…" button appears, then frees its 44 px, then hides again. That gives "Maximum update depth exceeded".
     - Fix by making `k` move only on resize or width-change events, not on every commit. Or skip `setState` when the plan input is unchanged.
     - Add a guard: at most 2 re-plans per frame.
  3. Add a renderer `ErrorBoundary` around each screen (TeamView, AccountsView, ExtensionsView). Place it *inside* the screens or a new `components/ui/ErrorBoundary.tsx`, not in `main.tsx` or the App window-kind switch. It shows "Something broke in this view · Reload" plus the error text with a copy button.
- **Files:**
  - `hooks/useOverflowItems.ts`
  - `components/team/TeamHeader.tsx`
  - new `components/ui/ErrorBoundary.tsx`
  - `screens/TeamView.tsx`, `screens/AccountsView.tsx`, `screens/ExtensionsView.tsx`
  - test `tests/renderer/useOverflowItems.*` (wide case)
- **Rule:** the needs-you path is visible first. A blank window hides everything.

### U2. Window controls (min / max / close) cover the right end of every header
- **Status:** done. New hooks/useTitlebarInset.ts writes --ac-wco-right (getTitlebarAreaRect + geometrychange, 140px Windows fallback); global.css pads .ac-header/.ac-acc-header/.ac-ext-header (the chat window header is an .ac-header, so windowKinds.css needed no edit). Called from TeamHeader, AccountsHeader, ExtensionsView, ChatView.
- **What is wrong:** the native title-bar overlay sits on top of header content at every size, in both themes:
  - Team: the primary "+ New session in claude-ui as choose account" is cut under Minimize, and the "…" menu sits under the controls.
  - Team at 1152 and at 914: the per-session "0 needs you" is cut to "0 ……".
  - Team at about 1840: the "Extensions" header button is hidden.
  - Accounts: "+ Add account" is hidden.
  - Extensions: the Account `<select>` is hidden.

  `padding-right: max(20px, calc(100vw - env(titlebar-area-width, 100vw) + 8px))` in `global.css` has no effect, so `env(titlebar-area-width)` is not resolved here. T35's measuring then counts the covered area as free.
- **Seen at:** all sizes, both themes.
- **Screenshots:** `02-team-1920-dark.png`, `05-accounts-1920-dark.png`, `14-extensions-1920-light.png`, `16-team-1440-dark.png`, `20-team-1840css-dark.png`
- **Fix:**
  - Read `navigator.windowControlsOverlay?.getTitlebarAreaRect()` and listen to `geometrychange`. Write `--ac-wco-right: <px>` on `:root`. If the API is missing and `navigator.userAgent` contains Windows, fall back to `--ac-wco-right: 140px`.
  - Headers use `padding-right: calc(var(--ac-wco-right) + 8px)`.
  - `useOverflowItems` already measures the content box, so it then plans correctly.
  - Test: the header content box excludes the reserved width.
- **Files:**
  - `styles/global.css`
  - new `hooks/useTitlebarInset.ts`, called from the three headers
  - `components/team/TeamHeader.tsx`, `components/accounts/AccountsHeader.tsx`, `screens/ExtensionsView.tsx/.css`
- **Rule:** one primary action per area. The primary button is currently the thing being hidden.

---

## P1: clutter that costs the lead time every day

### U3. Two "needs you" counters in the header
- **Status:** done. Only the global needs-you button remains; its tooltip says "N across all projects · M in this session". The "..." menu shows "This session: ... agents · ... running · ... tok · N need you" and "All projects today: ... tok".
- **What is wrong:** the header shows the global button "● 0 need you" and, right next to it, a text counter "0 needs you" ("0 needs you in this session" at wide sizes). It is the same idea twice with near-identical wording, and the second one is the one that gets clipped (U2).
  - The overflow menu also shows "Tokens 12.86M" and "Tokens today 17.9M" with no scope.
- **Seen at:** all sizes, both themes.
- **Screenshots:** `02-team-1920-dark.png`, `22-team-2200css-dark.png`, `10-overflow-1920-light.png`
- **Fix:**
  - Keep only the global button. **Removed explicitly:** the inline per-session needs-you text in the header.
  - Its number moves into the button tooltip ("0 across all projects · 0 in this session") and into the overflow stats block.
  - Label the overflow stats with their scope: "This session: 104 agents · 3 running · 12.86M tok" and "All projects today: 17.9M tok".
- **Files:** `components/team/TeamHeader.tsx`, `components/rail/rail.css` (button), and the TeamHeader tests (update the counter assertions)
- **Rule:** the needs-you path is visible first. One clear number beats two similar ones.

### U4. Header carries too many items; cut it to six
- **Status:** done. Header = brand, project + session select, account chip, needs-you, one primary "+ New session", "...". The "team:" title, the history note and the LIVE badge are gone (title and note are in the select tooltip). Pause all (only when something runs), Hooks (Install / on / Reinstall), Extensions and Accounts (with shortcuts) are menu rows. Only the primary action may move into the menu when the row is too narrow.
- **What is wrong:** the header row holds: brand, "team: Claude in Chrom…" (always truncated), LIVE, project name, session select, ⓘ "older history not loaded", account chip, needs-you, per-session counter, a **disabled** "Pause all in claude-ui", the primary "+ New session in claude-ui as choose account", "Hooks: off", "Extensions" and "…".
  - "as choose account" reads badly.
  - "Hooks: off" is unclear.
  - Disabled buttons take space.
  - Accounts is only reachable through the chip.
- **Seen at:** every width. At 1536 the truncation is worst.
- **Screenshots:** `20-team-1840css-dark.png`, `22-team-2200css-dark.png`, `01-team-1440-dark.png`
- **Fix:**
  - **Target header:** brand · project + session select · account chip · needs-you button · one primary "+ New session" · "…".
  - **Removed explicitly from the header row:**
    - "team: <title>": the session title already shows in the session select and in the chat bar. Put it in the select's tooltip.
    - The ⓘ "older history not loaded" icon: it becomes a line inside the session select's tooltip and console top.
  - **Moved permanently into "…":**
    - "Pause all in <project>": shown only when something controllable runs, never disabled in the header.
    - "Hooks: not installed · Install…" (renamed from "Hooks: off"; installed shows "Hooks: on").
    - "Extensions" and a new "Accounts" entry, each with its shortcut shown.
  - Primary label: "+ New session". The account is picked in the form (orchestrator note).
  - "…" menu items are styled as menu rows, not boxed buttons.
- **Files:** `components/team/TeamHeader.tsx`, `TeamView.css`, the `useOverflowItems` order list, and the TeamHeader tests
- **Rule:** secondary actions go in overflow. One primary per area.

### U5. Center column: tiny grid, panels painting over each other, three nested scrollbars
- **Status:** done. The panes are measured on the panel (not the column that also holds the tab strip), which was the cause of the timeline painting over the grid and console. Defaults: grid = 40 % of the column, console takes the rest, mins 96 / 220; growing one pushes the other to its minimum; the user's dragged sizes are kept. Center has no scroll; only the agent list and the console log scroll. Timeline has a collapse toggle (collapsed under 800 px of column height). Implemented with the existing flex panes + splitters rather than a literal CSS grid.
- **What is wrong:**
  - The agent grid gets a fixed area of about 120 px (one to four rows) at every size, even when the window is about 1370 px tall. Meanwhile there is an empty gap of about 90 px between the timeline and the console (`22`).
  - The timeline paints over the last grid row and over the console's header and filter chips. Half-hidden rows show at the seams (`01`, `02`, `16`, `26`).
  - The whole center column scrolls, *and* the grid scrolls, *and* the console scrolls. That makes three scrollbars, and the composer or "Fork here" can sit below the fold (`01`, `08`).
- **Seen at:** all sizes, both themes.
- **Screenshots:**
  - `01-team-1440-dark.png`
  - `02-team-1920-dark.png`
  - `16-team-1440-dark.png`
  - `22-team-2200css-dark.png`
  - `26-team-1152css-light.png`
- **Fix:**
  - Make the center a single CSS grid with rows `[tabs] auto · [agents] minmax(96px, var(--grid-h)) · [timeline] auto · [console] minmax(220px, 1fr)` and no outer scroll.
  - Only the agent list and the console log scroll.
  - Default `--grid-h` = content height, capped at 40 % of the column. Splitters clamp to the row minimums.
  - The timeline gets a collapse toggle. It is collapsed to its one-line strip by default when the column is under 800 px tall.
  - Test: at 1100x700 and 2560x1440, `scrollHeight === clientHeight` for the center column, and the composer is in view.
- **Files:** `screens/TeamView.tsx/.css`, `components/team/teamCenter.css`, `hooks/usePanelHeights.ts`, `components/layout/Splitter.tsx`
- **Rule:** no nested scroll areas. The needs-you path (agents and asks) is visible first.

### U6. Three docked side columns starve the center at 1152 to 1536 px; worktree panel duplicates the grid
- **Status:** done. Below 1440 the inspector is an overlay drawer (header icon button); below 1600 only one of worktrees / inspector is docked (last opened wins; stored collapsed flags and widths untouched); worktree card = branch, short path (no "." row), count + avatar stack (5 + "+n"), agent list opens on click.
- **What is wrong:**
  - With worktrees and inspector both open, the center at 1152 is about 500 px. Console lines become "PowerShell $w = "C:\…", "Raw terminal" wraps onto two lines, and the timeline legend wraps.
  - The worktree panel lists *every* agent of the session (100+ rows), which is the same list as the grid.
  - Its first card renders a stray "." line, and at one point a broken "r  Open" title (`03`).
- **Seen at:** 1152 and 1536, dark and light.
- **Screenshots:**
  - `16-team-1440-dark.png`
  - `26-team-1152css-light.png`
  - `03-team-1920-dark-panels.png`
  - `04-team-1920-light.png`
- **Fix:**
  - Below 1600 CSS px, only one of worktrees or inspector is docked. Opening one collapses the other. Below 1440, the inspector is an overlay drawer, raised from the current < 1100.
  - Worktree card = branch, path (shortened), agent count, avatar stack (max 5 + "+n"), and Open. The agent list expands on click.
  - **Removed explicitly:** the always-expanded per-worktree agent list.
  - Drop the empty "." row.
- **Files:** `hooks/usePanelWidths.ts`, `screens/TeamView.css`, `components/team/WorktreeList.tsx`, `teamLeft.css`
- **Rule:** progressive disclosure, and no duplicated info.

### U7. Composer for a session Agent Console cannot control
- **Status:** done. A session Agent Console cannot control shows one line ("Runs in VS Code. Agent Console can't type into it.") and a primary Fork here (Resume here if not live); no textarea / Attach / Send. Send with is a labelled Enter | Ctrl+Enter radio switch. The ControlBar had no inline styles left. Chat tab: same one-line state but its button is "Fork it in Team view" (the fork preset lives in the lead console).
- **What is wrong:**
  - The session runs in VS Code, so the textarea and Send are disabled for screen readers, but they *look* active: full-contrast box, normal Send button.
  - Two send hints are shown at once: the toggle button "Ctrl+Enter to send" and the line "Enter to send, Shift+Enter for a new line".
  - "Fork here" is pushed below the fold at 1152.
  - The Chat tab composer repeats this, with an extra "running elsewhere" pill.
- **Seen at:** all sizes, both themes.
- **Screenshots:** `01-team-1440-dark.png`, `02-team-1920-dark.png`, `09-chat-1920-light.png`
- **Fix:**
  - When not controllable, replace the composer body with one line, "Runs in VS Code. Agent Console can't type into it.", and a single primary **Fork here**.
  - Hide the textarea, Attach image and Send.
  - When controllable, show one hint that matches the actual setting.
  - The Enter / Ctrl+Enter choice becomes a small labelled switch ("Send with: Enter | Ctrl+Enter") instead of a toggle that looks like a hint.
  - Move the ControlBar inline styles to `controlBar.css` with theme tokens (orchestrator note T29).
- **Files:** `components/team/Composer.tsx`, `components/chat/Composer.tsx`, `components/chat/chat.css`, `components/team/ControlBar.tsx`, `controlBar.css`
- **Rule:** one primary action per area, and the empty state gives the next step in one line.

### U8. Lead console and chat are full of tool noise and long paths
- **Status:** done. classifyLine treats CamelCase tool names (PowerShell, SubagentHandback, WebFetch...), MCP tools and a bare "done" as tools (renderer-side heuristic; main assigns no kind). Agent column 140 px, colour dot + middle ellipsis + tooltip. AgentCard and Activity use the shared path shortener; the async-launch result reads "launched in background".
- **What is wrong:**
  - The default "Messages & asks" filter still shows `PowerShell …` commands, `SubagentHandback` and `done` rows (`08`, `26`, `27`).
  - In Chat, unknown tools such as PowerShell render as body text in a 20 px paragraph, while Read and Bash render as collapsible rows (`09`).
  - The agent column truncates to "Implement X-…", so agents cannot be told apart.
  - Grid rows show full `‹tmp›/…` paths, while the console shortens them to `‹tmp›` (`02`, `18`).
  - Inspector Activity wraps absolute paths over four lines, and still shows "Async agent launched successfully… (internal metadata…)" (`03`).
- **Seen at:** all sizes, both themes.
- **Screenshots:**
  - `08-team-1920-light.png`
  - `09-chat-1920-light.png`
  - `02-team-1920-dark.png`
  - `03-team-1920-dark-panels.png`
  - `18-team-narrow-dark.png`
- **Fix:**
  - Treat *every* `tool_use` (any tool name, including PowerShell, SubagentHandback and MCP tools) and bare tool results as kind `tool` for the filter and for chat rendering. The filter today keeps everything with `k !== 'tool'`.
    - If the kind is assigned in main, map unknown kinds to `tool` in the renderer selector instead.
  - Agent column: fixed 140 px with a middle ellipsis ("Implement…T34"), the full name in a tooltip, plus the agent's colour dot.
  - Apply the shared shorten-path helper in `AgentCard` (current tool line) and in `ActivityTab` (relative to the project root, temp shown as `‹tmp›`).
  - Collapse the async-launch result to "launched in background".
- **Files:**
  - `components/team/LeadConsole.tsx`
  - `components/chat/ChatView.tsx`, `components/chat/ToolCallRow.tsx`
  - `components/team/AgentCard.tsx`
  - `components/inspector/ActivityTab.tsx`
  - `teamCenter.css`
  - tests for the filter (PowerShell is hidden by default)
- **Rule:** the needs-you path is visible first, since asks drown in tool lines. Use a consistent type scale.

### U9. Light theme: agent names and warnings are hard to read
- **Status:** done. Agent names render in --ac-text with a coloured dot (the hue no longer carries text contrast). Contrast test extended: warn text, status colours, text and muted text on the console surface too.
- **What is wrong:** in light theme these elements look like about 2:1 contrast:
  - agent-name colours in the console and chat (yellow "T32 UX lead", light green "Implement X-…"),
  - the amber inbox footer "1 project without hooks…",
  - the brownish rail running badge.
- **Seen at:** light theme, all sizes.
- **Screenshots:**
  - `08-team-1920-light.png`
  - `09-chat-1920-light.png`
  - `11-inbox-1920-light.png`
  - `26-team-1152css-light.png`
- **Fix:**
  - Add light-theme values for the agent palette and warning tokens at ≥ 4.5:1 on `--ac-bg-console` and `--ac-bg-panel`.
  - Or render agent names in `--ac-text` with a coloured dot or left bar carrying the hue.
  - Extend the existing contrast test (T31) to the agent palette.
- **Files:** `styles/tokens.css`, `components/chat/chat.css`, `components/team/teamCenter.css`, `components/rail/rail.css`
- **Rule:** text must be readable in both themes.

---

## P2: polish that removes confusion

### U10. Rail "running" badge looks like an unread count
- **Status:** done. Running is a plain pulsing dot without a number; numbers only for blocked and ready; the hooks ring has the tooltip "Hooks not installed: sub-agent prompts not detected".
- **What is wrong:** claude-ui shows an amber "1" bubble while the header says "0 need you". The bubble means "1 running", but numbered bubbles read as "something for me". The hollow "no hooks" ring sits on the same avatar.
- **Seen at:** all sizes, both themes.
- **Screenshots:** `02-team-1920-dark.png`, `16-team-1440-dark.png`
- **Fix:**
  - Numbers appear only for red (blocked) and blue (ready) counts. Running is a plain amber dot, pulsing, with no number.
  - Keep the hooks ring, with the tooltip "Hooks not installed: sub-agent prompts not detected".
- **Files:** `components/rail/ProjectRail.tsx`, `rail.css`
- **Rule:** the needs-you path is visible first. Red and numbers mean "me".

### U11. Narrow layout (< 1100): floating "Projects" / "Inspector" pills cover content
- **Status:** done. Projects / Inspector are header icon buttons (Ctrl+B / Ctrl+I in the tooltip); the floating pills and their CSS are removed.
- **What is wrong:** the two floating pills at the bottom corners cover the "Messages & asks" chip and console rows.
- **Seen at:** 914 px, dark and light.
- **Screenshots:** `17-team-1100-dark.png`, `18-team-narrow-dark.png`, `27-team-914css-light.png`
- **Fix:** put the two drawer toggles in the header as icon buttons, left of the brand and before "…", with Ctrl+B / Ctrl+I in their tooltips. Nothing floats over the content. Add a narrow-width test: no fixed-position element overlaps the console.
- **Files:** `screens/TeamView.tsx/.css`, `components/team/TeamHeader.tsx`
- **Rule:** secondary actions on hover/focus or in overflow, and nothing hides content.

### U12. Timeline rows waste space and cannot be told apart
- **Status:** done. Lanes only for the lead, agents with activity in the window and running / needs-you agents; middle-ellipsis labels with tooltip; below 1300 px of timeline width the legend folds into a "Legend" button (container query).
- **What is wrong:**
  - Rows show for agents with no activity in the 20-minute window (empty bars).
  - Labels truncate to identical prefixes ("Implement X-T1…", "Implement X-T2…").
  - At 1152 the legend wraps onto two lines and pushes into the console.
- **Seen at:** all sizes.
- **Screenshots:**
  - `17-team-1100-dark.png`
  - `20-team-1840css-dark.png`
  - `22-team-2200css-dark.png`
  - `16-team-1440-dark.png`
- **Fix:**
  - Show only the lead, agents with activity in the window, and running or needs-you agents.
  - Labels use a middle ellipsis or the task id, with a tooltip.
  - Below 1300 px of column width, the legend folds into a "Legend" tooltip button.
- **Files:** `components/team/Timeline.tsx`, `teamCenter.css`
- **Rule:** no duplicated or low-value chrome. Use a consistent type scale.

### U13. Extensions screen: unstyled inputs, always-visible destructive buttons, no needs-you
- **Status:** done. Themed .ac-acc-text / .ac-acc-select classes on the inputs and selects, needs-you button in the header, Uninstall... in a row "..." menu, Open in editor on hover / focus, path hint under Project, ">-" shows "No description" (renderer only).
- **What is wrong:**
  - The plugin install box, the catalog search and the Project/Account selects use browser-default styling (thin black or white border, grey fill) in both themes.
  - Every plugin row shows a red "Uninstall…", and every catalog row shows "Open in editor".
  - The dts-tool description renders as the raw YAML marker `>-`.
  - The header has no needs-you button, while the Accounts header does.
  - A lone path line "D:/personal/claude-ui" floats above the first card.
- **Seen at:** 1536 px, both themes.
- **Screenshots:** `14-extensions-1920-light.png`, `15-extensions-1920-dark.png`
- **Fix:**
  - Use the themed input and select classes from `manage.css` (`.ac-acc-text` / `.ac-acc-select`, or a shared `.ac-input`).
  - Plugin row: Enable/Disable stays visible. Uninstall… moves to a row "⋯" menu.
  - "Open in editor" shows on row hover or focus.
  - Reuse the needs-you button in the Extensions header.
  - Put the path under the Project select as hint text.
  - For `>-`: if the description parse lives in main, render "No description" when the value is a bare YAML indicator, and leave the real parse fix for later.
- **Files:**
  - `screens/ExtensionsView.tsx/.css`
  - `components/extensions/PluginsSection.tsx`
  - `components/extensions/CatalogSection.tsx`
  - `components/accounts/manage.css` (shared input class)
- **Rule:** one primary per area, secondary on hover/focus, and the needs-you path is visible on every screen.

### U14. Accounts screen: stale empty state, jargon, four equal buttons per card
- **Status:** done, with one wording change: the policy text no longer says "(Phase 3)" and no "(needs usage data)" suffix either (it already says "Applies once usage data is available"). Sticky headers, Running now lists live external sessions "in VS Code / in a terminal", Set as default only when not default, other card actions in "...", Detected logins collapse to one line when all are linked.
- **What is wrong:**
  - The header scrolls away, so the needs-you button and Back disappear (`07`).
  - "Running now" says "No sessions running. Start one from the lead console's Raw terminal." while a live (VS Code) session exists, and Raw terminal is no longer the way to start one.
  - The usage-limit option says "(Phase 3)".
  - Each account card shows Set as default, Sign in again, Rename & color and a red Remove at equal weight.
  - "Detected logins" takes a full card even when every login is already linked.
- **Seen at:** 1536 px, dark and light.
- **Screenshots:** `05-accounts-1920-dark.png`, `07-accounts-1920-light-bottom.png`
- **Fix:**
  - Make the header sticky.
  - Running now:
    - List live sessions per account, external ones included, labelled "in VS Code".
    - When there are none: "Nothing running. Start one with + New session in the Team view."
  - Replace "(Phase 3)" with "(needs usage data)".
  - Card actions:
    - "Set as default" is the only visible button, and only when the account is not the default.
    - Sign in again, Rename & color and Remove… move to "⋯".
  - Detected logins collapses to the line "2 logins found · all linked · Scan again" when nothing is unlinked.
- **Files:**
  - `screens/AccountsView.tsx/.css`
  - `components/accounts/RunningNow.tsx`
  - `components/accounts/AccountCards.tsx`
  - `components/accounts/AccountPolicies.tsx`
  - `components/accounts/DetectedLogins.tsx`
- **Rule:** the empty state gives the next step in one line, there is one primary per area, and needs-you stays visible.

### U15. Dialogs and inspector: safe focus, one primary action, readable rows
- **Status:** partly done. Hooks: focus starts on Close, Install xor Uninstall by state, read-only list of the 16 hook events. Inspector: only enabled actions, one primary, Stop (confirm-gated) in "...", "Assigned task" hidden when it equals the branch. Switcher: status + account dots, the path ellipsizes first. Inbox: visible x close button. REJECTED for now: anchoring the inbox as a popover under the header button at >= 1100 px (needs an anchored portal; the modal with a close button is kept).
- **What is wrong:**
  - **Hooks dialog:** it opens with focus on **Install**, so Enter writes `settings.local.json`. It also shows "Uninstall" when nothing is installed, and has no preview of the entries it would write (`25`).
  - **Inspector:** it shows four equal buttons, two of them disabled (Message agent, Open worktree, Pause, Stop process…). "Assigned task" still shows a branch name ("main") for the lead (`03`).
  - **Switcher (Ctrl+K):** it truncates the project name ("pro…") to make room for its full temp path, and rows carry no status or account dot (`12`).
  - **Inbox:** it is a centred modal with no visible close button (`11`).
- **Seen at:** 1536 px, both themes.
- **Screenshots:**
  - `25-hooks-dialog-dark.png`
  - `03-team-1920-dark-panels.png`
  - `12-switcher-1920-light.png`
  - `11-inbox-1920-light.png`
- **Fix:**
  - **Hooks:** initial focus goes to Close. Show Install *or* Uninstall depending on state. List the hook events to be added (read-only preview) above Install.
  - **Inspector:** show only actions that are enabled. One primary ("Open worktree", or "Message agent" when controllable). "Stop process…" moves to "⋯", still confirm-gated. Hide "Assigned task" when it equals the branch, and show the branch only as the ⎇ line.
  - **Switcher:** the name never truncates before the path, because the path ellipsizes first. Add the status dot and the account dot.
  - **Inbox:** add an × close button in the title row, and anchor the inbox under the header button as a popover at ≥ 1100 px.
- **Files:**
  - `components/team/HooksDialog.tsx`
  - `components/inspector/Inspector.tsx`, `inspector.css`
  - `components/rail/ProjectSwitcher.tsx`, `components/rail/NeedsYouInbox.tsx`
  - `components/ui/dialog.css`
- **Rule:** one primary action per area, secondary in overflow, and no accidental writes to Claude settings.

---

## Not checked / caveats
- **No physical 2560x1440 or second monitor.** This machine has one 1920x1080 panel at 125 %. The 27" and 24" checks were emulated with Ctrl+- zoom on a full-screen window. U1 must be re-checked on the real 27".
- **Narrow width:** about 800 CSS px could not be reached, because the OS minimum window is about 914 CSS px at 125 %. The narrow case was checked at 914.
- **Not checked:** 150 % scaling, and Windows High Contrast.
- **Multi-window (T34):** skipped as instructed. T34 was merged to main while this review ran. The re-check in step 3 should include the two-monitor flow.
- **Not opened, to stay read-only:**
  - permission and question cards (they need a live app-controlled session),
  - the Stop process… confirm,
  - the Rewind and Compare diffs dialogs,
  - the Add account and Add server flows.

  The New session form was only opened and cancelled.
- **Ctrl+Shift+L:** the first press did not seem to change the theme. Focus was in the grid, and the inspector selection changed instead. Later presses worked. This was not confirmed as a bug.
- **No app zoom code:** no renderer code for app zoom (Ctrl+= / Ctrl+- / Ctrl+0, persisted) was found in `src/`. The default Electron zoom works, but persistence was not verified. That plan item may be missing.
