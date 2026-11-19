# Agent Console

A Windows desktop app (Electron + React) that shows what your Claude Code sessions are doing, project by project,
and lets you start and steer sessions from one window. It reads the files Claude Code already writes to disk and,
only when you ask, drives the `claude` CLI.

> **The app never sends anything to Claude unless you press Send, Allow, Deny, Interrupt or another explicit
> button.** Opening a project, browsing sessions or watching a live view spends no tokens.

## Requirements

- Windows 10 or 11.
- Node.js 22 or newer (needed for development, and on the machine that runs Claude Code if you install hooks).
- Claude Code CLI installed and signed in (`claude` must work in a terminal).
- git (worktrees, overlaps and diffs use it).
- VS Code is optional (used for "open in editor").

## Install from Releases

1. Download `AgentConsole-Setup-<version>.exe` from the repository's Releases page.
2. Run it. The installer is unsigned, so Windows SmartScreen may ask you to confirm ("More info", then "Run anyway").
3. Choose the install folder (per-user install, no admin rights needed).

## Development setup

```
npm ci
npm run dev          # electron-vite dev server with hot reload
npm run preview      # run the production build locally
npm test             # unit tests (vitest through scripts/vitest.mjs)
npm run typecheck    # node, web and tests projects
npm run build        # production build + bundle checks (one React copy, strict CSP, hook script)
npm run package:win  # build + Windows installer in dist/
```

CI uses `npm run package:win -- --publish never`; pushing a tag `vX.Y.Z` that matches `package.json` builds the
installer and attaches `AgentConsole-Setup-<version>.exe`, its `.blockmap` and `latest.yml` to a GitHub Release.
No code signing is configured (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## First run

- **Accounts**: the app detects Claude Code config folders on this PC (the default one, and others you set up with
  `CLAUDE_CONFIG_DIR`), lets you link them and shows whether each is signed in. Signing in opens the `claude`
  login flow in a terminal; the app never handles your password. The account chip in the header shows the account of
  the session you are viewing (a running session keeps its account); its menu picks the account new sessions start
  with, unless a folder rule chooses another.
- **Folder rules**: choose which project folders appear (for example `C:/Users/u/acme`) and which are ignored.
- **Safety toggles**: features that write anything (hooks, starting sessions, stopping processes) can be turned off,
  and every write shows a preview first.

## Team view

Pick a project and a session from the pickers at the top. The view shows the lead agent, its sub-agents, tasks, a
timeline and an inspector. Panels are resizable and collapse on narrow windows (the left column becomes a drawer).
A badge tells you whether data is **live** (read from a running or recent session) or **demo** (sample data shown
when nothing is found).

## Controlled sessions

Sessions started by the app run `claude` as a child process with stream-json I/O, so the app can:

- start, resume, continue or fork a session;
- pick the model and permission mode;
- answer permission prompts (Allow, Allow for this session, Deny);
- interrupt the current turn or stop the process;
- show a context meter, the running cost and MCP server chips for the session;
- rename the session;
- rewind or fork from a message (after a confirmation).

Allow is not offered next to a truncated command; expand the full tool input first. Nothing is sent on your behalf.

## Chat view

The **Team | Chat** toggle (Ctrl+Shift+C) switches the center between the team grid and a conversation view with
rendered markdown.

- **Composer**: a switch picks the send key (Enter, or Ctrl+Enter with Enter for a new line); `/` opens the command
  palette; `@` mentions a teammate; images can be attached, pasted or dropped. Nothing is sent except by the send
  key or the Send button.
- **Cards**: permission prompts, question cards and plan cards appear in the conversation and are answered in place.
- **External (VS Code) sessions** are read-only. They can be forked into a session the app controls.

## Multiple windows / two monitors

Chat and project views can be popped out into their own windows.

- Ways to open one: the **Open in new window** button in the Chat header, the project rail menu, Ctrl+Shift+N, or
  dragging the Chat tab out of the window.
- At most 8 pop-out windows. Each window views its own session; sessions and data are shared by the app.
- Closing a pop-out never stops a session.
- Each window remembers its position, monitor and zoom. **Reopen pop-out windows on start** (Accounts, Appearance)
  controls whether they come back on the next launch.
- When a monitor is removed, its windows are rescued onto a remaining one.
- A toast, or Ctrl+J, focuses the window that already shows that session instead of opening another view.

## Theme

System, Light or Dark in Accounts, Appearance; Ctrl+Shift+L cycles through them. The app follows the Windows accent
colour and High Contrast. Window controls are the native overlay, and Windows 11 gets a Mica backdrop.

## Extensions

Ctrl+Shift+E lists MCP servers, plugins and skills per account and per project.

- Adding or removing an MCP server or a plugin runs `claude mcp ...` / `claude plugin ...` only after the app shows
  the exact command and you confirm.
- Secrets (tokens, keys, header values) are masked.

## Copy

Copy buttons sit on messages, the session id, paths and errors. Right-click offers Copy (and Copy link on links).

## External sessions

Sessions started in a terminal or in VS Code are shown read-only. The only action is **Stop process**, which asks
for confirmation first. Their sub-agent prompts appear in the app only when hooks are installed.

## Hooks

Hooks give live events from external sessions (permission prompts, idle, completed).

- **Install** adds a small command hook to `<project>/.claude/settings.local.json` (a local, usually git-ignored
  file). It runs `node <app data>/hook/agent-console-hook.cjs`, so Node 22+ must be on `PATH` for Claude Code.
- A **preview** shows the exact before/after of the settings file and the backup path
  (`settings.local.json.agent-console.bak`). Nothing is written until you confirm.
- **Uninstall** removes only the entries the app added (also previewed) and leaves your other settings untouched.
- Hook entries are asynchronous with a short timeout, so they never block or slow Claude. The script prints
  nothing, writes nothing and always exits 0.
- While the app runs it writes `endpoint.json` (loopback port and a random token, user-only permissions) into
  `%APPDATA%/Agent Console/hook/`. The script POSTs events to `127.0.0.1` only. When the app closes the file is
  removed and the hook does nothing.

## Worktrees, overlaps, tasks, timeline

- **Worktrees**: lists git worktrees of the project, with branch and dirty state.
- **Overlaps**: warns when two sessions or worktrees touch the same files; Compare diffs shows the difference.
- **Tasks**: sub-agent and task progress from the session transcript.
- **Timeline**: ordered events (prompts, tool calls, sub-agent start/stop) for the selected session.

## Project rail, Needs-you inbox, notifications

- **Project rail** (left edge): one icon per project with badges (red = blocked and needs you, blue = ready for
  you), pins (Ctrl+1..9 jump to pinned projects) and mute.
- **Needs-you inbox**: everything waiting for a human. For sessions controlled by the app you can Allow, Deny or
  answer in place. For external sessions the row only takes you to the session: answer it in its own terminal or
  VS Code window.
- **Notifications**: toasts and taskbar flash/overlay for blocked items only by default (ready items are opt-in).
  The taskbar flash covers every window; the overlay count stays on the main window.
  Do-not-disturb silences everything; each project can be muted separately.
- **Per-project view memory**: each project remembers its selected session, view (Team or Chat), panel sizes and
  collapsed columns.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+K | Open the project / session switcher |
| Ctrl+1 .. Ctrl+9 | Go to pinned project 1..9 |
| Ctrl+J / Ctrl+Shift+J | Next / previous session that needs you |
| Ctrl+L | Focus the lead prompt |
| Ctrl+Shift+T | Team view |
| Ctrl+Shift+A | Accounts |
| Ctrl+Shift+E | Extensions (MCP servers, plugins, skills) |
| Ctrl+Shift+C | Switch between Team and Chat view |
| Ctrl+Shift+L | Cycle the theme: System / Light / Dark |
| Ctrl+Shift+N | Open the current chat (or project) in a new window |
| Ctrl+W | Close this window (pop-out windows only) |
| Ctrl+Shift+M | Maximize / restore the lead console |
| Ctrl+B | Collapse / expand the left column |
| Ctrl+I | Collapse / expand the inspector |
| Ctrl+` | Toggle the raw terminal |
| Ctrl+. | Interrupt the running lead (never sends a message) |
| Alt+Up / Alt+Down | Previous / next agent |
| A / D / Enter | Needs-you inbox row: Allow / Deny / Go to |
| Esc | Close a dialog, drawer or the inbox |
| ? | Show this help |

## Privacy

**What the app reads** (read-only): session transcripts and the session registry under each linked Claude config
folder (for example `C:/Users/u/.claude/projects/...`), project folders you allow, git metadata of those projects,
plugin and skill folders, `.mcp.json` files, and a project's `settings.local.json` when you preview hooks.

**What it never reads**: OAuth or API tokens, `.credentials.json`, environment secrets, or anything in a
credentials store. Sign-in state is inferred from the CLI, not from token files. It makes no network calls except
the local hook server on 127.0.0.1 (the production Content-Security-Policy is `connect-src 'self'`).

**What it writes**: its own settings and window state in `%APPDATA%/Agent Console/`, the hook script and
`endpoint.json` there, and (only after a preview and your confirmation) a project's `.claude/settings.local.json`
plus its `.bak` backup. Confirmed extension actions run the `claude` CLI. Controlled sessions are written by the
`claude` process itself.

## Windows notes

- Use a **lowercase drive letter** in folder rules and when comparing paths (`c:/users/u/acme`); the app
  normalizes, but external tools may report `C:`.
- If the app starts as a plain Node process, `ELECTRON_RUN_AS_NODE` is set in your shell or IDE terminal. Unset it
  (`Remove-Item Env:ELECTRON_RUN_AS_NODE`); the dev scripts also clear it.
- **Do not run `npm run rebuild:pty`.** It tries to compile node-pty from source and needs a full C++ toolchain.
  The prebuilt binaries are enough; use `npm run check:pty` to verify. node-pty stays external and unpacked from
  the asar in the installer.
- Toasts in packaged builds use the app id `com.longpl.agentconsole` as the AppUserModelID. Dev builds may show
  toasts as "Electron".
- **No token spend rule**: nothing in the app, its tests or its build calls the Claude API or runs a session on its
  own. Keep it that way in contributions.

## Troubleshooting

- **claude not found**: make sure `claude --version` works in a new terminal; reinstall Claude Code or add its
  folder to `PATH`, then restart the app.
- **node-pty errors / raw terminal does not open**: run `npm run check:pty`. If it fails, run `npm ci` again. Do
  not run `rebuild:pty`.
- **Hooks show n/a**: the project has no installed hook, Node is not on `PATH`, or the app is closed (no
  `endpoint.json`). Reinstall from the preview, then start a new Claude session (hooks load at session start).
- **git feels slow**: large repositories make worktree and overlap scans slow; mute the project or limit folder
  rules to the repos you use.

## Known limits

- No per-account budget or runaway-rate alerts yet; no tray icon.
- Stopping individual background sub-agents is not supported.
- "Always allow" is per session only; no permission rules are written to settings.
- The inspector's "Open full diff against main" is disabled; use Compare diffs for overlaps.
- Sub-agent prompts of external sessions need hooks.
- The installer is unsigned.
