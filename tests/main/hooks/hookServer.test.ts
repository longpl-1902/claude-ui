// T05 / R-15: local hook server (127.0.0.1 only, random port, token header, limits), endpoint file, runtime helpers.
// Uses only loopback sockets owned by the test. Bodies and tokens are synthetic.
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_BODY, TOKEN_HEADER, createHookServer } from '../../../src/main/hooks/hookServer'
import { createEndpointFile } from '../../../src/main/hooks/endpointFile'
import { ensureScriptInstalled, resolveNode } from '../../../src/main/hooks/hookRuntime'

interface Res { status: number; body: string }
function post(port: number, o: { path?: string; method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: o.path ?? '/hook', method: o.method ?? 'POST', headers: { 'content-type': 'application/json', ...(o.headers ?? {}) } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      }
    )
    req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve({ status: -1, body: '' }) : reject(e)))
    if (o.body !== undefined) req.write(o.body)
    req.end()
  })
}

const parseOk = (body: unknown, receivedMs: number) => {
  const o = body as Record<string, unknown>
  return o && typeof o.session_id === 'string' ? ({ event: 'Stop', sessionId: o.session_id, receivedMs } as never) : null
}

function setup(over: Record<string, unknown> = {}) {
  const events: unknown[] = []
  const written: { port: number; token: string; pid: number }[] = []
  let removed = 0
  const endpoint = { write: async (i: { port: number; token: string; pid: number }) => void written.push(i), remove: async () => void removed++ }
  const server = createHookServer({ parse: parseOk, onEvent: (e) => void events.push(e), endpoint, nowMs: () => 1_800_000_000_000, pid: 4321, ...over } as never)
  return { server, events, written, removed: () => removed }
}

const live: ReturnType<typeof setup>[] = []
const start = async (over: Record<string, unknown> = {}) => {
  const s = setup(over)
  live.push(s)
  const { port } = await s.server.start()
  return { ...s, port, token: s.written[0]!.token }
}
afterEach(async () => {
  for (const s of live.splice(0)) await s.server.stop()
  vi.restoreAllMocks()
})

describe('R-15 hook server: lifecycle', () => {
  it('R-15 binds 127.0.0.1 on a random port and reports it', async () => {
    const s = await start()
    expect(s.port).toBeGreaterThan(0)
    expect(s.server.info()).toEqual({ listening: true, port: s.port })
    const addr = await new Promise<string>((resolve) => {
      const sock = http.get({ host: '127.0.0.1', port: s.port, path: '/x' }, (res) => { res.resume(); resolve(res.socket.remoteAddress ?? '') })
      sock.on('error', () => resolve('error'))
    })
    expect(addr).toBe('127.0.0.1')
  })
  it('R-15 two servers get different ports; a random 32-byte hex token per start', async () => {
    const a = await start()
    const b = await start()
    expect(a.port).not.toBe(b.port)
    expect(a.token).toMatch(/^[0-9a-f]{64}$/)
    expect(a.token).not.toBe(b.token)
  })
  it('R-15 the endpoint handoff is written on start (port, token, pid) and removed on stop', async () => {
    const s = await start()
    expect(s.written).toHaveLength(1)
    expect(s.written[0]).toMatchObject({ port: s.port, pid: 4321 })
    await s.server.stop()
    expect(s.removed()).toBe(1)
    expect(s.server.info().listening).toBe(false)
  })
  it('R-15 re-start after stop gets a new token', async () => {
    const s = await start()
    const t1 = s.token
    await s.server.stop()
    await s.server.start()
    expect(s.written).toHaveLength(2)
    expect(s.written[1]!.token).not.toBe(t1)
  })
  it('R-15 an injected token factory is honoured', async () => {
    const s = await start({ token: () => 'fixed-token' })
    expect(s.token).toBe('fixed-token')
  })
  it('R-15 stop is safe to call twice and before start', async () => {
    const s = setup()
    await s.server.stop()
    await s.server.start()
    live.push(s)
    await s.server.stop()
    await s.server.stop()
  })
})

describe('R-15 hook server: request rules', () => {
  it('R-15 valid POST /hook -> 204 and onEvent receives the parsed event with the receive time', async () => {
    const s = await start()
    const r = await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: JSON.stringify({ session_id: 'S1' }) })
    expect(r.status).toBe(204)
    await vi.waitFor(() => expect(s.events).toHaveLength(1))
    expect(s.events[0]).toMatchObject({ sessionId: 'S1', receivedMs: 1_800_000_000_000 })
    expect(s.server.stats()).toMatchObject({ received: 1, rejected: 0, lastEventMs: 1_800_000_000_000 })
  })
  it('R-15 TOKEN_HEADER is x-agent-console-token and MAX_BODY is 1 MiB', () => {
    expect(TOKEN_HEADER).toBe('x-agent-console-token')
    expect(MAX_BODY).toBe(1024 * 1024)
  })
  it('R-15 missing or wrong token -> 401 and no event', async () => {
    const s = await start()
    expect((await post(s.port, { body: '{"session_id":"S"}' })).status).toBe(401)
    expect((await post(s.port, { headers: { [TOKEN_HEADER]: 'x'.repeat(64) }, body: '{"session_id":"S"}' })).status).toBe(401)
    expect((await post(s.port, { headers: { [TOKEN_HEADER]: 'short' }, body: '{"session_id":"S"}' })).status).toBe(401)
    expect(s.events).toHaveLength(0)
    expect(s.server.stats().rejected).toBe(3)
  })
  it('R-15 wrong Host (DNS rebinding) -> 403 even with the right token', async () => {
    const s = await start()
    const r = await post(s.port, { headers: { host: 'evil.example.com', [TOKEN_HEADER]: s.token }, body: '{"session_id":"S"}' })
    expect(r.status).toBe(403)
    const r2 = await post(s.port, { headers: { host: `localhost:${s.port}`, [TOKEN_HEADER]: s.token }, body: '{"session_id":"S"}' })
    expect(r2.status).toBe(403)
    expect(s.events).toHaveLength(0)
  })
  it('R-15 other paths -> 404, other methods -> 405 (checked before the token)', async () => {
    const s = await start()
    expect((await post(s.port, { path: '/other', headers: { [TOKEN_HEADER]: s.token }, body: '{}' })).status).toBe(404)
    expect((await post(s.port, { method: 'GET', headers: { [TOKEN_HEADER]: s.token } })).status).toBe(405)
    expect((await post(s.port, { method: 'PUT', headers: { [TOKEN_HEADER]: s.token }, body: '{}' })).status).toBe(405)
    expect(s.events).toHaveLength(0)
  })
  it('R-15 a body over 1 MiB -> 413 (or a reset) and no event', async () => {
    const s = await start()
    const r = await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: Buffer.alloc(MAX_BODY + 1024, 0x61) })
    expect([413, -1]).toContain(r.status)
    expect(s.events).toHaveLength(0)
  })
  it('R-15 invalid JSON -> 400; a body the parser rejects -> 400', async () => {
    const s = await start()
    expect((await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: '{not json' })).status).toBe(400)
    expect((await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: '{"no_session":1}' })).status).toBe(400)
    expect(s.events).toHaveLength(0)
  })
  it('R-15 exceptions thrown by onEvent are swallowed (still 204)', async () => {
    const s = await start({ onEvent: () => { throw new Error('boom') } })
    expect((await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: '{"session_id":"S"}' })).status).toBe(204)
    expect((await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: '{"session_id":"S"}' })).status).toBe(204)
  })
  it('R-21 bodies and the token are never logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const s = await start()
    await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: '{"session_id":"S","note":"SECRET-BODY-MARKER"}' })
    await post(s.port, { headers: { [TOKEN_HEADER]: 'wrong-SECRET-TOKEN-MARKER' }, body: '{"x":"SECRET-BODY-MARKER"}' })
    await post(s.port, { headers: { [TOKEN_HEADER]: s.token }, body: '{broken SECRET-BODY-MARKER' })
    const logged = JSON.stringify(spies.flatMap((sp) => sp.mock.calls))
    expect(logged).not.toContain('SECRET-BODY-MARKER')
    expect(logged).not.toContain('SECRET-TOKEN-MARKER')
    expect(logged).not.toContain(s.token)
  })
})

describe('R-15 endpoint file', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
  })
  const tmp = async () => {
    const d = await mkdtemp(join(os.tmpdir(), 'acons-ep-'))
    dirs.push(d)
    return d
  }
  it('R-15 writes endpoint.json atomically with {port, token, pid} and leaves no temp file', async () => {
    const dir = await tmp()
    const ep = createEndpointFile(dir)
    expect(ep.path.replace(/\\/g, '/')).toBe(join(dir, 'endpoint.json').replace(/\\/g, '/'))
    await ep.write({ port: 5555, token: 'tok', pid: 7 })
    expect(JSON.parse(await readFile(ep.path, 'utf8'))).toEqual({ port: 5555, token: 'tok', pid: 7 })
    expect(await readdir(dir)).toEqual(['endpoint.json'])
    if (process.platform !== 'win32') expect((await stat(ep.path)).mode & 0o777).toBe(0o600)
  })
  it('R-15 write replaces an existing file; remove deletes it and ignores a missing one', async () => {
    const dir = await tmp()
    const ep = createEndpointFile(dir)
    await ep.write({ port: 1, token: 'a', pid: 1 })
    await ep.write({ port: 2, token: 'b', pid: 2 })
    expect(JSON.parse(await readFile(ep.path, 'utf8')).port).toBe(2)
    await ep.remove()
    await expect(ep.remove()).resolves.toBeUndefined()
    expect(await readdir(dir)).toEqual([])
  })
})

describe('R-16 hook runtime helpers', () => {
  it('R-16 resolveNode finds node.exe on PATH (case-insensitive Path on win32), never a .cmd', () => {
    const exists = (p: string) => ['C:/tools/node.exe', 'C:/tools/node.cmd'].includes(p.replace(/\\/g, '/'))
    const r = resolveNode({ platform: 'win32', env: { Path: 'C:\\other;C:\\tools' }, exists })
    expect(r!.replace(/\\/g, '/')).toBe('C:/tools/node.exe')
    expect(resolveNode({ platform: 'win32', env: { Path: 'C:\\tools' }, exists: (p) => p.replace(/\\/g, '/') === 'C:/tools/node.cmd' })).toBeNull()
  })
  it('R-16 resolveNode on posix and when nothing is found', () => {
    expect(resolveNode({ platform: 'linux', env: { PATH: '/usr/bin:/opt/n' }, exists: (p) => p === '/opt/n/node' })).toBe('/opt/n/node')
    expect(resolveNode({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false })).toBeNull()
    expect(resolveNode({ platform: 'linux', env: {}, exists: () => true })).toBeNull()
  })
  it('R-16 ensureScriptInstalled copies when the content differs and returns the destination', async () => {
    const files = new Map<string, string>([['C:/app/res/agent-console-hook.cjs', 'NEW SCRIPT']])
    const fs = {
      readText: async (p: string) => files.get(p.replace(/\\/g, '/')) ?? null,
      writeTextAtomic: vi.fn(async (p: string, t: string) => void files.set(p.replace(/\\/g, '/'), t)),
      mkdirp: vi.fn(async () => {})
    }
    const dest = await ensureScriptInstalled({ srcPath: 'C:/app/res/agent-console-hook.cjs', destDir: 'C:/Users/u/AppData/Roaming/agent-console/hook', fs })
    expect(dest.replace(/\\/g, '/')).toBe('C:/Users/u/AppData/Roaming/agent-console/hook/agent-console-hook.cjs')
    expect(files.get(dest.replace(/\\/g, '/'))).toBe('NEW SCRIPT')
    expect(fs.mkdirp).toHaveBeenCalled()
    await ensureScriptInstalled({ srcPath: 'C:/app/res/agent-console-hook.cjs', destDir: 'C:/Users/u/AppData/Roaming/agent-console/hook', fs })
    expect(fs.writeTextAtomic).toHaveBeenCalledTimes(1) // unchanged content: no second write
  })
})
