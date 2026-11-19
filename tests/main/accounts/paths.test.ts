import { describe, expect, it } from 'vitest'
import {
  claudeJsonPathFor,
  expandHome,
  fileUriToPath,
  isAbsoluteFor,
  isDefaultConfigDir,
  legacyConfigJsonPathFor,
  normalizeForCompare,
  samePath,
  toDisplayPath,
  vscodeUserDirs
} from '../../../src/main/accounts/paths'
import type { HostEnv } from '../../../src/main/contracts'

const fwd = (s: string): string => s.replace(/\\/g, '/')
const WIN = 'C:/Users/u'
const POSIX = '/home/u'

describe('R-03 paths: expandHome', () => {
  it.each([
    ['~', WIN],
    ['~/x', `${WIN}/x`],
    ['~\\x', `${WIN}/x`],
    ['$HOME/x', `${WIN}/x`],
    ['%USERPROFILE%\\x', `${WIN}/x`],
    ['%userprofile%/x', `${WIN}/x`]
  ])('R-03 win32 %s', (input, expected) => {
    expect(fwd(expandHome(input, WIN))).toBe(expected)
  })
  it('R-03 leaves absolute and relative paths unchanged', () => {
    expect(expandHome('D:/other/dir', WIN)).toBe('D:/other/dir')
    expect(expandHome('rel/dir', WIN)).toBe('rel/dir')
  })
  it('R-03 posix', () => {
    expect(expandHome('~/.claude-x', POSIX)).toBe('/home/u/.claude-x')
    expect(expandHome('$HOME/a', POSIX)).toBe('/home/u/a')
    expect(expandHome('/abs/p', POSIX)).toBe('/abs/p')
  })
})

describe('R-03 paths: toDisplayPath', () => {
  it('R-03 under home -> ~/...', () => {
    expect(toDisplayPath(`${WIN}/.claude-work`, WIN, 'win32')).toBe('~/.claude-work')
    expect(toDisplayPath('C:\\Users\\u\\.claude', WIN, 'win32')).toBe('~/.claude')
    expect(toDisplayPath('/home/u/.claude-x', POSIX, 'linux')).toBe('~/.claude-x')
  })
  it('R-03 home itself -> ~', () => {
    expect(toDisplayPath(WIN, WIN, 'win32')).toBe('~')
    expect(toDisplayPath('/home/u', POSIX, 'linux')).toBe('~')
  })
  it('R-03 outside home keeps forward slashes; a sibling prefix is not home', () => {
    expect(toDisplayPath('D:\\work\\x', WIN, 'win32')).toBe('D:/work/x')
    expect(toDisplayPath('C:/Users/ux/foo', WIN, 'win32')).toBe('C:/Users/ux/foo')
  })
})

describe('R-07 paths: normalizeForCompare / samePath', () => {
  it('R-07 win32 lowercases, uses / and drops trailing and double slashes', () => {
    expect(normalizeForCompare('C:\\Users\\U//Foo/', 'win32')).toBe('c:/users/u/foo')
  })
  it('R-07 darwin lowercases, linux keeps case', () => {
    expect(normalizeForCompare('/Users/U/Foo', 'darwin')).toBe('/users/u/foo')
    expect(normalizeForCompare('/home/U/Foo/', 'linux')).toBe('/home/U/Foo')
  })
  it('R-07 samePath: case and separators on win32', () => {
    expect(samePath('C:\\USERS\\u\\.Claude-X\\', 'c:/users/U/.claude-x', WIN, 'win32')).toBe(true)
    expect(samePath('~/.claude-x', 'C:/Users/u/.claude-x', WIN, 'win32')).toBe(true)
    expect(samePath('C:/a', 'C:/b', WIN, 'win32')).toBe(false)
  })
  it('R-07 samePath: case matters on linux', () => {
    expect(samePath('/home/u/A', '/home/u/a', POSIX, 'linux')).toBe(false)
    expect(samePath('~/a', '/home/u/a', POSIX, 'linux')).toBe(true)
  })
})

describe('R-03 paths: isAbsoluteFor', () => {
  it.each(['C:/x', 'C:\\x', '\\\\srv\\share\\x'])('R-03 win32 absolute %s', (p) => {
    expect(isAbsoluteFor(p, 'win32')).toBe(true)
  })
  it.each(['rel', 'rel/x', '~/x', '.\\x'])('R-03 win32 not absolute %s', (p) => {
    expect(isAbsoluteFor(p, 'win32')).toBe(false)
  })
  it('R-03 posix', () => {
    expect(isAbsoluteFor('/x', 'linux')).toBe(true)
    expect(isAbsoluteFor('x/y', 'linux')).toBe(false)
  })
})

describe('R-03 paths: claude.json locations (Verified fact 2)', () => {
  it('R-03 isDefaultConfigDir', () => {
    expect(isDefaultConfigDir(`${WIN}/.claude`, WIN, 'win32')).toBe(true)
    expect(isDefaultConfigDir('C:\\USERS\\U\\.CLAUDE\\', WIN, 'win32')).toBe(true)
    expect(isDefaultConfigDir(`${WIN}/.claude-work`, WIN, 'win32')).toBe(false)
    expect(isDefaultConfigDir('/home/u/.claude', POSIX, 'linux')).toBe(true)
  })
  it('R-03 default dir -> <home>/.claude.json (not the stub inside ~/.claude)', () => {
    expect(fwd(claudeJsonPathFor(`${WIN}/.claude`, WIN, 'win32'))).toBe(`${WIN}/.claude.json`)
    expect(claudeJsonPathFor('/home/u/.claude', POSIX, 'linux')).toBe('/home/u/.claude.json')
  })
  it('R-03 other dir -> <dir>/.claude.json', () => {
    expect(fwd(claudeJsonPathFor(`${WIN}/.claude-work`, WIN, 'win32'))).toBe(`${WIN}/.claude-work/.claude.json`)
    expect(claudeJsonPathFor('/data/cc', POSIX, 'linux')).toBe('/data/cc/.claude.json')
  })
  it('R-03 legacy .config.json', () => {
    expect(fwd(legacyConfigJsonPathFor(`${WIN}/.claude-work`, WIN, 'win32'))).toBe(`${WIN}/.claude-work/.config.json`)
    expect(fwd(legacyConfigJsonPathFor(`${WIN}/.claude`, WIN, 'win32'))).toBe(`${WIN}/.claude/.config.json`)
  })
})

describe('R-02 paths: vscodeUserDirs', () => {
  const host = (o: Partial<HostEnv> & Pick<HostEnv, 'platform' | 'home'>): HostEnv => ({ env: {}, ...o })
  it('R-02 win32 uses host.appData first', () => {
    const dirs = vscodeUserDirs(host({ platform: 'win32', home: WIN, appData: 'C:/Users/u/AppData/Roaming' })).map(fwd)
    expect(dirs).toContain('C:/Users/u/AppData/Roaming/Code/User')
    expect(dirs).toContain('C:/Users/u/AppData/Roaming/Code - Insiders/User')
  })
  it('R-02 win32 falls back to env.APPDATA then <home>/AppData/Roaming', () => {
    const a = vscodeUserDirs(host({ platform: 'win32', home: WIN, env: { APPDATA: 'E:/Roam' } })).map(fwd)
    expect(a).toContain('E:/Roam/Code/User')
    const b = vscodeUserDirs(host({ platform: 'win32', home: WIN })).map(fwd)
    expect(b).toContain('C:/Users/u/AppData/Roaming/Code/User')
  })
  it('R-02 darwin', () => {
    const d = vscodeUserDirs(host({ platform: 'darwin', home: '/Users/u' }))
    expect(d).toContain('/Users/u/Library/Application Support/Code/User')
    expect(d).toContain('/Users/u/Library/Application Support/Code - Insiders/User')
  })
  it('R-02 linux honours XDG_CONFIG_HOME', () => {
    expect(vscodeUserDirs(host({ platform: 'linux', home: POSIX }))).toContain('/home/u/.config/Code/User')
    expect(vscodeUserDirs(host({ platform: 'linux', home: POSIX, env: { XDG_CONFIG_HOME: '/x/cfg' } }))).toContain(
      '/x/cfg/Code/User'
    )
  })
})

describe('R-02 paths: fileUriToPath', () => {
  it('R-02 win32 decodes %3A and drops the leading slash', () => {
    expect(fileUriToPath('file:///d%3A/learn/x', 'win32')).toBe('d:/learn/x')
  })
  it('R-02 decodes spaces', () => {
    expect(fileUriToPath('file:///d%3A/my%20work/x', 'win32')).toBe('d:/my work/x')
    expect(fileUriToPath('file:///home/u/my%20dir', 'linux')).toBe('/home/u/my dir')
  })
  it('R-02 non-file schemes -> null', () => {
    expect(fileUriToPath('vscode-remote://ssh-remote%2Bhost/home/u/x', 'win32')).toBeNull()
    expect(fileUriToPath('https://example.com/x', 'linux')).toBeNull()
  })
})
