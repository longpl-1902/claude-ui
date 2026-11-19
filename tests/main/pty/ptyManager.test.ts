import { describe, expect, it, vi } from 'vitest'
import { createPtyManager, type IPtyLike, type NodePtyLike } from '../../../src/main/pty/ptyManager'
import type { ClaudeCommand } from '../../../src/main/pty/claudeBinary'

interface FakePty extends IPtyLike {
  emitData(d: string): void
  emitExit(code: number): void
  written: string[]
  killed: number
  resized: Array<[number, number]>
}

function makePty(pid: number): FakePty {
  const dataCbs: Array<(d: string) => void> = []
  const exitCbs: Array<(e: { exitCode: number }) => void> = []
  const p: FakePty = {
    pid,
    written: [],
    killed: 0,
    resized: [],
    write: (d) => void p.written.push(d),
    resize: (c, r) => void p.resized.push([c, r]),
    kill: () => void p.killed++,
    onData: (cb) => (dataCbs.push(cb), { dispose: () => void dataCbs.splice(dataCbs.indexOf(cb), 1) }),
    onExit: (cb) => (exitCbs.push(cb), { dispose: () => void 0 }),
    emitData: (d) => [...dataCbs].forEach((cb) => cb(d)),
    emitExit: (code) => exitCbs.forEach((cb) => cb({ exitCode: code }))
  }
  return p
}

function setup(over: { bufferLimit?: number; claude?: ClaudeCommand | null; loadPty?: () => Promise<NodePtyLike | null>; baseEnv?: Record<string, string> } = {}) {
  const ptys: FakePty[] = []
  const spawn = vi.fn((_file: string, _args: string[], _opts: unknown) => {
    const p = makePty(100 + ptys.length)
    ptys.push(p)
    return p
  })
  const node: NodePtyLike = { spawn: spawn as unknown as NodePtyLike['spawn'] }
  const loadPty = vi.fn(over.loadPty ?? (async () => node))
  let n = 0
  const mgr = createPtyManager({
    loadPty,
    resolveClaude: () => (over.claude === undefined ? { file: 'C:/bin/claude.exe', argsPrefix: [], via: 'exe' } : over.claude),
    baseEnv: over.baseEnv ?? {
      PATH: 'C:\\x',
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CONFIG_DIR: 'C:/should/go',
      ANTHROPIC_MODEL: 'keep-me'
    },
    platform: 'win32',
    now: () => new Date('2026-11-19T10:00:00.000Z'),
    newId: () => `pty-${++n}`,
    bufferLimit: over.bufferLimit
  })
  return { mgr, spawn, ptys, loadPty }
}

const req = { purpose: 'claude' as const, cwd: 'C:/work/x', configDirAbs: 'C:/Users/u/.claude-work', configDirDisplay: '~/.claude-work', accountId: 'work' }

describe('R-09 ptyManager spawn', () => {
  it('R-09 spawns claude with the right file, args, cwd, size and name', async () => {
    const { mgr, spawn } = setup()
    const out = await mgr.spawnClaude({ ...req, args: ['auth', 'login'], cols: 100, rows: 40 })
    expect(out).toEqual({ ok: true, id: 'pty-1' })
    const [file, args, opts] = spawn.mock.calls[0]! as [string, string[], { cols: number; rows: number; cwd: string; name: string }]
    expect(file).toBe('C:/bin/claude.exe')
    expect(args).toEqual(['auth', 'login'])
    expect(opts).toMatchObject({ cwd: 'C:/work/x', cols: 100, rows: 40, name: 'xterm-256color' })
  })

  it('R-09 defaults to 120x30 and prepends the resolver argsPrefix', async () => {
    const { mgr, spawn } = setup({ claude: { file: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', 'C:/npm/claude.cmd'], via: 'cmd-shim' } })
    await mgr.spawnClaude(req)
    const [file, args, opts] = spawn.mock.calls[0]! as [string, string[], { cols: number; rows: number }]
    expect(file).toBe('cmd.exe')
    expect(args).toEqual(['/d', '/s', '/c', 'C:/npm/claude.cmd'])
    expect(opts).toMatchObject({ cols: 120, rows: 30 })
  })

  it('R-09 child env has no ELECTRON_RUN_AS_NODE / session vars and CLAUDE_CONFIG_DIR is the requested dir', async () => {
    const { mgr, spawn } = setup()
    await mgr.spawnClaude(req)
    const env = (spawn.mock.calls[0]![2] as { env: Record<string, string> }).env
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
    expect(env.ANTHROPIC_MODEL).toBe('keep-me')
    expect(env.CLAUDE_CONFIG_DIR!.replace(/\\/g, '/')).toBe('C:/Users/u/.claude-work')
  })

  it('R-09 default account: CLAUDE_CONFIG_DIR is not set in the child env', async () => {
    const { mgr, spawn } = setup()
    await mgr.spawnClaude({ ...req, configDirAbs: null, configDirDisplay: '~/.claude' })
    const env = (spawn.mock.calls[0]![2] as { env: Record<string, string> }).env
    expect(Object.keys(env)).not.toContain('CLAUDE_CONFIG_DIR')
  })

  it('R-09 node-pty is loaded lazily and cached', async () => {
    const { mgr, loadPty } = setup()
    expect(loadPty).not.toHaveBeenCalled()
    await mgr.spawnClaude(req)
    await mgr.spawnClaude(req)
    expect(loadPty).toHaveBeenCalledTimes(1)
  })

  it('R-09 loadPty -> null gives pty-unavailable (and available() is false)', async () => {
    const { mgr } = setup({ loadPty: async () => null })
    expect(await mgr.available()).toBe(false)
    expect(await mgr.spawnClaude(req)).toEqual({ ok: false, reason: 'pty-unavailable' })
  })

  it('R-09 available() is true when node-pty loads', async () => {
    expect(await setup().mgr.available()).toBe(true)
  })

  it('R-09 resolver null gives claude-not-found', async () => {
    const { mgr, spawn } = setup({ claude: null })
    expect(await mgr.spawnClaude(req)).toEqual({ ok: false, reason: 'claude-not-found' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('R-09 a throwing spawn gives spawn-failed', async () => {
    const node: NodePtyLike = {
      spawn: () => {
        throw new Error('boom')
      }
    }
    const { mgr } = setup({ loadPty: async () => node })
    expect(await mgr.spawnClaude(req)).toEqual({ ok: false, reason: 'spawn-failed' })
  })
})

describe('R-09 ptyManager lifecycle', () => {
  it('R-09 list() reports PtyInfo with display configDir, ISO startedAt and pid', async () => {
    const { mgr } = setup()
    await mgr.spawnClaude(req)
    expect(mgr.list()).toEqual([
      expect.objectContaining({
        id: 'pty-1',
        purpose: 'claude',
        cwd: 'C:/work/x',
        accountId: 'work',
        configDir: '~/.claude-work',
        pid: 100,
        startedAt: '2026-11-19T10:00:00.000Z'
      })
    ])
  })

  it('R-09 data fans out to every listener and is buffered; a throwing listener does not break others', async () => {
    const { mgr, ptys } = setup()
    const a = vi.fn()
    const b = vi.fn()
    mgr.onData(() => {
      throw new Error('bad listener')
    })
    mgr.onData(a)
    const off = mgr.onData(b)
    await mgr.spawnClaude(req)
    ptys[0]!.emitData('hello ')
    ptys[0]!.emitData('world')
    expect(a).toHaveBeenCalledWith('pty-1', 'hello ')
    expect(a).toHaveBeenCalledWith('pty-1', 'world')
    expect(b).toHaveBeenCalledTimes(2)
    expect(mgr.buffer('pty-1')).toBe('hello world')
    off()
    ptys[0]!.emitData('!')
    expect(b).toHaveBeenCalledTimes(2)
    expect(a).toHaveBeenCalledTimes(3)
  })

  it('R-09 the ring buffer trims from the front to bufferLimit', async () => {
    const { mgr, ptys } = setup({ bufferLimit: 10 })
    await mgr.spawnClaude(req)
    ptys[0]!.emitData('0123456789')
    ptys[0]!.emitData('ABCDE')
    expect(mgr.buffer('pty-1')).toBe('56789ABCDE')
    expect(mgr.buffer('nope')).toBe('')
  })

  it('R-09 write and resize reach the pty; unknown ids return false', async () => {
    const { mgr, ptys } = setup()
    await mgr.spawnClaude(req)
    expect(mgr.write('pty-1', 'ls\r')).toBe(true)
    expect(mgr.resize('pty-1', 90, 20)).toBe(true)
    expect(ptys[0]!.written).toEqual(['ls\r'])
    expect(ptys[0]!.resized).toEqual([[90, 20]])
    expect(mgr.write('zzz', 'x')).toBe(false)
    expect(mgr.resize('zzz', 1, 1)).toBe(false)
    expect(mgr.kill('zzz')).toBe(false)
  })

  it('R-09 exit records exitCode, notifies listeners and makes write/resize/kill return false', async () => {
    const { mgr, ptys } = setup()
    const onExit = vi.fn()
    mgr.onExit(onExit)
    await mgr.spawnClaude(req)
    ptys[0]!.emitExit(3)
    expect(onExit).toHaveBeenCalledWith('pty-1', 3)
    expect(mgr.list()[0]).toMatchObject({ id: 'pty-1', exitCode: 3 })
    expect(mgr.write('pty-1', 'x')).toBe(false)
    expect(mgr.resize('pty-1', 5, 5)).toBe(false)
    expect(mgr.kill('pty-1')).toBe(false)
    expect(ptys[0]!.killed).toBe(0)
  })

  it('R-09 kill terminates a live pty', async () => {
    const { mgr, ptys } = setup()
    await mgr.spawnClaude(req)
    expect(mgr.kill('pty-1')).toBe(true)
    expect(ptys[0]!.killed).toBe(1)
  })

  it('R-09 disposeAll kills every live pty and skips exited ones', async () => {
    const { mgr, ptys } = setup()
    await mgr.spawnClaude(req)
    await mgr.spawnClaude(req)
    await mgr.spawnClaude(req)
    ptys[1]!.emitExit(0)
    mgr.disposeAll()
    expect(ptys.map((p) => p.killed)).toEqual([1, 0, 1])
  })

  it('R-09 exited entries stay listed but at most 20 newer entries are kept', async () => {
    const { mgr, ptys } = setup()
    for (let i = 0; i < 25; i++) {
      await mgr.spawnClaude(req)
      ptys[i]!.emitExit(0)
    }
    const ids = mgr.list().map((p) => p.id)
    expect(ids.length).toBeLessThanOrEqual(21)
    expect(ids).toContain('pty-25')
    expect(ids).not.toContain('pty-1')
  })
})
