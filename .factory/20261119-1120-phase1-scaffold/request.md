# Request: Agent Console - Phase 1

Spec: docs/spec.md (full product). This run delivers **Phase 1 only**:

> Scaffold Electron + React + TS, the design tokens, both screens built with mock data
> matching the screenshots, typed IPC skeleton.

UI source of truth: docs/design/team-view.mockup.html and docs/design/accounts.mockup.html
(extracted from the user's mockup docs/design/Agent Console.html). Match them closely.

## Clarifications
- Repo was empty; initialised with git, branch main, remote github.com/longpl-1902/claude-ui (no push).
- Toolchain: Windows 11, Node 24.15, npm 11.12, git 2.53, Claude Code CLI 2.1.309.
- Phase 1 needs no real data sources. Main-process services (accounts, transcripts, hooks, git)
  are only typed IPC channel stubs returning mock data, so phases 2-5 can fill them in.
- node-pty / xterm: install deps and wire the raw-terminal toggle UI with a placeholder pane in Phase 1;
  real pty is Phase 2. If node-pty fails to build on this machine, report it rather than blocking Phase 1.
- Tests: vitest set up now; Phase 1 tests cover the derived-status logic, mock data shape and the store,
  plus a render smoke test of both screens.
- Stop after Phase 1 for user review. Do not push.
