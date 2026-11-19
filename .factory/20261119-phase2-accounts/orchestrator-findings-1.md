# Orchestrator findings — run of the built app (npm run preview), 2026-11-19

Checked live with real data on the user's PC (screenshots taken, not committed — they show the user's email).

Works:
- Detection: ~/.claude found with email + organization, sources "Claude Code CLI (default folder), VS Code extension".
  ~/.claude-server-commander correctly NOT listed.
- "Use this" creates a profile (Default, Signed in, config "~/.claude (default folder)", tokens "—"); detected row
  becomes "Linked as …"; header chip shows the account; window edge colour appears.
- Raw terminal: picking the account and "Start claude" runs real Claude Code 2.1.309 in the pty in d:\personal\claude-ui;
  chip shows lock icon while it runs. Stop kills it, lock clears, launcher returns. App quit leaves no claude.exe/electron.

Bugs (FIX):
- O-1 Header wraps: with a real account the chip (org name + email, e.g. "x@y.vn's Organization  x@y.vn") is so wide
  that "Pause all" / "+ New teammate" wrap onto a second header row at a 1440px-wide window. Chip must truncate
  (max-width + ellipsis on name/email, full text in title/aria) so the header stays one row ≥1101px.
- O-2 Raw terminal launcher: the Account <select> stretches to ~200px tall (flex child grows). It must be a normal
  single-line control height like the Folder input.
- O-3 Accounts screen has two add buttons: header "+ Add account" is dead (no handler); cards area has
  "+ Add another account". Wire the header button to the same editor and name the card button "+ Add account"
  only when it is the only one, or drop the duplicate. Empty state: "No accounts yet…" text and the add button sit
  on one row with odd spacing.

Notes (no fix needed now):
- VS Code extension runs its own bundled claude (2.1.326) while the app launches the npm global CLI (2.1.309).
  Relevant for Phase 3b verification.
- Manual still open for the user: a real `claude auth login` sign-in for a new folder (opens browser).
