# UX review: Agent Console for a lead running many projects at once

Reviewer role: the target user. A tech lead with 3–6 git repos open at the same time. Each repo has a lead session, sub-agents and worktrees. Some run on the company account, some on the personal one. I switch between them all day. Every few minutes I need to know one thing: **which agent, in any project, is blocked on me right now.**

Inputs read: docs/spec.md, both mockups, TeamView/TeamHeader/AgentGrid/AgentCard/Inspector/store code, the Phase 3 report, the Phase 3b+5 request, and five screenshots of the running app.

---

## 1. Verdict

**For one project, the app is good and getting better. For many projects, it is not convenient yet. It works as a single-project viewer with a project dropdown on top.**

The whole information architecture is scoped to one selected session:
- the header counters,
- the "needs you" number,
- the token total,
- the account edge color,
- and, in the main process, the transcript model (`transcriptService` builds a full model only for the current `selection`).

The spec mockup has the same shape, because it was drawn for one team. My real day has five teams. The app therefore answers "what is this team doing?" well, but it cannot answer "where am I needed?". That second question is the one I open a monitoring app for.

The good news: most of the data needed for a cross-project view already exists or arrives in Phase 3b and Phase 4.
- `SessionSummary` already carries `live` and `registryStatus` (busy / idle / waiting) for **every** session.
- Hooks (Phase 4) send `Notification` and permission events, with session id and cwd, from every project that has them installed.
- The required changes are mostly IA and UI. They do not need a new data engine.

---

## 2. What breaks down (walkthrough of a real hour)

1. **09:05: "Is anything waiting on me?"** The header says `0 needs you`. That only covers the selected session. Project B's lead has been waiting on a permission prompt for 12 minutes. **The counter is worse than nothing because it gives false reassurance.** The project dropdown says `B · 1 live` and gives no hint of waiting or needs-you.
2. **Finding the blocked project.** I open the native `<select>` and read 5 names. I pick one, then wait for the Session picker's "Auto (latest)" to choose a session. If that project has two live sessions (lead plus a second terminal), Auto may pick the wrong one. Each check costs about 3 clicks and a re-render, done 5 times.
3. **Approving.** Once the Phase 3b permission UI exists, it lives in the lead console of the selected session only. Approving in project B means switching away from project A, losing A's agent selection, inspector tab and scroll position, and then switching back. Nothing preserves per-project view state. Only the project key is remembered.
4. **"Which account am I on?"** The account chip and the 3 px edge come from `accounts.activeAccountId` / the default account. They do not come from the **viewed session's** `accountId`. When I view a personal-account session, the chrome can still show the company color. The spec treats account color as a safety signal, so this is a correctness issue as well as a UX one. **Verify and fix.**
5. **63-agent session (screenshot p3r3-header).** 62 cards say "Done · SubagentHandback". The one running card (the lead) is the first card, but in the middle of a run the interesting cards are scattered. **The grid is sized for 4–8 live teammates, not for long factory runs.** Finished agents should collapse.
6. **Lead console.** Every line is an absolute temp path wrapped over 2–4 lines (screenshots p3r3-team, p3r3-resized). Most of the events are noise to a lead: Read/Edit of scratch files. The meaningful lines get buried: assistant text, questions, errors, permission asks, task done. The same goes for the inspector's Files tab, where absolute paths wrap 4 lines.
7. **Token control.** I see one session's total (6.89M) and, on the Accounts screen, the per-account day total (9.41M + 311M cached). I cannot see:
   - which project is burning tokens today,
   - the rate (tokens per minute),
   - a runaway sub-agent in a project I am not viewing.
8. **Labels and leftovers.**
   - "Assigned task" shows a branch name.
   - The header repeats `team: <title>` truncated next to the project picker.
   - "Pause all" and "+ New teammate" do not say their scope. Is "all" this session or every project?
   - "older history not loaded" sits in the middle of the header.
   These are small, but the header is already crowded at 1440 px (p3r3-team truncates the project, account and team name all at once).
9. **Leaving the app.** A lead does not stare at this window. They are in VS Code. Today nothing reaches me outside the window: no notification, no taskbar signal, no tray.

---

## 3. Constraints I accept (and how they shape the proposals)

- **External sessions (VS Code, other terminals) cannot be messaged, paused or approved from the app.** Claude Code has no injection API. For those, the app's job is **detect → tell me → take me there** (focus/open VS Code at that folder). It is not "approve here". The UI must say this honestly: an inbox item from an external session gets a "Go to VS Code" button, not a fake Approve.
- **App-launched sessions (Phase 3b, stream-json, permission-prompt tool) can be approved in the app.** This is the strongest reason for a lead to *start* sessions from Agent Console. The UX should push me there gently, without nagging.
- **Hard rules:** no credentials, nothing written to Claude settings without the explicit install button and preview, local only. All proposals below are local. Notifications use the OS notification API. Nothing goes to the cloud.
- Reality-wins rule: "needs you" for external sessions before hooks comes only from registry `waiting`, open AskUserQuestion/ExitPlanMode, and API errors. That is good enough for v1 of the inbox. Hooks make it exact.

---

## 4. Proposals, prioritized

Cost: **S** = up to a day, renderer only. **M** = a few days, or touches main/IPC. **L** = a week or more, or a new data path.

### MUST (without these, the multi-project lead does not use the app)

#### M1. Project rail with per-project status badges (replaces the Project `<select>`)
- **Problem:** I cannot see the state of 5 projects at once. Switching costs 3 clicks and gives no signal.
- **UI:** A slim, collapsible left rail (about 56 px icon mode, about 200 px expanded), to the left of the Worktrees column. It holds one row per project:
  - avatar/initials,
  - name,
  - an **account color stripe** on the left edge (company blue / personal amber),
  - a status badge with the worst state wins: red `needs-you` count > amber pulsing `running` > blue `waiting` > none.
  - Hover shows: live sessions, running agents, tokens today.

  Sorting:
  - Pinned projects sit at the top, in a fixed order. **Ordering must not jump around under the mouse.** Unpinned projects sort by last activity.
  - Projects with no live session and no activity in more than 24 h sit under a collapsed "Idle (n)" section.

  Clicking a row switches the project. Right-click offers Pin/Unpin, Open in VS Code, Hide.
- **Data:** `deriveProjects(sessions)` plus `registryStatus` already give live/waiting per project. Running/needs-you for sub-agents of a non-selected project needs either hooks (Phase 4) or a light per-live-session status pass (see M2).
- **Cost:** M. The rail UI is S. The cross-project status feed is M.
- **Against bloat:** no tree of sessions inside the rail. One row per project. Sessions stay in the session picker.

#### M2. Global "Needs you" inbox across all projects
- **Problem:** The only question that matters every few minutes, "who is blocked on me anywhere?", cannot be answered.
- **UI:** A header button `● 3 need you` (red when > 0), counted **globally**. It opens a popover/drawer listing one row per blocking item, oldest first:
  - project,
  - account dot,
  - agent name,
  - reason (Permission: `Bash npm publish` / Question / Plan approval / API error / Idle waiting for input),
  - waiting time ("12m").

  Each row has actions that depend on who owns the session:
  - **App-launched session:** inline **Allow / Deny** (with "Allow always for this tool" only if the CLI permission response supports it, which must be verified), or **Reply** for AskUserQuestion. Approving here must not switch my current project.
  - **External session:** **Go to** (switch project + select agent) and **Open in VS Code** (`code <cwd>`). There is no fake approve button, and a small "external — answer in VS Code/terminal" label explains why.

  The per-session header counter stays, but is labeled "in this session". The headline number is global.
- **Data:** Before hooks, the inbox uses registry `waiting` plus the open AskUserQuestion/ExitPlanMode/API errors of all **live** sessions. That requires tailing the tail of each live session's main transcript, not just the selected one. This is cheap: live sessions are few, and the tailer exists. After hooks, `Notification`/permission events feed the inbox directly. In-app permission requests from 3b come straight from the stream-json control channel.
- **Cost:** M (pre-hooks, live-only scan) + S (hooks feed after Phase 4).
- **Rule:** an item disappears when resolved. Do not keep a history list here; that is the timeline's job.

#### M3. Desktop notifications + taskbar attention (outside the window)
- **Problem:** I live in VS Code. A monitor that only works while visible is a monitor I forget.
- **UI:**
  - An OS toast on **new** needs-you items only, never on "running" or "done". Text: `B · lead needs permission: Bash npm publish`. Clicking the toast focuses the app on that item.
  - On Windows: `BrowserWindow.flashFrame` while needs-you > 0, plus a taskbar **overlay icon** with the count (`setOverlayIcon`; `app.setBadgeCount` is not reliable on Windows).
  - Optional tray icon with the same count.

  Settings: per-project mute, and a global "Do not disturb" that is also on by default while the app window is focused and the item is visible.
- **Optional:** a "team finished" toast (lead Stop with all sub-agents done). Opt-in per project, off by default.
- **Cost:** S–M (Electron APIs + dedupe logic).

#### M4. Account truth per session, everywhere
- **Problem:** Wrong-account work is the most expensive mistake (company code on the personal account or the reverse). The chrome must never lie.
- **UI:** The header chip and the 3 px edge use the **viewed session's** `accountId`, not the global active/default account. The project rail stripe shows the account of that project's live session(s). If one project has live sessions on **two** accounts, show a split stripe plus a warning icon. That is almost always a mistake. Inbox rows carry the account dot. "New session" (3b) preselects the account by folder rule and shows it big in the launch dialog.
- **Cost:** S (fix the selector + rail stripe). **This one is close to a bug fix, so do it first.**

#### M5. Per-project view state is kept when switching
- **Problem:** Jumping to approve something in B and coming back to A loses A's selected agent, inspector tab, scroll, console draft and session pin.
- **UI:** Remember per project: the selected session (pinned or auto), selected agent, inspector tab, console draft, and the scroll positions of the console and grid. Switching back restores them exactly. "Auto (latest)" must **never** switch sessions under me while I have a draft or an open permission dialog. In those cases it becomes sticky.
- **Cost:** S–M (store refactor: `perProject: Record<key, ViewState>`). The main process keeps a single selected model, so this is renderer state only.

### SHOULD (big quality-of-life gains for a lead; do right after the musts)

#### S1. Keyboard switcher and attention navigation
- **Problem:** Mouse-only switching across 5 projects is slow. The spec's Phase 6 asks for keyboard shortcuts anyway.
- **UI:**
  - `Ctrl+K`: a quick switcher with fuzzy search over projects, sessions and agents, where each result shows status and account dot.
  - `Ctrl+1…9`: pinned projects.
  - `Ctrl+J` / `Ctrl+Shift+J`: jump to the next / previous needs-you item **globally**.
  - In the inbox: `A` allow, `D` deny, `Enter` go to, `Esc` close. Allow requires focus on the specific row, so there is no accidental global allow.
  - `?` shows the cheat sheet.
- **Cost:** S–M.

#### S2. Cross-project token summary ("where are my tokens going today")
- **Problem:** Keeping usage in check needs a per-project and per-account breakdown, plus early warning on runaways.
- **UI:**
  - Header: one compact token figure, **today, all projects**, with the account split on hover. It replaces the per-session total, which moves into the session context line.
  - Clicking it opens a small table: project × account → tokens today (input + output + cache writes, cached shown separately as now), live rate (tokens per minute over the last 10 min), and top agent.
  - A user-set daily soft budget per account (a number I type, **not** a fake plan limit) colors the figure amber at 80% and red at 100%. It can also raise an inbox item ("Personal account passed your 5M soft budget").
  - A "runaway" hint when one agent burns more than X tokens/min for more than N min (thresholds in settings). This is an inbox item of type "attention", not a blocking alert.
- **Data:** `usageToday` is per account today. Per project needs grouping by session project key in the same pass. Rate needs a rolling window.
- **Cost:** M.
- **Against bloat:** no charts and no history beyond today in this phase. Spec rule: no fake limit percentages.

#### S3. Grid that scales: active-first + collapse finished + compact density
- **Problem:** The 63-card session is unreadable, and only 1 card matters.
- **UI:**
  - Sort order: needs-you → running → waiting → done.
  - Finished sub-agents collapse into one row, "58 done · 3.1M tok · show", which expands inline.
  - A density toggle (Comfortable / Compact). Compact = one 32 px row per agent: dot, name, current tool+target, tokens, elapsed, **like a process list**. Compact is the one view I would actually use with 4 projects open.
  - Keep the tree indent for sub-agents in both modes.
- **Cost:** S–M.

#### S4. Lead console: "lead-relevant" filter and path shortening
- **Problem:** The console is a raw tool log, and wrapped absolute temp paths dominate it.
- **UI:**
  - Filter chips: **Messages & asks** (default) / Tools / Errors / All.
  - Paths are shown relative to the project root (`src/…`), and scratchpad/temp paths are collapsed to `‹tmp›/fix3.py`. The full path shows in a tooltip and on copy.
  - Single-line rows with expand on click.
  - The same path shortening applies to the inspector Files tab and the agent cards.
- **Cost:** S.

#### S5. Clear scope on every bulk/control action
- **Problem:** "Pause all" and "+ New teammate" do not say which project, which session or which account. For a multi-project lead that is dangerous.
- **UI:**
  - Labels carry the scope: "Interrupt lead (project B)". Never offer a cross-project "Pause everything" in v1.
  - Disabled states explain *why* (external session).
  - "Stop process" for an external session opens a confirm dialog that names the project, session title, pid and account.
  - "+ New teammate" becomes "**+ New session** in <project> as <account>" until real teammate spawning exists. That is honest, and it is the thing I actually need.
- **Cost:** S (copy + dialog).

### COULD (nice, but only after the above prove themselves)

- **C1. "All projects" overview screen.** One row per project: account, live sessions, running/needs-you counts, tokens today, worktrees with overlap warnings, last activity. It is useful in the morning and at end of day. If M1 + M2 + S2 are done well, it is mostly redundant. **Build it only if the rail feels cramped.** Cost: M.
- **C2. Cross-project overlap view.** Overlaps *within* a repo (Phase 5) matter a lot. Overlaps *across* repos are rare, except for monorepo plus shared libraries. Skip it unless a user asks. Cost: M.
- **C3. Detach / multi-window** (pop a project out into its own window for a second monitor). Electron makes it possible, but it doubles the state-sync complexity. Wait for demand. Cost: L.
- **C4. Per-project tabs (browser style).** I argue **against** them. With a rail plus Ctrl+K plus per-project state, tabs only duplicate the rail and eat vertical space. Do not build them.
- **C5. Inbox history / audit log of approvals** ("what did I allow today"). It is valuable for company compliance later. Keep it as a local append-only log for app-controlled approvals only. Cost: S–M.
- **C6. Quiet hours / focus mode.** Notifications only for permission prompts, not for questions or idle. Cost: S.

---

## 5. Things I would push back on in the current plan (anti-bloat)

1. **Request D, "everything resizable"** (5 more splitters). Acceptable, but it is the lowest-value item in the 3b5 request for this user. **Density mode (S3) and collapsible panels matter more than drag handles.** I would rather have the Worktrees and Inspector columns **collapse to an icon strip with one key** (`Ctrl+B` / `Ctrl+I`) than fine-tune 5 heights. If the time budget is tight, ship the horizontal splitter for grid↔console and drop the rest.
2. **Timeline swimlanes** across 63 agents will be unreadable. Show swimlanes for running/needs-you agents plus the lead only, with done agents collapsed (same rule as S3).
3. **No dashboards beyond today**: no charts of tokens over weeks, no cost estimates in currency (plans differ, and the spec forbids fake limits).
4. **Do not build an approve UI that pretends to work for external sessions.** Honest "Go to VS Code" is better than a disabled Approve button that confuses me.
5. **Do not auto-switch the visible project** when something needs me. Notify, badge and offer a jump. Never steal the view while I am typing or approving something else.

---

## 6. Suggested sequencing with the architect's 3b + 5 + 4 + 6 plan

| When | Items | Why then |
|---|---|---|
| With 3b (control) | **M4** (account truth), **S5** (scoped actions + honest labels), inbox rows for **app-launched** permission prompts (part of M2) | 3b creates the permission prompts. Their first home should be the global inbox, not only the lead console. |
| With 5 (worktrees) | **S3** (grid density/collapse), timeline limited to active agents, **S4** path shortening (shared helper for worktree cards + files) | Same components are being touched. |
| With 4 (hooks) | **M1** rail badges fed by hooks, **M2** full inbox for external sessions, **M3** notifications | Hooks are what make cross-project needs-you exact and cheap. |
| Phase 6 (polish) | **S1** keyboard switcher + shortcuts, **M5** per-project view state (if not done earlier), **S2** token summary | Phase 6 already plans keyboard shortcuts and polish. |

If only one thing can be done before Phase 4, do **M2-lite**: a global needs-you count in the header, computed from registry `waiting` across all live sessions, plus a list that jumps to the session. It is about S–M in size and fixes the "0 needs you" false reassurance immediately.

---

## 7. Open questions for the architect

1. Can the main process keep a **light status model** (last open tool, waiting/needs-you, tokens today, rate) for **all live sessions** while it keeps a **full model** only for the selected one? This split is what makes M1/M2/S2 work before hooks. What is the cost with 5 live sessions and big transcripts?
2. Does the CLI's permission-prompt channel (stream-json control request) let the app answer **without** the session being the selected one? It should, since the controller owns the process. Does it support "allow always / for this session"?
3. Is there a reliable way to **focus the right VS Code window** for an external session (`code <cwd>` reuses the window that has the folder open)? Or do we just open the folder and accept a new window sometimes?
4. Windows notification identity (AppUserModelID) needs to be set for toasts to show from a packaged app. Is that in the Phase 6 packaging scope?

---

## 8. Rebuttal (round 2, after plan.md "UX debate" and T18/T20/T21/T22)

**Overall: accepted.** All the MUSTs are in, the honest external/controlled split is right, and the deferrals are fair:
- budget and runaway alerts move to Later;
- no tray icon;
- no agent fuzzy search;
- splitters stay, because the user asked for them.

I push back on only 4 points. Each one would make the product wrong for a lead. Each fix is small.

1. **Never put Allow next to a truncated command.**
   - `AttentionItem.detail` is a single string, and toasts cut it at 80 characters. If the inbox row shows the same short text, I could approve `Bash rm -rf … && npm publish` after seeing only its first 80 characters. A one-click approval from a different project is exactly where that mistake happens.
   - **Minimal change:**
     - T01: add `toolName?: string; input?: string /* full, display-capped at ~4 kB */` to `AttentionItem` for permission items.
     - T22: the row shows the full command or file path in mono text, plus the cwd/worktree. **Allow** and **Allow for this session** are enabled only when the full input is visible: either it fits, or the row has been expanded with Enter/click. Otherwise the button shows "Expand to review".
     - Test: a long input keeps Allow disabled until the row is expanded.
   - **Cost:** S. **Why:** a wrong Allow costs far more than one extra click.

2. **Separate "blocked on me" from "finished, ready for you".**
   - `input` merges registry `waiting` and Notification `idle_prompt`. An idle lead that has finished its turn is not blocked; it is done. With 5 projects, most leads sit idle most of the day, so the red badge and the toasts would be permanently on. A permanently red badge is one I learn to ignore, and then I miss the real permission prompt.
   - **Minimal change:**
     - T21: split the kind into `blocked` (permission, question, plan, `agent_needs_input`, elicitation) and `idle` (`idle_prompt`, `agent_completed`, registry idle after a turn).
     - Only `blocked` items count toward the red "need you" number, the rail's red badge, flashFrame, the overlay count and default toasts.
     - `idle` items appear in the inbox under a separate "Ready for you (n)" group and as a blue rail badge. Toasts for them are off by default, with a pref to turn them on.
     - Test: an idle_prompt item never raises the red count.
   - **Cost:** S. **Why:** the inbox only works if red means "blocked".

3. **Show where the "needs you" count is blind.**
   - Without hooks, sub-agent prompts in external sessions are not detected (accepted). But a rail with no red badge then looks the same as "nothing needs me", which is the same false reassurance this review started with. A rail tooltip that nobody hovers is not enough.
   - **Minimal change:**
     - T01/T21: add `hooksActive: boolean` to `ProjectStatus` (installed in the project's `settings.local.json`, or any hook event in the last 24 h).
     - T22: projects with a live external session and no hooks get a small hollow "partial" ring on their badge. The inbox footer says: "2 projects without hooks: sub-agent prompts are not detected · Install hooks…". The link opens the existing explicit Hooks dialog, so nothing is installed silently.
   - **Cost:** S. **Why:** the user must know when an empty inbox can be trusted.

4. **Jumping to an item must work from any screen.**
   - `focusItem` calls `setProject`/`selectSession`/`selectAgent` but never `navigate('team')`. Clicking a toast or pressing Ctrl+J while the Accounts screen is open would change hidden state and show nothing. The inbox button also lives only in the Team header.
   - **Minimal change:**
     - T22: `focusItem` calls `navigate('team')` first.
     - Ctrl+J works on every screen.
     - The Accounts header shows the same "● N need you" button. Reuse the component; it is about 3 lines in AccountsHeader.
   - **Cost:** S. **Why:** notifications that lead nowhere get turned off.

Everything else is accepted as planned.
