# Agent Console — build spec

Build a desktop app called **Agent Console** in this repo (empty, github.com/longpl-1902/claude-ui).
It is a GUI "command prompt" for Claude Code that shows, live, what every agent in a
Claude Code agent team / sub-agent run is doing, which git worktree each one works in,
and which Claude account (company or personal) a session uses.

Screenshots of the target UI are attached. Match them closely.
(Mockups: `docs/design/team-view.mockup.html`, `docs/design/accounts.mockup.html`,
original bundle `docs/design/Agent Console.html`.)

## Stack
- Electron + Vite + React + TypeScript (strict). Use electron-vite or an equivalent template.
- Terminal: xterm.js in the renderer, node-pty in the main process to run the real `claude` CLI.
- File watching: chokidar. Git: shell out to `git` (no libgit bindings).
- State: Zustand in the renderer. IPC through a typed preload bridge (contextIsolation on,
  nodeIntegration off).
- Target Windows first (I use Windows + VS Code), keep macOS/Linux working.
- Package with electron-builder. Use electron-rebuild for node-pty.

## Hard rules
1. Never read, copy, or store Claude login tokens or credentials. Auth is always handled by
   the official `claude` CLI. We only launch it with the right environment.
2. Before relying on any Claude Code detail (hook event names, hook JSON payload fields,
   transcript file locations and line schema, `.claude.json` fields, CLI flags, VS Code
   extension setting names), verify it with `claude --help`, the installed package, or
   docs.claude.com. If something differs from this spec, follow reality and tell me.
3. Never edit my Claude settings silently. Installing hooks is an explicit button with a
   preview of the exact JSON that will be written, and an "Uninstall" button.
4. The local event server binds to 127.0.0.1 only, on a random port, and requires a random
   per-launch token in a header.
5. Write tests (vitest) for every parser and the overlap detection.

## Data sources (main process)

### 1. Hook events (realtime)
- "Install hooks" writes hook entries into `<project>/.claude/settings.local.json` for the
  events that exist in the installed version (expected: PreToolUse, PostToolUse,
  SubagentStop, Stop, Notification, UserPromptSubmit, SessionStart/SessionEnd, plus any
  agent-team events such as TeammateIdle / TaskCompleted if they exist).
- Each hook runs a tiny bundled script, `agent-console-hook` (Node), that reads the hook JSON
  from stdin and POSTs it to the local server. It must exit 0 quickly and never block Claude,
  even if the app is closed.

### 2. Transcripts (history + fallback)
- Watch `<configDir>/projects/**/*.jsonl`, including sub-agent transcripts if they are stored
  separately. Tail files incrementally and parse each line into a normalized event.
- Use `parent_tool_use_id` / session ids (verify the field names) to build the tree:
  lead → teammates / sub-agents.

### 3. Git worktrees
- `git worktree list --porcelain`, `git status --porcelain`, `git rev-list --left-right --count`,
  and `git diff --numstat main...<branch>`. Poll every 5 s plus on file change.
- **Overlap detection:** a file changed in 2 or more worktrees triggers a warning banner
  naming the file and the agents involved.

### 4. Accounts
- An account profile is `{ id, name, color, configDir, folderRules[] }`, stored in the app's
  userData as JSON.
- **Detection:**
  - Look for the default `~/.claude` (used by the VS Code extension + CLI) and other
    `~/.claude-*` dirs.
  - Read only the email/organization display fields from that dir's `.claude.json` (verify
    the field names, e.g. `oauthAccount`).
  - Scan VS Code user and workspace `settings.json` for a `CLAUDE_CONFIG_DIR` set through the
    Claude Code extension's environment-variables setting.
- **Sign in:** spawn `claude` in a pty with `CLAUDE_CONFIG_DIR=<dir>` and let the CLI run its
  own browser login (`/login`). Detect completion by watching the config dir for change, then
  re-read the display fields.
- **Folder rules:** glob → account, first match wins, with an "Ask me" fallback.
- **Account safety:**
  - Lock the account once a team session has started.
  - Warn before a personal account opens a folder matched to the company account.

### Normalized event (shared type)
```ts
type AgentEvent = {
  ts: string; sessionId: string; agentId: string; parentAgentId?: string;
  kind: 'tool_start' | 'tool_end' | 'message' | 'status' | 'error' | 'spawn' | 'stop';
  tool?: string; target?: string;     // e.g. "Edit", "src/Api/SheetDto.cs"
  result?: string; tokens?: { input: number; output: number };
  worktree?: string; accountId: string;
}
```
- Agent status is derived:
  - running = an open tool or recent activity
  - waiting = blocked or idle and waiting on a task or message
  - needs-you = error, or a permission / notification prompt
  - done = stopped

## UI (renderer)

### Design tokens
- Backgrounds: `#0E0F11` app, `#121417` panels, `#16181C` cards. Borders: `#23262C`.
- Text: `#E6E7EA`, muted `#A4AAB4` / `#8E95A0`.
- Accent: `#7AA7FF`.
- Status colors, always paired with a text label: running `#F2A541` (pulsing dot),
  waiting `#8FB4FF`, needs-you `#FF8A8A`, done `#5ED3A8`.
- Account colors: Company `#6E9BF0`, Personal `#F2A541`.
- Fonts: Inter for UI, JetBrains Mono for paths / commands / logs.
- Radius: 8 px controls, 10–12 px cards.
- Accessibility:
  - Real buttons with visible focus, keyboard navigable.
  - Text contrast ≥ 4.5:1.
  - Honor prefers-reduced-motion.

### Screen 1: Team view (3 columns, collapses on narrow windows)
- **Header**
  - App name, repo / team name.
  - Account chip (color + name + email; click opens Accounts).
  - A 3 px top border in the active account's color.
  - Counters: agents, running, needs-you, total tokens.
  - Buttons: "Pause all", "+ New teammate".
- **Left column**
  - Worktrees list: branch, path, agents on it, changed files, ahead count; amber border
    when it overlaps another worktree.
  - Shared task list with status: done / in progress / blocked by #n / failing.
- **Center column**
  - Overlap warning banner with a "Compare diffs" button.
  - Agent cards grid (`auto-fill`, min 260 px). Each card shows: avatar initials, name,
    role, status pill, a mono line with the **current tool call** (tool name colored +
    target), worktree, elapsed, tokens, call count. Clicking a card selects it.
  - Timeline: one swimlane per agent over the last 20 min, with segments colored by
    activity (thinking / read / edit / bash / error) and a legend.
  - Lead console: the event stream of the whole team, plus a prompt input. Plain text goes
    to the lead; `@agent` messages a teammate; `/` shows commands. Also provide a toggle to
    show the raw xterm terminal of the lead session.
- **Right column (inspector for the selected agent)**
  - Header + stats (elapsed, tokens, tool calls), the assigned task, the worktree.
  - Tabs:
    - Activity: vertical timeline of tool calls with result lines; failures in red.
    - Files: changed files with +/−, and "Open full diff against main".
    - Messages: the agent's mailbox, in / out.
  - Actions: Message agent, Open worktree (in VS Code: `code <path>`), Pause, Stop.

### Screen 2: Accounts
- **Detected logins:** each found config dir with the email / org it shows, where it was
  found (VS Code extension, CLI, `.vscode/settings.json` path), and an action:
  "Linked as X" / "Use this" / "Sign in".
- **Sign-in flow panel:** 3 steps (folder → sign in on claude.ai → ready), with buttons
  "Check now", "Open browser again", "Cancel".
- **Privacy line:** "Agent Console reads only the email and organization name. Login tokens
  stay where Claude Code stored them."
- **Account cards:** name, email, plan (only if available, otherwise hidden), status, config
  folder, buttons (Set as default, Sign in again, Rename & color). Show usage only if a real
  source exists; otherwise show tokens used today, summed from transcripts. Do not fake
  limit percentages.
- **Folder rules table:** pattern / account / note, plus "+ Add rule".
- **Safety toggles:**
  - Warn when the personal account opens a company folder.
  - Show the account color on the window edge.
  - Lock the account once a team has started.
- **"When an account hits its usage limit":** Pause and ask (default) / Wait for reset /
  Switch account. Switch account is allowed only for personal folders.
- **Running now:** sessions with their account.

## Phases (stop after each one for my review)
1. Scaffold Electron + React + TS, the design tokens, both screens built with mock data
   matching the screenshots, typed IPC skeleton.
2. Accounts: detection, profiles, folder rules, launching `claude` in a pty with
   `CLAUDE_CONFIG_DIR`, sign-in flow.
3. Transcript watcher + parser → live agent cards, inspector, and lead console. Tests.
4. Hook installer + local event server + hook script → realtime updates. Tests.
5. Worktrees + diff stats + overlap detection. Timeline swimlanes.
6. Polish: empty states and error messages, keyboard shortcuts, packaging for Windows,
   README with setup steps.
