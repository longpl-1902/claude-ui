# T27 - Renderer stores v2: session details, catalog/MCP/plugins, Extensions screen route

- Wave: 10
- Depends on: T23
- Spec refs: R-27..R-32
- Tests: tests/renderer/detailsStore.test.ts, tests/renderer/extensionsStore.test.ts

## Goal
Renderer state for the parity UI: per-control details (commands, models, context, cost, turns, MCP live status),
and an extensions store for catalog, configured MCP servers, plugins and CLI previews. Add the `'extensions'` screen.

## Owned files
- create: src/renderer/src/store/useDetailsStore.ts
- create: src/renderer/src/store/useExtensionsStore.ts
- modify: src/renderer/src/store/useConsoleStore.ts (Screen union gains 'extensions' only)
- create: tests/renderer/detailsStore.test.ts
- create: tests/renderer/extensionsStore.test.ts

## Read-only context
- src/renderer/src/store/useControlStore.ts (pattern), src/shared/ipc.ts + types.ts (T23)

## Notes
useDetailsStore: `{ byControl: Record<string, ControlDetails>; init(); load(id); refreshContext(id); mcpToggle(id,
name, on); mcpReconnect(id, name); setEffort; setOutputStyle; rename; getPlan(id); rewindPreview(id, uuid);
rewind(id, uuid); forkAt(id, uuid); fileSuggestions(id | null, cwd, query) (debounced 120 ms, latest wins);
sendRich(id, text, images) }`. Selectors: `selectCommands(id)` merges `details.commands` with a static builtin
fallback list (`/help /clear /compact /model /cost /context /mcp /agents /memory /review /init`) when details are
absent (draft), deduped by name.
useExtensionsStore: `{ catalog: CatalogItem[]; mcp: { servers; ranAt; error? } | null; plugins: PluginInfo[];
preview: CliPreview | null; lastRun: CliRunResult | null; loading: Record<string, boolean>; loadCatalog(root,
accountId); refreshMcp(root, accountId) /* explicit only */; loadPlugins(accountId); previewMcpAdd(req);
previewMcpRemove(...); previewPlugin(...); apply(); clearPreview() }`. After a successful apply, reload the affected
list once (mcp list is re-run only if the user ran it before in this view). **No action calls any control
send**; `refreshMcp` is never called automatically (test).

## Acceptance commands
- npm test -- tests/renderer/detailsStore.test.ts tests/renderer/extensionsStore.test.ts tests/renderer/store.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
