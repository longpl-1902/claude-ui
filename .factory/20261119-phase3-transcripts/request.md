# Request — Phase 3: Transcript watcher + parser → live team view

From docs/spec.md, phase 3: "Transcript watcher + parser → live agent cards, inspector, and lead console. Tests."
Relevant spec: "Data sources → 2. Transcripts", "Normalized event (shared type)", derived agent status, Screen 1
(agent cards, inspector tabs Activity/Files/Messages, lead console event stream), Accounts card "tokens used today".

Scope
- Main: watch `<configDir>/projects/**/*.jsonl` for every account profile (chokidar), including sub-agent / teammate
  transcripts wherever the installed CLI stores them. Tail incrementally (byte offset per file, partial last line kept),
  parse each line into AgentEvent, build the tree lead → sub-agents / teammates from the real linking fields.
- Session model: pick a project folder (or the folder of the running pty session) → its sessions; the newest/active
  session is the "team". Agents = lead + sub-agents/teammates seen in that session. Push normalized events + derived
  agent state to the renderer over typed IPC (batched).
- Derived status per spec: running / waiting / needs-you / done (define thresholds, test them).
- Renderer: agent cards, inspector (Activity, Files — changed files from Edit/Write tool calls, Messages — agent mailbox
  if the format has one), lead console event stream: live data replaces mock for these. Keep mock only behind an explicit
  "demo data" fallback when no session exists (or show an empty state — architect decides, tell the user).
  Worktrees/overlap/timeline swimlanes are Phase 5 — leave them (mock or empty) but don't break them.
- Accounts card "Tokens used today": sum real usage from transcripts per account (only if the usage fields exist).
- Lead console prompt input stays non-functional (Phase 3b drives a session).

Hard rules: verify transcript location, line schema, sub-agent storage and linking fields against the INSTALLED CLI
(2.1.309 npm; note VS Code extension bundles 2.1.326) and real files — but treat transcript content as private:
inspect structure (keys, types, `type` values) only, never copy message text/code/paths into the repo. Test fixtures
must be synthetic or fully redacted. Never read credentials. Tests (vitest) for every parser, the tailer, tree builder,
status derivation and token summing. Report every spec mismatch.
