// T07 / R-03, R-07: process tree helpers with an injected exec (no real taskkill / tasklist / ps).
import { describe, expect, it, vi } from 'vitest'
import { createImageName, createKillTree, parseTasklistCsv } from '../../../src/main/control/processTree'

type Exec = (file: string, args: string[], opts: { timeout: number; windowsHide: true }) => Promise<{ stdout: string }>

describe('R-03 createKillTree (win32)', () => {
  it('R-03 runs taskkill /PID <pid> /T /F through execFile (no shell), hidden, with a 5 s timeout', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '' }))
    await createKillTree(exec, 'win32')(4242)
    expect(exec).toHaveBeenCalledTimes(1)
    const [file, args, opts] = exec.mock.calls[0]!
    expect(file.toLowerCase()).toMatch(/taskkill(\.exe)?$/)
    expect(args).toEqual(['/PID', '4242', '/T', '/F'])
    expect(opts).toMatchObject({ windowsHide: true, timeout: 5000 })
  })
  it('R-03 errors (process already gone) are swallowed', async () => {
    const exec: Exec = async () => { throw Object.assign(new Error('ERROR: The process "4242" not found.'), { code: 128 }) }
    await expect(createKillTree(exec, 'win32')(4242)).resolves.toBeUndefined()
  })
  it('R-03 refuses pids that are not positive integers (never builds a bad command)', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '' }))
    const kill = createKillTree(exec, 'win32')
    for (const pid of [0, -1, 1.5, NaN]) await kill(pid)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('R-03 createKillTree (posix)', () => {
  it('R-03 SIGTERM first, then SIGKILL after 2 s if the process is still alive', async () => {
    vi.useFakeTimers()
    try {
      const sent: [number, string | number][] = []
      let alive = true
      const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
        if (sig === 0) { if (!alive) throw new Error('ESRCH'); return true }
        sent.push([pid, sig ?? 'SIGTERM'])
        return true
      }) as never)
      const p = createKillTree(vi.fn() as never, 'linux')(777)
      await vi.advanceTimersByTimeAsync(2100)
      await p
      expect(sent[0]).toEqual([777, 'SIGTERM'])
      expect(sent.some(([, s]) => s === 'SIGKILL')).toBe(true)
      alive = false
      sent.length = 0
      const p2 = createKillTree(vi.fn() as never, 'linux')(778)
      await vi.advanceTimersByTimeAsync(2100)
      await p2
      expect(sent.map(([, s]) => s)).toEqual(['SIGTERM'])
      spy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('R-07 parseTasklistCsv', () => {
  it('R-07 first CSV field is the image name', () => {
    expect(parseTasklistCsv('"claude.exe","4242","Console","1","123,456 K"\r\n')).toBe('claude.exe')
    expect(parseTasklistCsv('"node.exe","7","Console","1","50,000 K"')).toBe('node.exe')
  })
  it('R-07 the "no tasks" message and blank output give null', () => {
    expect(parseTasklistCsv('INFO: No tasks are running which match the specified criteria.\r\n')).toBeNull()
    expect(parseTasklistCsv('')).toBeNull()
    expect(parseTasklistCsv('\r\n')).toBeNull()
  })
  it('R-07 names containing spaces or commas inside quotes are intact', () => {
    expect(parseTasklistCsv('"My App, Inc.exe","9","Console","1","10 K"')).toBe('My App, Inc.exe')
  })
})

describe('R-07 createImageName', () => {
  it('R-07 win32 runs tasklist /FI "PID eq <pid>" /FO CSV /NH and returns the image', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '"claude.exe","4242","Console","1","1 K"\r\n' }))
    expect(await createImageName(exec, 'win32')(4242)).toBe('claude.exe')
    const [file, args, opts] = exec.mock.calls[0]!
    expect(file.toLowerCase()).toMatch(/tasklist(\.exe)?$/)
    expect(args).toEqual(['/FI', 'PID eq 4242', '/FO', 'CSV', '/NH'])
    expect(opts.windowsHide).toBe(true)
  })
  it('R-07 posix runs ps -p <pid> -o comm= and trims', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: 'claude\n' }))
    expect(await createImageName(exec, 'linux')(55)).toBe('claude')
    expect(exec.mock.calls[0]![0]).toBe('ps')
    expect(exec.mock.calls[0]![1]).toEqual(['-p', '55', '-o', 'comm='])
  })
  it('R-07 exec failure or an empty answer -> null, never throws', async () => {
    expect(await createImageName(async () => { throw new Error('boom') }, 'win32')(1)).toBeNull()
    expect(await createImageName(async () => ({ stdout: '' }), 'linux')(1)).toBeNull()
  })
})
