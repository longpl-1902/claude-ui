# ac -- Agent Console

A keyboard-first TUI for managing multiple Claude Code sessions across projects and accounts.
Built with Go and Bubble Tea. Single binary, no runtime dependencies besides the official `claude` CLI.

## Requirements

- Windows Terminal (recommended) or any terminal with ANSI support
- Claude CLI installed and signed in (`claude` on PATH)
- Go 1.26+ (for building from source)

## Install

Download `ac.exe` from [GitHub Releases](https://github.com/longpl-1902/claude-ui/releases)
and place it somewhere on your PATH.

Or build from source:

```
go build -trimpath -ldflags "-s -w" -o ac.exe ./cmd/ac
```

## First run

```
ac
```

If multiple Claude accounts are detected, the account picker appears.
Otherwise, ac opens the main screen directly with the cursor in the prompt line.

## Keymap

### Daily keys (NORMAL mode)

| Key | Action |
|---|---|
| `j` / `k` | Move cursor up/down |
| `Enter` | Open/resume session (switches to INSERT) |
| `i` / `I` | Enter INSERT mode (`I` clears prompt first) |
| `Esc` | Back to NORMAL; close overlay |
| `Tab` | Switch focus between sessions and log panes |
| `]n` / `[n` | Jump to next/previous needs-you item |
| `a` / `A` | Allow permission (`A` = allow for session) |
| `d` | Deny permission |
| `1`-`9` | Pick option from question card |
| `/` | Search in log |
| `?` | Help overlay |
| `q` | Quit |
| `Ctrl+C` | Interrupt running session |

### INSERT mode

| Key | Action |
|---|---|
| `Enter` | Send prompt |
| `Alt+Enter` / `Ctrl+J` | Insert newline |
| `Ctrl+P` / `Ctrl+N` | Prompt history |
| `Ctrl+U` | Clear line |
| `Esc` | Back to NORMAL |

### Commands (`:` in NORMAL mode)

| Command | Action |
|---|---|
| `:new [dir]` | New session in directory |
| `:fork` | Fork selected session |
| `:stop` | Stop controlled session |
| `:model <name>` | Set model |
| `:mode <mode>` | Set permission mode |
| `:account [name]` | Switch account / open picker |
| `:ctx` | Show context usage |
| `:mcp` | Show MCP status |
| `:rename <title>` | Rename session |
| `:q` | Quit |

## Multi-account

ac supports multiple Claude accounts via `CLAUDE_CONFIG_DIR`. Each account has its own
config directory (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personal`).

Start with a specific account:

```
ac --account work
```

Or use the account picker at startup to choose.

Configure accounts in `%APPDATA%\ac\config.json`:

```json
{
  "accounts": [
    {"id": "work", "name": "work", "configDir": "C:/Users/u/.claude-work", "color": "#5B8DEF"},
    {"id": "personal", "name": "personal", "configDir": "C:/Users/u/.claude", "color": "#F5A623"}
  ]
}
```

## Multi-instance

Each `ac` process is independent. Run two terminals side by side with different accounts:

```
ac --account work
ac --account personal
```

Sessions controlled by one instance appear as read-only in others. If you try to resume a
session that is live elsewhere, ac automatically forks it instead.

## Flags

| Flag | Description |
|---|---|
| `--version` | Print version and exit |
| `--account <name>` | Start with this account |
| `--debug-log <file>` | Write debug log to file |

## License

See [LICENSE](LICENSE).
