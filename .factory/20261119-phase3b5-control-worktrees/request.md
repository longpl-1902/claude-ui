# Request — Phase 3b + Phase 5 + resizable layout (user request after Phase 3 review)

User (reviewing the running app, screenshots of the inspector actions and the left column placeholders):
"complete these function. all component can be resized"

## Scope
A. **Session control (spec Phase 3b).** The lead console drives a real Claude Code session started by Agent Console
   through the CLI structured mode (`claude -p --input-format stream-json --output-format stream-json`, plus
   `--include-partial-messages`, `--resume`, `--model`, `--permission-mode`, and the permission-prompt option — verify
   every flag/message shape against the installed CLI 2.1.309 + package before use). Send prompts and slash commands,
   stream replies and tool calls, answer permission prompts (Allow / Deny) in the GUI, resume / continue sessions, pick
   model and permission mode. Launched with the account's CLAUDE_CONFIG_DIR (unset for default), env stripped as in the
   pty layer; auth stays in the CLI. Raw xterm pty stays as the fallback toggle. Tests for the stream-json parser and
   control-message encoder.
B. **Inspector actions + header buttons.**
   - Message agent: for app-controlled sessions, sends to the lead (for a sub-agent, as a prompt addressed to it, e.g.
     "@<name> …" convention — architect decides and documents); disabled with an explanatory tooltip for external
     sessions (VS Code / other terminals) because Claude Code has no external injection API.
   - Pause = interrupt the current turn (app-controlled sessions only).
   - Stop = end the app-controlled session; for an external live session, offer "Stop process" (kill the pid from the
     live registry) only after an explicit confirm dialog. Never kill without confirmation.
   - Open worktree = `code <path>` with the agent's cwd/worktree path (works for all sessions).
   - Header "Pause all" / "+ New teammate": define real behaviour for app-controlled sessions (e.g. new teammate =
     start a new controlled session / prompt the lead to spawn one) or keep disabled with a clear reason — architect
     decides, tell the user.
C. **Worktrees + tasks + timeline (spec Phase 5)** for the selected git project: `git worktree list --porcelain`,
   `git status --porcelain`, `git rev-list --left-right --count`, `git diff --numstat <base>...<branch>`, poll every 5 s
   plus on file change; worktree cards (branch, path, agents on it, changed files, ahead/behind); overlap detection
   (file changed in ≥2 worktrees → banner naming file + agents, "Compare diffs") with vitest tests; agents mapped to
   worktrees by cwd. Shared task list from the real task tooling found in transcripts (verify which tools exist:
   TodoWrite / TaskCreate / TaskUpdate / team task files) with status done / in progress / blocked / failing.
   Timeline swimlanes per agent over the last 20 min from live activity (thinking/read/edit/bash/error) with legend.
D. **Everything resizable.** In addition to the existing left/right splitters: horizontal splitters between agent grid,
   timeline and lead console (center column), between Worktrees and Shared tasks (left column), and between the
   inspector's top section and its tab panel (right column); same a11y/keyboard/persistence rules as T12
   (src/renderer/src/components/layout/Splitter.tsx, hooks/usePanelWidths.ts). Collapse-to-zero not required.

## Rules
Hard rules 1–5 of docs/spec.md still apply (never touch credentials; verify Claude details against reality; no silent
settings edits; tests for every parser + overlap detection). Personal project: synthetic fixtures with neutral names
("acme", C:/Users/u), never real user/project names. Run the built app on real data before review.
