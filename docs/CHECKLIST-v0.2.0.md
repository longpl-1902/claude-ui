# Manual testing checklist -- v0.2.0

Run on Windows 11 with Windows Terminal. Two Claude accounts configured.

## Account picker

- [ ] Start `ac` with two accounts configured. Picker appears with both accounts listed.
- [ ] Email and org shown for signed-in accounts; "not signed in" for others.
- [ ] `j`/`k` navigates, `Enter` selects. Last-used account is preselected.
- [ ] Start `ac --account work` -- picker is skipped, goes straight to main screen.
- [ ] Start `ac` with only one account -- picker is skipped.

## Multi-instance

- [ ] Open two terminals: `ac --account work` and `ac --account personal`.
- [ ] Both instances run independently. Each shows its own account in the status line.
- [ ] Session controlled by instance A shows as read-only in instance B.

## Session list and navigation

- [ ] Sessions grouped by git project on the left pane.
- [ ] `j`/`k` moves cursor, `Enter` opens a session in the log pane.
- [ ] `za` folds/unfolds project groups.
- [ ] `Tab` switches focus between sessions and log panes.
- [ ] `ga` toggles showing all accounts' sessions.

## Send a prompt

- [ ] Select a session (or `:new`), press `i` to enter INSERT mode.
- [ ] Type a simple prompt, press `Enter` to send.
- [ ] Response appears in the log pane with tool calls collapsed.
- [ ] `Enter`/`za` on a tool call expands/collapses it.

## Permission handling

- [ ] When a permission card appears, `a` allows it.
- [ ] `A` allows for the session.
- [ ] `d` denies it.
- [ ] `]n` jumps to the next needs-you item.
- [ ] Status line shows the needs-you count.

## Question card

- [ ] When a question card appears, options shown with numbers.
- [ ] Press `1`-`9` to pick an option.

## Auto-fork

- [ ] Open a session in VS Code (or another `claude` terminal).
- [ ] In `ac`, select that session and press `Enter`.
- [ ] ac should auto-fork (not resume) and show "forked from ... because it is running in ...".

## Keyboard in Windows Terminal

- [ ] `Esc` returns to NORMAL mode from INSERT/COMMAND/SEARCH.
- [ ] `Tab` switches panes.
- [ ] `Alt+Enter` inserts a newline in INSERT mode.
- [ ] `Ctrl+C` interrupts a running session (or shows hint to use `:q`).
- [ ] `:q` quits.

## Display

- [ ] Vietnamese text renders correctly (prompt and response).
- [ ] Box-drawing characters display properly.
- [ ] Resize the terminal window -- layout adjusts without crashes.
- [ ] Narrow window (< 80 cols) hides the sessions pane.

## Binary

- [ ] `ac.exe` file size is under 15 MB.
- [ ] `ac --version` prints version string.
