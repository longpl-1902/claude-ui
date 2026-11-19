# T30 - Extensions screen: MCP servers, plugins, skills / agents / commands / output styles

- Wave: 11
- Depends on: T26, T27
- Spec refs: R-28, R-32, hard rule 3
- Tests: tests/renderer/extensionsView.test.tsx

## Goal
A third screen "Extensions" for the viewed project + account: configured MCP servers (explicit health-check
refresh, add/remove through a previewed `claude mcp` command), plugins (enable/disable/install/uninstall through a
previewed `claude plugin` command), and read-only lists of skills, agents, commands and output styles with
"Open in editor".

## Owned files
- create: src/renderer/src/screens/ExtensionsView.tsx
- create: src/renderer/src/screens/ExtensionsView.css
- create: src/renderer/src/components/extensions/McpServersSection.tsx
- create: src/renderer/src/components/extensions/PluginsSection.tsx
- create: src/renderer/src/components/extensions/CatalogSection.tsx
- create: src/renderer/src/components/extensions/CliPreviewDialog.tsx
- modify: src/renderer/src/App.tsx (route), src/renderer/src/components/team/TeamHeader.tsx (an "Extensions" nav button), src/renderer/src/hooks/useShortcuts.ts (Ctrl+Shift+E + SHORTCUTS row)
- create: tests/renderer/extensionsView.test.tsx

## Read-only context
- src/renderer/src/store/{useExtensionsStore,useDetailsStore,useConsoleStore}.ts, ui/Dialog.tsx, plan.md PD6-PD8

## Notes
- Header of the screen: project root + account (from the viewed session, as M4) with selects to change both.
- MCP: table name / scope / transport / target (masked) / status. "Check health" button runs `refreshMcp` (label
  warns: "starts each server to test it") - never automatic. If a controlled session is running, a "This session"
  column shows live status from `details.mcp` with Enable/Disable for the session (no config change).
  "Add server…" form (name, scope local/project/user with explanation, transport, command or URL, args, env and
  headers as key/value rows with masked inputs) -> `previewMcpAdd` -> CliPreviewDialog. Remove -> `previewMcpRemove`.
- Plugins: list with enabled toggle (-> preview), Install by id field (-> preview), Uninstall (-> preview).
- CliPreviewDialog: shows `argvDisplay` (mono, masked), cwd, config folder, `effect`, warnings; buttons Cancel
  (default) / "Run command" -> `apply`; shows masked output and errors. Nothing changes without "Run command".
- Catalog: tabs Skills / Agents / Commands / Output styles; search; rows name, scope badge (user/project/plugin
  name), description, "Open" (`catalog:open`). Note: "New sessions pick up changes; a running session may need
  restart".
Tests: no mcp list call on mount, health check only on click, add-server preview then run, masked values never shown
in clear, plugin toggle preview, catalog tabs and open, route + shortcut.

## Acceptance commands
- npm test -- tests/renderer/extensionsView.test.tsx tests/renderer/app.test.tsx tests/renderer/shortcuts.test.tsx
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
