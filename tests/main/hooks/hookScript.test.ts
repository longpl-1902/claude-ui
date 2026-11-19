// T05 / R-16: the real hook script, run with process.execPath against a loopback test server (plan.md "Test strategy"
// makes this the one place a node child is spawned: the script is the unit under test, never `claude`).
// It must ALWAYS exit 0, fast, with no output, and never write a file.
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'resources/hook/agent-console-hook.cjs')
const PAYLOAD = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'S1', tool_name: 'Bash', cwd: 'C:/Users/u/acme' })

const dirs: string[] = []
const servers: http.Server[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => { s.closeAllConnections?.(); s.close(() => r(null)) })
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function scriptDir(): Promise<string> {
  const d = await mkdtemp(join(os.tmpdir(), 'acons-hook-'))
  dirs.push(d)
  await mkdir(d, { recursive: true })
  await copyFile(SRC, join(d, 'agent-console-hook.cjs'))
  return d
}
async function listen(handler: http.RequestListener): Promise<number> {
  const s = http.createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  return (s.address() as AddressInfo).port
}
function run(dir: string, stdin: string): Promise<{ code: number | null; ms: number; out: string; err: string }> {
  return new Promise((resolveRun, reject) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [join(dir, 'agent-console-hook.cjs')], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    child.on('error', reject)
    child.on('close', (code) => resolveRun({ code, ms: Date.now() - t0, out, err }))
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}

describe('R-16 hook script', () => {
  it('R-16 forwards stdin to POST /hook with the token header, exits 0 quickly and silently', async () => {
    const seen: { method?: string; url?: string; token?: string; type?: string; body: string }[] = []
    const port = await listen((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, token: req.headers['x-agent-console-token'] as string, type: req.headers['content-type'], body })
        res.statusCode = 204
        res.end()
      })
    })
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port, token: 'tok-123', pid: 1 }))
    const r = await run(dir, PAYLOAD)
    expect(r.code).toBe(0)
    expect(r.ms).toBeLessThan(1500)
    expect(r.out).toBe('')
    expect(r.err).toBe('')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/hook', token: 'tok-123' })
    expect(seen[0]!.type).toContain('application/json')
    expect(JSON.parse(seen[0]!.body)).toEqual(JSON.parse(PAYLOAD))
  })

  it('R-16 app closed (no endpoint.json) -> exit 0 fast with no output', async () => {
    const dir = await scriptDir()
    const r = await run(dir, PAYLOAD)
    expect(r.code).toBe(0)
    expect(r.ms).toBeLessThan(1500)
    expect(r.out + r.err).toBe('')
  })

  it('R-16 invalid endpoint.json -> exit 0', async () => {
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), '{not json')
    expect((await run(dir, PAYLOAD)).code).toBe(0)
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port: 'x' }))
    expect((await run(dir, PAYLOAD)).code).toBe(0)
  })

  it('R-16 endpoint pointing at a closed port -> exit 0 silently', async () => {
    const dead = await listen((_q, s) => s.end())
    await new Promise((r) => { servers[0]!.close(() => r(null)) })
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port: dead, token: 't', pid: 1 }))
    const r = await run(dir, PAYLOAD)
    expect(r.code).toBe(0)
    expect(r.ms).toBeLessThan(1500)
    expect(r.out + r.err).toBe('')
  })

  it('R-16 a server that never responds -> exit 0 within the ~1.5 s hard deadline', async () => {
    const port = await listen(() => { /* never answers */ })
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port, token: 't', pid: 1 }))
    const r = await run(dir, PAYLOAD)
    expect(r.code).toBe(0)
    expect(r.ms).toBeLessThan(1900)
  }, 10_000)

  it('R-16 empty stdin and non-JSON stdin still exit 0', async () => {
    const port = await listen((_q, s) => { s.statusCode = 400; s.end() })
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port, token: 't', pid: 1 }))
    expect((await run(dir, '')).code).toBe(0)
    expect((await run(dir, 'garbage not json')).code).toBe(0)
  })

  it('R-16 a huge stdin (> 1 MiB) is capped and still exits 0', async () => {
    let received = 0
    const port = await listen((req, res) => {
      req.on('data', (c) => (received += c.length))
      req.on('end', () => { res.statusCode = 413; res.end() })
    })
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port, token: 't', pid: 1 }))
    const r = await run(dir, 'x'.repeat(3 * 1024 * 1024))
    expect(r.code).toBe(0)
    expect(received).toBeLessThanOrEqual(1024 * 1024 + 1024)
  }, 10_000)

  it('R-16 never writes any file next to itself', async () => {
    const port = await listen((_q, s) => { s.statusCode = 204; s.end() })
    const dir = await scriptDir()
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ port, token: 't', pid: 1 }))
    const before = (await readdir(dir)).sort()
    await run(dir, PAYLOAD)
    expect((await readdir(dir)).sort()).toEqual(before)
  })

  it('R-16 the script uses only Node builtins (no node_modules requirement) and is short', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(SRC, 'utf8')
    expect(src.split('\n').length).toBeLessThan(80)
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) expect(m[1]).toMatch(/^(node:)?(http|fs|path)$/)
  })
})
