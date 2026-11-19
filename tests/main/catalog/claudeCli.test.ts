import { describe, expect, it } from 'vitest'
import { createClaudeCli, parseMcpList, parsePluginList, PREVIEW_TTL_MS, type CliPreview, type McpAddRequest } from '../../../src/main/catalog/claudeCli'

type Call = { file: string; args: string[]; o: { cwd: string; env: Record<string, string>; timeout: number; windowsHide: true } }
function setup(res: { stdout?: string; stderr?: string; code?: number; throws?: string } = {}, found = true) {
  const calls: Call[] = []
  let t = 1000
  let n = 0
  const cli = createClaudeCli({
    exec: async (file, args, o) => {
      calls.push({ file, args, o })
      if (res.throws) throw new Error(res.throws)
      return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.code ?? 0 }
    },
    resolveClaude: () => (found ? { file: '/bin/claude', argsPrefix: ['PFX'], via: 'posix' } : null),
    baseEnv: { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/other' },
    platform: 'linux',
    newId: () => `id${++n}`,
    now: () => t
  })
  return { cli, calls, advance: (ms: number) => void (t += ms) }
}
const req = (o: Partial<McpAddRequest> & { configDirAbs?: string } = {}): McpAddRequest & { configDirAbs: string; configDirDisplay: string } => ({
  projectRoot: '/proj', accountId: 'a', name: 'srv', scope: 'local', transport: 'stdio', commandOrUrl: 'node', args: ['s.js', '--flag'],
  env: { TOKEN: 'sk-supersecret1' }, headers: {}, configDirAbs: '/cfg', configDirDisplay: '~/cfg', ...o
})
const prev = (r: unknown): CliPreview => r as CliPreview

describe('parsers', () => {
  it('parseMcpList handles statuses, masks targets, ignores unknown lines', () => {
    const out = parseMcpList(
      ['Checking MCP server health...', '', 'a: node srv.js - ✓ Connected', 'b: https://x.example/mcp?key=SECRET - ✗ Failed to connect',
       'c: npx pkg - ⏸ Pending approval', 'd: https://y.example (HTTP) - ! Needs authentication', 'garbage line'].join('\n')
    )
    expect(out.map((s) => [s.name, s.status])).toEqual([['a', 'connected'], ['b', 'failed'], ['c', 'pending'], ['d', 'needs-auth']])
    expect(out[1]!.target).toBe('https://x.example/mcp?key=***')
    expect(out[2]!.pendingApproval).toBe(true)
    expect(out[0]!.transport).toBe('stdio')
  })
  it('parsePluginList accepts array/object and bad json', () => {
    const p = parsePluginList(JSON.stringify([{ id: 'foo@mkt', enabled: true, version: '1.0', installPath: '/i/foo', scope: 'user' }, { id: 'bar', enabled: false }, 5]))
    expect(p).toEqual([
      { id: 'foo@mkt', name: 'foo', enabled: true, marketplace: 'mkt', version: '1.0', scope: 'user', installPath: '/i/foo' },
      { id: 'bar', name: 'bar', enabled: false }
    ])
    expect(parsePluginList(JSON.stringify({ plugins: [{ id: 'x', enabled: true }] }))).toHaveLength(1)
    expect(parsePluginList('nope')).toEqual([])
  })
})

describe('lists', () => {
  it('mcpList runs `mcp list` with 45s timeout and sanitized env', async () => {
    const { cli, calls } = setup({ stdout: 'a: node - ✓ Connected' })
    const r = await cli.mcpList({ cwd: '/proj', configDirAbs: '/cfg' })
    expect(r.servers).toHaveLength(1)
    expect(calls[0]!.file).toBe('/bin/claude')
    expect(calls[0]!.args).toEqual(['PFX', 'mcp', 'list'])
    expect(calls[0]!.o).toMatchObject({ cwd: '/proj', timeout: 45000, windowsHide: true })
    expect(calls[0]!.o.env.CLAUDE_CONFIG_DIR).toBe('/cfg')
    expect(calls[0]!.o.env.CLAUDECODE).toBeUndefined()
  })
  it('reports errors without throwing', async () => {
    expect((await setup({ code: 1, stderr: 'boom sk-abcdefghij' }).cli.mcpList({ cwd: '/p', configDirAbs: null })).error).toBe('boom ***')
    expect((await setup({ throws: 'timeout' }).cli.mcpList({ cwd: '/p', configDirAbs: null })).error).toBe('timeout')
    expect((await setup({}, false).cli.pluginList({ configDirAbs: null })).error).toMatch(/not found/)
  })
  it('pluginList uses `plugin list --json`', async () => {
    const { cli, calls } = setup({ stdout: '[{"id":"p@m","enabled":true,"installPath":"/i"}]' })
    const r = await cli.pluginList({ configDirAbs: '/cfg' })
    expect(calls[0]!.args).toEqual(['PFX', 'plugin', 'list', '--json'])
    expect(r.plugins[0]!.installPath).toBe('/i')
  })
})

describe('previews and apply', () => {
  it('mcp add argv is exact, masked in display, and nothing runs at preview time', () => {
    const { cli, calls } = setup()
    const p = prev(cli.previewMcpAdd(req({ env: { TOKEN: 'sk-supersecret1', B: 'v' } })))
    expect(calls).toHaveLength(0)
    expect(p.argvDisplay).toEqual(['claude', 'mcp', 'add', '-s', 'local', '-t', 'stdio', '-e', 'TOKEN=***', '-e', 'B=***', 'srv', 'node', '--', 's.js', '--flag'])
    expect(JSON.stringify(p)).not.toContain('supersecret')
    expect(p.cwd).toBe('/proj')
    expect(p.configDir).toBe('~/cfg')
    expect(p.warnings.join(' ')).toContain('runs its command when Claude starts')
  })
  it('apply runs the exact real argv once, masks output, and is single use', async () => {
    const { cli, calls } = setup({ stdout: 'Added with sk-supersecret1' })
    const p = prev(cli.previewMcpAdd(req()))
    const r = await cli.apply(p.previewId)
    expect(r).toEqual({ ok: true, output: 'Added with ***' })
    expect(calls[0]!.args).toEqual(['PFX', 'mcp', 'add', '-s', 'local', '-t', 'stdio', '-e', 'TOKEN=sk-supersecret1', 'srv', 'node', '--', 's.js', '--flag'])
    expect(calls[0]!.o).toMatchObject({ cwd: '/proj', timeout: 120000 })
    expect((await cli.apply(p.previewId)).ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
  it('http add with headers; effect names the file by scope', () => {
    const { cli } = setup()
    const p = prev(cli.previewMcpAdd(req({ transport: 'http', commandOrUrl: 'https://h.example/mcp', args: [], env: {}, headers: { Authorization: 'Bearer tok123456' }, scope: 'project' })))
    expect(p.argvDisplay).toEqual(['claude', 'mcp', 'add', '-s', 'project', '-t', 'http', '-H', 'Authorization: ***', 'srv', 'https://h.example/mcp'])
    expect(p.effect).toContain('.mcp.json')
    expect(p.warnings).toEqual([])
    expect(prev(cli.previewMcpAdd(req({ scope: 'user' }))).effect).toContain('~/cfg')
  })
  it('previews expire after 10 minutes', async () => {
    const { cli, calls, advance } = setup()
    const p = prev(cli.previewMcpRemove({ cwd: '/proj', name: 'srv', scope: 'user', configDirAbs: '/cfg', configDirDisplay: '~/cfg' }))
    expect(p.argvDisplay).toEqual(['claude', 'mcp', 'remove', '-s', 'user', 'srv'])
    advance(PREVIEW_TTL_MS + 1)
    expect(await cli.apply(p.previewId)).toMatchObject({ ok: false, reason: 'Preview expired' })
    expect(calls).toHaveLength(0)
  })
  it('remove without scope omits -s; plugin actions validate the id', async () => {
    const { cli, calls } = setup()
    expect(prev(cli.previewMcpRemove({ cwd: '/p', name: 'srv', scope: null, configDirAbs: null, configDirDisplay: 'default' })).argvDisplay).toEqual(['claude', 'mcp', 'remove', 'srv'])
    const p = prev(cli.previewPlugin({ action: 'disable', id: 'foo@mkt', configDirAbs: '/cfg', configDirDisplay: '~/cfg' }))
    await cli.apply(p.previewId)
    expect(calls[0]!.args).toEqual(['PFX', 'plugin', 'disable', 'foo@mkt'])
    for (const id of ['', '--evil', 'a b', 'a;b', 'x'.repeat(129)]) {
      expect(cli.previewPlugin({ action: 'enable', id, configDirAbs: null, configDirDisplay: '' })).toMatchObject({ ok: false })
    }
  })
  it('rejects invalid mcp add input', () => {
    const { cli } = setup()
    for (const bad of [{ name: '--x' }, { name: 'a b' }, { commandOrUrl: '-rf' }, { env: { 'A B': 'v' } }, { transport: 'http' as const, commandOrUrl: 'ftp://x', args: [] }, { scope: 'bogus' as never }]) {
      expect(cli.previewMcpAdd(req(bad))).toMatchObject({ ok: false })
    }
    expect(cli.previewMcpAdd(req({ configDirAbs: 'relative' }))).toMatchObject({ ok: false })
  })
  it('failed exit surfaces reason with masked output', async () => {
    const { cli } = setup({ code: 2, stderr: 'bad ghp_abcdefghij' })
    const r = await cli.apply(prev(cli.previewPlugin({ action: 'install', id: 'a@b', configDirAbs: null, configDirDisplay: 'd' })).previewId)
    expect(r).toEqual({ ok: false, reason: 'claude exited with code 2', output: 'bad ***' })
  })
})
