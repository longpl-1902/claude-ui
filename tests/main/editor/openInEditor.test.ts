// T10 / R-07: "Open in VS Code" without a shell (code.cmd resolved to Code.exe + cli.js on win32). All deps injected.
import { describe, expect, it, vi } from 'vitest'
import { createOpenInEditor } from '../../../src/main/editor/openInEditor'

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
const VS = 'C:/Users/u/AppData/Local/Programs/Microsoft VS Code'
const WIN_FILES = [`${VS}/bin/code.cmd`, `${VS}/Code.exe`, `${VS}/resources/app/out/cli.js`]

function setup(o: { platform?: NodeJS.Platform; files?: string[]; path?: string; dir?: boolean; spawnOk?: boolean } = {}) {
  const files = new Set((o.files ?? WIN_FILES).map(norm))
  const platform = o.platform ?? 'win32'
  const spawnDetached = vi.fn((_file: string, _args: string[], _env?: Record<string, string>) => o.spawnOk !== false)
  const openPath = vi.fn(async (_p: string) => '')
  const env: Record<string, string> =
    platform === 'win32' ? { Path: `C:\\Windows;${VS.replace(/\//g, '\\')}\\bin`, SystemRoot: 'C:\\Windows' } : { PATH: '/usr/bin:/opt/code/bin', HOME: '/home/u' }
  const open = createOpenInEditor({
    platform, env, exists: (p) => files.has(norm(p)), isDir: async () => o.dir !== false, spawnDetached, openPath
  })
  return { open, spawnDetached, openPath }
}

describe('R-07 openInEditor: Windows', () => {
  it('R-07 spawns Code.exe with cli.js and the folder, ELECTRON_RUN_AS_NODE=1, no shell', async () => {
    const { open, spawnDetached, openPath } = setup()
    const r = await open.open('C:/Users/u/acme')
    expect(r.ok).toBe(true)
    expect(spawnDetached).toHaveBeenCalledTimes(1)
    const [file, args, env] = spawnDetached.mock.calls[0]!
    expect(norm(file)).toBe(norm(`${VS}/Code.exe`))
    expect(args.map(norm)).toEqual([norm(`${VS}/resources/app/out/cli.js`), norm('C:/Users/u/acme')])
    expect(env!.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env!.SystemRoot).toBe('C:\\Windows')
    expect(openPath).not.toHaveBeenCalled()
  })
  it('R-07 the executable is never a shell or the .cmd shim', async () => {
    const { open, spawnDetached } = setup()
    await open.open('C:/Users/u/acme')
    const file = norm(spawnDetached.mock.calls[0]![0])
    expect(file).not.toMatch(/(cmd|powershell|pwsh|bash|sh)(\.exe)?$/)
    expect(file).not.toMatch(/code\.cmd$/)
  })
  it('R-07 a folder name with spaces or shell metacharacters stays ONE argument', async () => {
    const { open, spawnDetached } = setup()
    await open.open('C:/Users/u/my project & stuff')
    expect(spawnDetached.mock.calls[0]![1]).toHaveLength(2)
    expect(spawnDetached.mock.calls[0]![1][1]).toBe('C:/Users/u/my project & stuff')
  })
  it('R-07 no VS Code on PATH -> opens the folder in the file manager and says so', async () => {
    const { open, spawnDetached, openPath } = setup({ files: [] })
    expect(await open.open('C:/Users/u/acme')).toEqual({ ok: true, reason: 'opened-folder' })
    expect(openPath).toHaveBeenCalledWith('C:/Users/u/acme')
    expect(spawnDetached).not.toHaveBeenCalled()
  })
  it('R-07 code.cmd found but Code.exe / cli.js missing -> file manager fallback', async () => {
    const { open, spawnDetached, openPath } = setup({ files: [`${VS}/bin/code.cmd`] })
    expect(await open.open('C:/Users/u/acme')).toMatchObject({ ok: true, reason: 'opened-folder' })
    expect(spawnDetached).not.toHaveBeenCalled()
    expect(openPath).toHaveBeenCalled()
  })
})

describe('R-07 openInEditor: posix', () => {
  it('R-07 spawns `code <folder>` found on PATH', async () => {
    const { open, spawnDetached } = setup({ platform: 'linux', files: ['/opt/code/bin/code'] })
    expect((await open.open('/home/u/acme')).ok).toBe(true)
    expect(spawnDetached.mock.calls[0]![0]).toBe('/opt/code/bin/code')
    expect(spawnDetached.mock.calls[0]![1]).toEqual(['/home/u/acme'])
  })
  it('R-07 no code on PATH -> file manager', async () => {
    const { open, openPath } = setup({ platform: 'linux', files: [] })
    expect(await open.open('/home/u/acme')).toEqual({ ok: true, reason: 'opened-folder' })
    expect(openPath).toHaveBeenCalledWith('/home/u/acme')
  })
})

describe('R-07 openInEditor: path validation', () => {
  it('R-07 relative paths and option-looking strings are refused with invalid-path and nothing runs', async () => {
    const { open, spawnDetached, openPath } = setup()
    for (const p of ['acme', './acme', '..\\x', '--new-window', '-g file:1', '', '   ']) {
      expect(await open.open(p), p).toMatchObject({ ok: false, reason: 'invalid-path' })
    }
    expect(spawnDetached).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })
  it('R-07 a path that is not an existing directory -> invalid-path', async () => {
    const { open, spawnDetached } = setup({ dir: false })
    expect(await open.open('C:/Users/u/acme/file.txt')).toMatchObject({ ok: false, reason: 'invalid-path' })
    expect(spawnDetached).not.toHaveBeenCalled()
  })
  it('R-07 a posix relative path is refused on linux too', async () => {
    const { open } = setup({ platform: 'linux', files: ['/opt/code/bin/code'] })
    expect((await open.open('acme')).ok).toBe(false)
  })
})
