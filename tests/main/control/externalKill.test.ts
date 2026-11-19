// T10 / R-07: guarded "Stop process" for an EXTERNAL Claude session. Everything injected; nothing is killed for real.
import { describe, expect, it, vi } from 'vitest'
import { createExternalKiller } from '../../../src/main/control/externalKill'

const SID = '11111111-aaaa-4bbb-8ccc-000000000001'
const REQ = { accountId: 'acme', sessionId: SID, pid: 4242 }

function setup(over: Record<string, unknown> = {}) {
  const deps = {
    readRegistry: vi.fn(async () => [
      { accountId: 'acme', entry: { pid: 4242, sessionId: SID } },
      { accountId: 'beta', entry: { pid: 5555, sessionId: '22222222-aaaa-4bbb-8ccc-000000000002' } }
    ]),
    isPidAlive: vi.fn((_pid: number) => true),
    imageName: vi.fn(async (_pid: number): Promise<string | null> => 'claude.exe'),
    killTree: vi.fn(async (_pid: number) => {}),
    ownPids: vi.fn(() => [9001, 9002]),
    ...over
  }
  return { deps, killer: createExternalKiller(deps as never) }
}

describe('R-07 external kill: the happy path', () => {
  it('R-07 a registered, alive claude.exe pid is tree-killed and the call returns ok', async () => {
    const { deps, killer } = setup()
    expect(await killer.kill(REQ)).toMatchObject({ ok: true })
    expect(deps.killTree).toHaveBeenCalledTimes(1)
    expect(deps.killTree).toHaveBeenCalledWith(4242)
  })
  it('R-07 node / node.exe images are accepted, any letter case', async () => {
    for (const img of ['claude', 'CLAUDE.EXE', 'node', 'Node.exe']) {
      const { deps, killer } = setup({ imageName: vi.fn(async () => img) })
      expect((await killer.kill(REQ)).ok, img).toBe(true)
      expect(deps.killTree).toHaveBeenCalled()
    }
  })
})

describe('R-07 external kill: every refusal kills nothing', () => {
  const refused = async (over: Record<string, unknown>, ...rest: unknown[]) => {
    // rest-arg (not a default param) so an explicit `undefined` request is passed through, not replaced by REQ
    const req = rest.length > 0 ? rest[0] : REQ
    const { deps, killer } = setup(over)
    const r = await killer.kill(req as never)
    expect(r.ok).toBe(false)
    expect(deps.killTree).not.toHaveBeenCalled()
    return r
  }
  it('R-07 invalid args -> invalid-args (non-positive / fractional / string pid, empty ids, overlong strings)', async () => {
    for (const bad of [{ ...REQ, pid: 0 }, { ...REQ, pid: -4 }, { ...REQ, pid: 1.5 }, { ...REQ, pid: '4242' }, { ...REQ, accountId: '' }, { ...REQ, sessionId: '' }, { ...REQ, sessionId: 'x'.repeat(2000) }, null, undefined, 'x']) {
      expect((await refused({}, bad)).reason).toBe('invalid-args')
    }
  })
  it('R-07 a pid owned by this app -> app-owned (use Stop instead)', async () => {
    expect((await refused({ ownPids: () => [4242] })).reason).toBe('app-owned')
  })
  it('R-07 no registry entry for that account + pid + session -> not-registered', async () => {
    expect((await refused({ readRegistry: async () => [] })).reason).toBe('not-registered')
    expect((await refused({}, { ...REQ, accountId: 'beta' })).reason).toBe('not-registered')
    expect((await refused({}, { ...REQ, pid: 5555 })).reason).toBe('not-registered')
  })
  it('R-07 pid reuse: same pid but a different session id in the registry -> not-registered', async () => {
    const reused = { readRegistry: async () => [{ accountId: 'acme', entry: { pid: 4242, sessionId: '33333333-aaaa-4bbb-8ccc-000000000003' } }] }
    expect((await refused(reused)).reason).toBe('not-registered')
  })
  it('R-07 pid not alive -> not-running', async () => {
    expect((await refused({ isPidAlive: () => false })).reason).toBe('not-running')
  })
  it('R-07 image that is not claude / node -> unexpected-process; unknown image -> unexpected-process', async () => {
    expect((await refused({ imageName: async () => 'explorer.exe' })).reason).toBe('unexpected-process')
    expect((await refused({ imageName: async () => 'claude-helper.exe' })).reason).toBe('unexpected-process')
    expect((await refused({ imageName: async () => null })).reason).toBe('unexpected-process')
  })
})

describe('R-07 external kill: every check runs at call time', () => {
  it('R-07 the registry, liveness and image are read again on each call (nothing is cached)', async () => {
    const { deps, killer } = setup()
    await killer.kill(REQ)
    await killer.kill(REQ)
    expect(deps.readRegistry).toHaveBeenCalledTimes(2)
    expect(deps.isPidAlive).toHaveBeenCalledTimes(2)
    expect(deps.imageName).toHaveBeenCalledTimes(2)
    expect(deps.ownPids).toHaveBeenCalledTimes(2)
  })
  it('R-07 a session that disappears between two calls is refused the second time', async () => {
    let entries = [{ accountId: 'acme', entry: { pid: 4242, sessionId: SID } }]
    const { deps, killer } = setup({ readRegistry: async () => entries })
    expect((await killer.kill(REQ)).ok).toBe(true)
    entries = []
    expect(await killer.kill(REQ)).toMatchObject({ ok: false, reason: 'not-registered' })
    expect(deps.killTree).toHaveBeenCalledTimes(1)
  })
  it('R-07 a registry read failure refuses (never kills on doubt)', async () => {
    const { deps, killer } = setup({ readRegistry: async () => { throw new Error('EACCES') } })
    const r = await killer.kill(REQ).catch(() => ({ ok: false }))
    expect(r.ok).toBe(false)
    expect(deps.killTree).not.toHaveBeenCalled()
  })
})
