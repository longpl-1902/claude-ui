// T07 / R-03: manager-level behaviour (several sessions, stop / remove / interruptAll / disposeAll) with FAKE children.
import { describe, expect, it } from 'vitest'
import { DRAFT, canUseTool, createHarness, initMsg, resultMsg, startSession } from './harness'

describe('R-03 manager registry', () => {
  it('R-03 create gives unique ids and list() returns every session, get() finds one', () => {
    const h = createHarness()
    const a = h.mgr.create({ ...DRAFT })
    const b = h.mgr.create({ ...DRAFT, accountId: 'beta', configDirAbs: 'C:/Users/u/.claude-beta' })
    expect(a.id).not.toBe(b.id)
    expect(h.mgr.list().map((i) => i.id).sort()).toEqual([a.id, b.id].sort())
    expect(h.mgr.get(b.id)).toMatchObject({ accountId: 'beta' })
    expect(h.mgr.get('nope')).toBeUndefined()
  })
  it('R-03 each session spawns with ITS account env (no leakage between accounts)', async () => {
    const h = createHarness()
    await startSession(h, { accountId: 'acme', configDirAbs: 'C:/Users/u/.claude-acme' })
    await startSession(h, { accountId: 'beta', configDirAbs: 'C:/Users/u/.claude-beta' })
    await startSession(h, { accountId: 'default', configDirAbs: null })
    expect(h.spawnCalls.map((c) => c.opts.env.CLAUDE_CONFIG_DIR)).toEqual(['C:/Users/u/.claude-acme', 'C:/Users/u/.claude-beta', undefined])
  })
  it('R-03 onChanged delivers the whole list; unsubscribing stops it', () => {
    const h = createHarness()
    const seen: number[] = []
    const off = h.mgr.onChanged((l) => seen.push(l.length))
    h.mgr.create({ ...DRAFT })
    h.mgr.create({ ...DRAFT })
    expect(seen[seen.length - 1]).toBe(2)
    off()
    const n = seen.length
    h.mgr.create({ ...DRAFT })
    expect(seen).toHaveLength(n)
  })
  it('R-03 onStream unsubscribe stops deliveries', async () => {
    const h = createHarness()
    const got: number[] = []
    const off = h.mgr.onStream((e) => got.push(e.length))
    const { child } = await startSession(h)
    off()
    got.length = 0
    child.emit(canUseTool('req_1'))
    h.flush()
    expect(got).toEqual([])
  })
})

describe('R-03 remove', () => {
  it('R-03 only draft and exited sessions can be removed', async () => {
    const h = createHarness()
    const d = h.mgr.create({ ...DRAFT })
    expect(h.mgr.remove(d.id).ok).toBe(true)
    expect(h.mgr.get(d.id)).toBeUndefined()
    const { id, child } = await startSession(h)
    expect(h.mgr.remove(id).ok).toBe(false)
    expect(h.mgr.get(id)).toBeDefined()
    child.exit(0)
    expect(h.mgr.remove(id).ok).toBe(true)
    expect(h.mgr.list()).toEqual([])
    expect(h.mgr.remove('nope').ok).toBe(false)
  })
})

describe('R-03 stop', () => {
  it('R-03 stop on a draft removes it without any kill', async () => {
    const h = createHarness()
    const { id } = h.mgr.create({ ...DRAFT })
    expect((await h.mgr.stop(id)).ok).toBe(true)
    expect(h.mgr.get(id)).toBeUndefined()
    expect(h.killTree).not.toHaveBeenCalled()
  })
  it('R-03 stop ends stdin, goes to stopping, waits 3 s, then tree-kills the pid', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(resultMsg())
    const p = h.mgr.stop(id)
    await h.settle()
    expect(child.stdinEnded).toBe(true)
    expect(h.mgr.get(id)!.state).toBe('stopping')
    h.advance(2999)
    expect(h.killTree).not.toHaveBeenCalled()
    h.advance(1)
    expect(h.killTree).toHaveBeenCalledWith(child.pid)
    child.exit(null)
    expect((await p).ok).toBe(true)
    expect(h.mgr.get(id)!.state).toBe('exited')
  })
  it('R-03 a clean exit within the grace period means no tree-kill', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(resultMsg())
    const p = h.mgr.stop(id)
    await h.settle()
    child.exit(0)
    await p
    h.advance(10_000)
    expect(h.killTree).not.toHaveBeenCalled()
    expect(h.mgr.get(id)!.state).toBe('exited')
  })
  it('R-03 stopping a busy session interrupts first, then ends stdin', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    const p = h.mgr.stop(id)
    await h.settle()
    const last = child.frames().pop()
    expect(last).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } })
    expect(child.stdinEnded).toBe(true)
    child.exit(0)
    await p
  })
  it('R-03 pending permissions are denied with "Session stopped" on stop', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(canUseTool('req_1'))
    child.emit(canUseTool('req_2'))
    const p = h.mgr.stop(id)
    await h.settle()
    const denies = child.frames().filter((f) => f.type === 'control_response')
    expect(denies.map((d) => d.response.request_id).sort()).toEqual(['req_1', 'req_2'])
    for (const d of denies) expect(d.response.response).toEqual({ behavior: 'deny', message: 'Session stopped' })
    child.exit(0)
    await p
    expect(h.mgr.get(id)!.pendingPermissions).toBe(0)
  })
  it('R-03 stop on an unknown id fails', async () => {
    const h = createHarness()
    expect((await h.mgr.stop('nope')).ok).toBe(false)
  })
  it('R-03 after stop + exit the session can be sent to again (spawns a new child, resuming)', async () => {
    const h = createHarness()
    const { id, child } = await startSession(h)
    child.emit(resultMsg())
    const p = h.mgr.stop(id)
    await h.settle()
    child.exit(0)
    await p
    const s = h.mgr.send(id, 'back again')
    await h.settle()
    expect(h.spawnCalls).toHaveLength(2)
    expect(h.spawnCalls[1]!.args).toContain('--resume')
    h.lastChild().emit(initMsg())
    await s
  })
})

describe('R-03 interruptAll / disposeAll', () => {
  it('R-03 interruptAll interrupts only busy sessions and returns the count', async () => {
    const h = createHarness()
    const a = await startSession(h)
    const b = await startSession(h)
    const c = await startSession(h)
    b.child.emit(resultMsg()) // idle
    h.mgr.create({ ...DRAFT }) // draft
    const na = a.child.frames().length
    const nb = b.child.frames().length
    const nc = c.child.frames().length
    expect(h.mgr.interruptAll()).toBe(2)
    expect(a.child.frames()).toHaveLength(na + 1)
    expect(c.child.frames()).toHaveLength(nc + 1)
    expect(b.child.frames()).toHaveLength(nb)
  })
  it('R-03 interruptAll with nothing busy returns 0 and writes nothing', () => {
    const h = createHarness()
    h.mgr.create({ ...DRAFT })
    expect(h.mgr.interruptAll()).toBe(0)
    expect(h.spawnCalls).toHaveLength(0)
  })
  it('R-03 disposeAll tree-kills every live child and leaves drafts alone', async () => {
    const h = createHarness()
    const a = await startSession(h)
    const b = await startSession(h)
    h.mgr.create({ ...DRAFT })
    h.mgr.disposeAll()
    await h.settle()
    expect(h.killTree).toHaveBeenCalledTimes(2)
    expect(h.killTree.mock.calls.map((c) => c[0]).sort()).toEqual([a.child.pid, b.child.pid].sort())
  })
  it('R-03 disposeAll with no live children does nothing', () => {
    const h = createHarness()
    h.mgr.create({ ...DRAFT })
    h.mgr.disposeAll()
    expect(h.killTree).not.toHaveBeenCalled()
  })
})
