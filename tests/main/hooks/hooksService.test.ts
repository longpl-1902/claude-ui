// T10 / R-17: hooks service composing server + installer + node resolution. All deps are fakes; nothing touches disk.
import { describe, expect, it, vi } from 'vitest'
import { createHooksService } from '../../../src/main/hooks/hooksService'
import { buildHookEntry, mergeHooks } from '../../../src/main/hooks/hookInstaller'

const NODE = 'C:/Program Files/nodejs/node.exe'
const SCRIPT = 'C:/Users/u/AppData/Roaming/agent-console/hook/agent-console-hook.cjs'
const ROOT = 'C:/Users/u/acme'
const SETTINGS = 'C:/Users/u/acme/.claude/settings.local.json'
const entry = () => buildHookEntry(NODE, SCRIPT)

function setup(o: { json?: Record<string, unknown> | null; error?: 'invalid-json' | 'not-object'; node?: string | null; preview?: unknown; applyResult?: unknown } = {}) {
  const order: string[] = []
  const state = { json: o.json === undefined ? null : o.json, error: o.error }
  const server = {
    start: vi.fn(async () => (order.push('server.start'), { port: 5555 })),
    stop: vi.fn(async () => void order.push('server.stop')),
    info: vi.fn(() => ({ listening: true, port: 5555 })),
    stats: vi.fn(() => ({ received: 7, rejected: 1, lastEventMs: Date.parse('2026-11-19T10:00:00Z') }))
  }
  const installer = {
    settingsPathFor: vi.fn((_r: string) => SETTINGS),
    read: vi.fn(async (_r: string) => ({ text: state.json ? JSON.stringify(state.json) : null, json: state.json, ...(state.error ? { error: state.error } : {}) })),
    preview: vi.fn(async (...a: unknown[]) => (order.push('installer.preview'), o.preview ?? { previewId: 'p1', action: a[1], settingsPath: SETTINGS, before: null, after: '{}', scriptPath: SCRIPT, notes: [] })),
    apply: vi.fn(async (_id: string) => o.applyResult ?? { ok: true })
  }
  const resolveNode = vi.fn(() => (o.node === undefined ? NODE : o.node))
  const installScript = vi.fn(async () => (order.push('installScript'), SCRIPT))
  const onHook = vi.fn()
  const svc = createHooksService({ server, installer, resolveNode, installScript, onHook } as never)
  return { svc, server, installer, resolveNode, installScript, onHook, order, state }
}

describe('R-17 hooks service: lifecycle', () => {
  it('R-17 start starts the server; stop stops it', async () => {
    const s = setup()
    await s.svc.start()
    expect(s.server.start).toHaveBeenCalledTimes(1)
    await s.svc.stop()
    expect(s.server.stop).toHaveBeenCalledTimes(1)
  })
  it('R-17 start does not install anything or touch any project file', async () => {
    const s = setup()
    await s.svc.start()
    expect(s.installer.apply).not.toHaveBeenCalled()
    expect(s.installer.preview).not.toHaveBeenCalled()
    expect(s.installScript).not.toHaveBeenCalled()
  })
})

describe('R-17 hooks service: status', () => {
  it('R-17 no project -> unavailable / no-project, with server info', async () => {
    const st = await setup().svc.status(null)
    expect(st).toMatchObject({ projectRoot: null, settingsPath: null, state: 'unavailable', reason: 'no-project' })
    expect(st.server).toEqual({ listening: true, port: 5555 })
  })
  it('R-17 node missing -> unavailable / node-not-found', async () => {
    expect(await setup({ node: null }).svc.status(ROOT)).toMatchObject({ state: 'unavailable', reason: 'node-not-found', projectRoot: ROOT })
  })
  it('R-17 invalid settings JSON -> unavailable / invalid-json (never touched)', async () => {
    const s = setup({ error: 'invalid-json' })
    expect(await s.svc.status(ROOT)).toMatchObject({ state: 'unavailable', reason: 'invalid-json', settingsPath: SETTINGS })
    expect(s.installer.apply).not.toHaveBeenCalled()
  })
  it('R-17 missing or hook-free settings -> not-installed with the node path', async () => {
    expect(await setup({ json: null }).svc.status(ROOT)).toMatchObject({ state: 'not-installed', nodePath: NODE, settingsPath: SETTINGS, projectRoot: ROOT })
    expect((await setup({ json: { model: 'opus' } }).svc.status(ROOT)).state).toBe('not-installed')
  })
  it('R-17 all 16 hooks with the current node + script -> installed', async () => {
    expect((await setup({ json: mergeHooks({}, entry()) as never }).svc.status(ROOT)).state).toBe('installed')
  })
  it('R-17 a hook pointing at an old script path -> outdated', async () => {
    const old = mergeHooks({}, buildHookEntry(NODE, 'C:/old/agent-console-hook.cjs')) as never
    expect((await setup({ json: old }).svc.status(ROOT)).state).toBe('outdated')
  })
  it('R-17 event counters come from the server stats', async () => {
    const st = await setup().svc.status(ROOT)
    expect(st.eventsReceived).toBe(7)
    expect(st.lastEventAt).toBe('2026-11-19T10:00:00.000Z')
  })
  it('R-17 status is read-only: no preview, no apply, no script copy', async () => {
    const s = setup()
    await s.svc.status(ROOT)
    expect(s.installer.preview).not.toHaveBeenCalled()
    expect(s.installer.apply).not.toHaveBeenCalled()
  })
})

describe('R-17 hooks service: preview', () => {
  it('R-17 install: copies the script first, then asks the installer for the preview with node + script', async () => {
    const s = setup()
    const p: any = await s.svc.preview(ROOT, 'install')
    expect(s.order.indexOf('installScript')).toBeLessThan(s.order.indexOf('installer.preview'))
    const args = s.installer.preview.mock.calls[0]!
    expect(args[0]).toBe(ROOT)
    expect(args[1]).toBe('install')
    expect(args[2]).toEqual(entry())
    expect(args[3]).toBe(SCRIPT)
    expect(p.previewId).toBe('p1')
  })
  it('R-17 install with node missing is refused before anything is copied', async () => {
    const s = setup({ node: null })
    expect(await s.svc.preview(ROOT, 'install')).toMatchObject({ ok: false, reason: 'node-not-found' })
    expect(s.installScript).not.toHaveBeenCalled()
    expect(s.installer.preview).not.toHaveBeenCalled()
  })
  it('R-17 uninstall needs no node and copies nothing', async () => {
    const s = setup({ node: null })
    const p: any = await s.svc.preview(ROOT, 'uninstall')
    expect(s.installScript).not.toHaveBeenCalled()
    expect(s.installer.preview.mock.calls[0]![1]).toBe('uninstall')
    expect(p.previewId).toBe('p1')
  })
  it('R-17 an installer refusal (nothing-to-do, invalid-json) is passed through', async () => {
    const s = setup({ preview: { ok: false, reason: 'invalid-json' } })
    expect(await s.svc.preview(ROOT, 'install')).toEqual({ ok: false, reason: 'invalid-json' })
  })
})

describe('R-17 hooks service: apply and onChanged', () => {
  it('R-17 apply forwards the preview id and returns the installer result (also refusals)', async () => {
    const s = setup({ applyResult: { ok: false, reason: 'changed-since-preview' } })
    await s.svc.preview(ROOT, 'install')
    expect(await s.svc.apply('p1')).toEqual({ ok: false, reason: 'changed-since-preview' })
    expect(s.installer.apply).toHaveBeenCalledWith('p1')
  })
  it('R-17 a successful apply notifies onChanged with a fresh status for that project', async () => {
    const s = setup()
    const seen: any[] = []
    s.svc.onChanged((st) => seen.push(st))
    await s.svc.preview(ROOT, 'install')
    s.state.json = mergeHooks({}, entry()) as never
    expect((await s.svc.apply('p1')).ok).toBe(true)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[seen.length - 1]).toMatchObject({ projectRoot: ROOT, state: 'installed' })
  })
  it('R-17 a failed apply does not notify', async () => {
    const s = setup({ applyResult: { ok: false, reason: 'expired' } })
    const seen: unknown[] = []
    s.svc.onChanged((st) => seen.push(st))
    await s.svc.apply('p1')
    expect(seen).toHaveLength(0)
  })
  it('R-17 onChanged can be unsubscribed', async () => {
    const s = setup()
    const seen: unknown[] = []
    const off = s.svc.onChanged((st) => seen.push(st))
    off()
    await s.svc.preview(ROOT, 'install')
    await s.svc.apply('p1')
    expect(seen).toHaveLength(0)
  })
})
