// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliPreview } from '@shared/types'
import { useExtensionsStore } from '@renderer/store/useExtensionsStore'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

const s = () => useExtensionsStore.getState()
const pv = (id = 'p1'): CliPreview => ({
  previewId: id,
  argvDisplay: ['claude', 'mcp', 'add'],
  cwd: '/p',
  configDir: '/c',
  effect: 'e',
  warnings: []
})

function mockApi() {
  const api = {
    control: { send: vi.fn(), start: vi.fn(), sendRich: vi.fn() },
    catalog: { list: vi.fn(async () => [{ kind: 'skill', name: 'x', scope: 'user', path: '/x' }]) },
    mcp: {
      list: vi.fn(async () => ({ servers: [{ name: 'm', scope: 'user', target: 't', status: 'ok' }], ranAt: 'now' })),
      previewAdd: vi.fn(async () => pv()),
      previewRemove: vi.fn(async () => pv('p2'))
    },
    plugins: {
      list: vi.fn(async () => ({ plugins: [{ id: 'a@b', name: 'a', enabled: true }] })),
      preview: vi.fn(async () => pv('p3'))
    },
    cli: { apply: vi.fn(async () => ({ ok: true, output: 'done' })) }
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}
const addReq = {
  projectRoot: '/p',
  accountId: 'a',
  name: 'n',
  scope: 'local' as const,
  transport: 'stdio' as const,
  commandOrUrl: 'x',
  args: [],
  env: {},
  headers: {}
}

beforeEach(() => {
  useExtensionsStore.setState({
    catalog: [],
    mcp: null,
    plugins: [],
    preview: null,
    lastRun: null,
    loading: {},
    error: undefined
  })
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('extensions store', () => {
  it('Extensions is a valid screen id', () => {
    useConsoleStore.getState().navigate('extensions')
    expect(useConsoleStore.getState().screen).toBe('extensions')
    useConsoleStore.getState().navigate('team')
  })

  it('loads catalog and plugins without running mcp list or any send', async () => {
    const api = mockApi()
    await s().loadCatalog('/p', 'a')
    await s().loadPlugins('a')
    expect(s().catalog).toHaveLength(1)
    expect(s().plugins[0]!.id).toBe('a@b')
    expect(api.mcp.list).not.toHaveBeenCalled()
    expect(api.control.send).not.toHaveBeenCalled()
    expect(api.control.start).not.toHaveBeenCalled()
  })

  it('refreshMcp runs only when called explicitly', async () => {
    const api = mockApi()
    await s().refreshMcp('/p', 'a')
    expect(api.mcp.list).toHaveBeenCalledTimes(1)
    expect(s().mcp!.servers[0]!.name).toBe('m')
  })

  it('previews do not run the CLI; apply runs once on confirm', async () => {
    const api = mockApi()
    await s().previewMcpAdd(addReq)
    expect(s().preview!.previewId).toBe('p1')
    expect(api.cli.apply).not.toHaveBeenCalled()
    const r = await s().apply()
    expect(r.ok).toBe(true)
    expect(api.cli.apply).toHaveBeenCalledWith('p1')
    expect(s().preview).toBeNull()
    expect(s().lastRun!.output).toBe('done')
    expect(api.control.send).not.toHaveBeenCalled()
  })

  it('after mcp apply, list is NOT re-run unless the user ran it before', async () => {
    const api = mockApi()
    await s().previewMcpRemove('/p', 'a', 'n', 'user')
    await s().apply()
    expect(api.mcp.list).not.toHaveBeenCalled()
    await s().refreshMcp('/p', 'a')
    await s().previewMcpAdd(addReq)
    await s().apply()
    expect(api.mcp.list).toHaveBeenCalledTimes(2)
  })

  it('after plugin apply, plugins reload once', async () => {
    const api = mockApi()
    await s().previewPlugin('a', 'enable', 'a@b')
    await s().apply()
    expect(api.plugins.list).toHaveBeenCalledTimes(1)
    expect(api.mcp.list).not.toHaveBeenCalled()
  })

  it('failed apply does not reload; clearPreview drops preview; apply without preview is a no-op', async () => {
    const api = mockApi()
    api.cli.apply.mockResolvedValueOnce({ ok: false, reason: 'boom' } as never)
    await s().previewPlugin('a', 'install', 'x')
    await s().apply()
    expect(api.plugins.list).not.toHaveBeenCalled()
    expect(s().lastRun!.ok).toBe(false)
    await s().previewPlugin('a', 'install', 'x')
    s().clearPreview()
    expect(s().preview).toBeNull()
    expect((await s().apply()).ok).toBe(false)
    expect(api.cli.apply).toHaveBeenCalledTimes(1)
  })

  it('a refusal from preview leaves no preview', async () => {
    const api = mockApi()
    api.mcp.previewAdd.mockResolvedValueOnce({ ok: false, reason: 'invalid-args' } as never)
    const r = await s().previewMcpAdd(addReq)
    expect('previewId' in r).toBe(false)
    expect(s().preview).toBeNull()
  })
})
