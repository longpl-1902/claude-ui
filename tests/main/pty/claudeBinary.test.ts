import { describe, expect, it } from 'vitest'
import { resolveClaudeCommand } from '../../../src/main/pty/claudeBinary'

const fwd = (s: string): string => s.replace(/\\/g, '/')
const existsIn =
  (files: string[]) =>
  (p: string): boolean =>
    files.map((f) => fwd(f).toLowerCase()).includes(fwd(p).toLowerCase())

const HOME = 'C:/Users/u'
const NPM = 'C:/Users/u/AppData/Roaming/npm'
const SHIM_EXE = `${NPM}/node_modules/@anthropic-ai/claude-code/bin/claude.exe`

describe('R-09 resolveClaudeCommand (win32)', () => {
  const base = { platform: 'win32' as const, home: HOME }

  it('R-09 a claude.exe on PATH is used directly', () => {
    const r = resolveClaudeCommand({
      ...base,
      env: { PATH: 'C:\\Windows;C:\\tools\\bin' },
      exists: existsIn(['C:/tools/bin/claude.exe'])
    })
    expect(r).not.toBeNull()
    expect(fwd(r!.file)).toBe('C:/tools/bin/claude.exe')
    expect(r!.argsPrefix).toEqual([])
    expect(r!.via).toBe('exe')
  })

  it('R-09 the npm claude.cmd shim resolves to the real exe behind it', () => {
    const r = resolveClaudeCommand({
      ...base,
      env: { PATH: `C:\\Windows;${NPM.replace(/\//g, '\\')}` },
      exists: existsIn([`${NPM}/claude.cmd`, SHIM_EXE])
    })
    expect(fwd(r!.file)).toBe(SHIM_EXE)
    expect(r!.argsPrefix).toEqual([])
    expect(r!.via).toBe('npm-shim-exe')
  })

  it('R-09 a shim without the sibling exe falls back to cmd.exe /d /s /c <shim>', () => {
    const r = resolveClaudeCommand({
      ...base,
      env: { PATH: NPM, ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      exists: existsIn([`${NPM}/claude.cmd`])
    })
    expect(r!.via).toBe('cmd-shim')
    expect(fwd(r!.file)).toBe('C:/Windows/System32/cmd.exe')
    expect(r!.argsPrefix.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(fwd(r!.argsPrefix[3])).toBe(`${NPM}/claude.cmd`)
  })

  it('R-09 cmd-shim without ComSpec uses cmd.exe', () => {
    const r = resolveClaudeCommand({ ...base, env: { PATH: NPM }, exists: existsIn([`${NPM}/claude.cmd`]) })
    expect(r!.file).toBe('cmd.exe')
  })

  it('R-09 PATH is read case-insensitively (Path key)', () => {
    const r = resolveClaudeCommand({ ...base, env: { Path: 'C:\\tools\\bin' }, exists: existsIn(['C:/tools/bin/claude.exe']) })
    expect(r?.via).toBe('exe')
  })

  it('R-09 PATH order wins', () => {
    const r = resolveClaudeCommand({
      ...base,
      env: { PATH: 'C:\\first;C:\\second' },
      exists: existsIn(['C:/first/claude.exe', 'C:/second/claude.exe'])
    })
    expect(fwd(r!.file)).toBe('C:/first/claude.exe')
  })

  it('R-09 falls back to ~/.local/bin/claude.exe', () => {
    const r = resolveClaudeCommand({ ...base, env: { PATH: 'C:\\Windows' }, exists: existsIn([`${HOME}/.local/bin/claude.exe`]) })
    expect(fwd(r!.file)).toBe(`${HOME}/.local/bin/claude.exe`)
    expect(r!.via).toBe('exe')
  })

  it('R-09 not found -> null', () => {
    expect(resolveClaudeCommand({ ...base, env: { PATH: 'C:\\Windows' }, exists: () => false })).toBeNull()
    expect(resolveClaudeCommand({ ...base, env: {}, exists: () => false })).toBeNull()
  })
})

describe('R-09 resolveClaudeCommand (posix)', () => {
  const base = { platform: 'linux' as const, home: '/home/u' }
  it('R-09 finds claude on PATH', () => {
    const r = resolveClaudeCommand({ ...base, env: { PATH: '/usr/bin:/opt/cc/bin' }, exists: (p) => p === '/opt/cc/bin/claude' })
    expect(r).toMatchObject({ file: '/opt/cc/bin/claude', argsPrefix: [], via: 'posix' })
  })
  it('R-09 falls back to ~/.local/bin/claude then ~/.claude/local/claude', () => {
    expect(resolveClaudeCommand({ ...base, env: { PATH: '/usr/bin' }, exists: (p) => p === '/home/u/.local/bin/claude' })?.file).toBe(
      '/home/u/.local/bin/claude'
    )
    expect(resolveClaudeCommand({ ...base, env: { PATH: '/usr/bin' }, exists: (p) => p === '/home/u/.claude/local/claude' })?.file).toBe(
      '/home/u/.claude/local/claude'
    )
  })
  it('R-09 not found -> null', () => {
    expect(resolveClaudeCommand({ ...base, env: { PATH: '/usr/bin' }, exists: () => false })).toBeNull()
  })
})
