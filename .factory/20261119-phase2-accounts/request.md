# Request — Phase 2: Accounts

From docs/spec.md, phase 2: "Accounts: detection, profiles, folder rules, launching `claude` in a pty
with `CLAUDE_CONFIG_DIR`, sign-in flow." Relevant spec sections: "Data sources → 4. Accounts",
"Screen 2: Accounts", Hard rules 1–3.

Scope
- Main process: detect config dirs (default `~/.claude` + `~/.claude-*`, only real Claude config dirs),
  read ONLY email / organization display fields from the matching `.claude.json`, scan VS Code user +
  workspace settings.json for CLAUDE_CONFIG_DIR set via the Claude Code extension env-var setting.
- Account profiles `{ id, name, color, configDir, folderRules[] }` stored as JSON in app userData
  (plus safety toggles + limit policy from the Accounts screen).
- Folder rules: glob → account, first match wins, "Ask me" fallback. Unit tests.
- Launch `claude` in a node-pty with `CLAUDE_CONFIG_DIR=<dir>` (strip ELECTRON_RUN_AS_NODE), raw xterm
  in the renderer (lead console raw-terminal toggle uses it). Run `npm run rebuild:pty` first.
- Sign-in flow: spawn `claude` in pty with the dir, let the CLI do `/login`; detect completion by
  watching the config dir (chokidar), re-read display fields. 3-step panel, Check now / Open browser
  again / Cancel.
- Account safety: lock account once a team session started; warn before personal account opens a
  folder matched to company.
- Accounts screen + header chip switch from mock data to real data (mock remains for team/agents,
  which are Phase 3+). "Tokens used today" may stay as a placeholder until Phase 3 transcripts —
  never fake numbers; show "—" if no source.

Hard rules: never read/copy/store tokens or credentials (never open .credentials.json or keychain);
verify every Claude detail against the installed CLI 2.1.309 / package / docs and report mismatches;
no silent settings edits (Phase 2 writes nothing into Claude or VS Code settings); tests for every parser.

Known already: default account's `.claude.json` is at `~/.claude.json` (home), not `~/.claude/.claude.json`.
`~/.claude-server-commander` exists and is NOT a Claude config dir.
