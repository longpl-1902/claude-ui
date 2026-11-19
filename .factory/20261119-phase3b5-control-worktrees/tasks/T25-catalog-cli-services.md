# T25 - Catalog scanner (skills/agents/commands/output styles) and Claude CLI config runner (mcp/plugin)

- Wave: 9
- Depends on: T01-T22 merged
- Spec refs: R-28, R-32, hard rules 1 and 3
- Tests: tests/main/catalog/catalog.test.ts, tests/main/catalog/claudeCli.test.ts

## Goal
Read-only lists of what Claude Code will load (user, project and plugin skills / agents / commands / output styles),
and a preview-then-apply runner for `claude mcp …` / `claude plugin …` so configuration is never hand-edited.

## Owned files
- create: src/main/catalog/catalog.ts
- create: src/main/catalog/claudeCli.ts
- create: src/main/catalog/mask.ts
- create: tests/main/catalog/catalog.test.ts
- create: tests/main/catalog/claudeCli.test.ts
- create: tests/main/catalog/mask.test.ts

## Read-only context
- src/main/accounts/safeFs.ts (isDeniedPath), src/main/pty/{claudeBinary,childEnv}.ts, src/main/transcripts/projectResolver.ts (ExecFn)
- plan.md "VS Code parity" facts P8-P11

## Notes
Local types structurally equal to T23's `CatalogItem`, `PluginInfo`, `McpConfigured`, `CliPreview`, `CliRunResult`.
catalog.ts:
```ts
export function createCatalog(deps: { fs: { readdir(p: string): Promise<{ name: string; isDir: boolean }[]>; readHead(p: string, max: number): Promise<string | null>; exists(p: string): Promise<boolean> }; home: string; platform: NodeJS.Platform }): {
  list(o: { configDirAbs: string; projectRoot: string | null; plugins: { name: string; installPath: string }[] }): Promise<CatalogItem[]>
}
export function parseFrontmatter(text: string): Record<string, string> // YAML-ish `key: value` lines between leading `---` fences; quotes stripped; never throws
```
Sources: `<configDir>/skills/<name>/SKILL.md`, `<configDir>/agents/**/*.md`, `<configDir>/commands/**/*.md` (name =
relative path with `/` -> `:`), `<configDir>/output-styles/*.md`; same under `<projectRoot>/.claude/`; and for each
plugin installPath: `skills/*/SKILL.md`, `agents/*.md`, `commands/*.md` (scope 'plugin', name prefixed `plugin:`).
Only `.md` files, first 8 KiB, max 500 items, depth 4, skip denied paths; descriptions <= 300 chars.
Plugin install paths come from `claude plugin list --json` (below), not from reading plugin state files.
claudeCli.ts:
```ts
export function createClaudeCli(deps: { exec: (file: string, args: string[], o: { cwd: string; env: Record<string, string>; timeout: number; windowsHide: true }) => Promise<{ stdout: string; stderr: string; code: number }>; resolveClaude: () => ClaudeCommand | null; baseEnv; platform; newId: () => string; now: () => number }): {
  mcpList(o: { cwd: string; configDirAbs: string | null }): Promise<{ servers: McpConfigured[]; error?: string }>   // `claude mcp list`, 45 s timeout; explicit refresh only
  pluginList(o: { configDirAbs: string | null }): Promise<{ plugins: (PluginInfo & { installPath?: string })[]; error?: string }> // `claude plugin list --json`
  previewMcpAdd(o: McpAddRequest & { configDirAbs: string | null; configDirDisplay: string }): CliPreview | { ok: false; reason: string }
  previewMcpRemove(o: { cwd: string; name: string; scope: string | null; configDirAbs: string | null; configDirDisplay: string }): CliPreview | { ok: false; reason: string }
  previewPlugin(o: { action: 'enable' | 'disable' | 'install' | 'uninstall'; id: string; configDirAbs: string | null; configDirDisplay: string }): CliPreview | { ok: false; reason: string }
  apply(previewId: string): Promise<CliRunResult>   // single use, 10 min expiry, 120 s timeout
}
export function parseMcpList(stdout: string): McpConfigured[] // lines `name: target - ✓ Connected | ✗ Failed | ⏸ Pending approval | ! Needs authentication`; tolerant; unknown lines ignored
```
argv: `mcp add [-s scope] [-t transport] [-e K=V]... [-H "K: V"]... <name> <commandOrUrl> [-- args...]` (stdio uses
`--` before args); `mcp remove [-s scope] <name>`; `plugin enable|disable|install|uninstall <id>` (id
`^[A-Za-z0-9@._/-]{1,128}$`). Env = `buildChildEnv(baseEnv, {configDirAbs, platform})`, cwd = project root (MCP local/
project scope are per-folder). Never through a shell; no `--client-secret` (prompts on stdin).
mask.ts: `maskArgv(argv)` replaces values after `-e/--env` (`KEY=***`), `-H/--header` (`Name: ***`), any
`Bearer xxx`, URL userinfo/query values, and tokens matching `/(sk-|ghp_|xox[bp]-)[A-Za-z0-9-_]{6,}/` with `***`;
`maskText(s)` same for output. `effect` text names the file the CLI will change (local/project scope: the project's
local settings in the user config vs `.mcp.json` in the repo; user scope: the account's config) and the warning
"Adding a stdio server runs its command when Claude starts". `mcpList` warning: it starts every configured server
to health-check it, hence explicit refresh only.
**No Claude tokens are spent by any command here** (config commands only). Tests with a fake exec: argv exactness,
masking, preview expiry/single use, parse of a synthetic `mcp list` output and `plugin list --json`.

## Acceptance commands
- npm test -- tests/main/catalog
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
