import { describe, expect, it } from 'vitest'
import { detectLogins, looksLikeClaudeConfigDir, toDetectedLogin, type DetectedDir } from '../../../src/main/accounts/detect'
import { createSafeFs } from '../../../src/main/accounts/safeFs'
import type { HostEnv } from '../../../src/main/contracts'
import type { AccountProfile } from '@shared/types'
import { createMemoryFs } from './memoryFs'

const HOME = 'C:/Users/u'
const USER_DIR = `${HOME}/AppData/Roaming/Code/User`
const DENIED = ['.credentials', 'json'].join('.')
const host = (env: Record<string, string> = {}): HostEnv => ({ home: HOME, platform: 'win32', env, appData: `${HOME}/AppData/Roaming` })
const mk = (files: Record<string, string>, dirs: string[] = []) => createMemoryFs(files, dirs, { caseInsensitive: true })

const signedIn = (email = 'me@example.com', org = 'Example Org'): string =>
  JSON.stringify({ oauthAccount: { emailAddress: email, organizationName: org, planDisplayName: 'FAKE-PLAN', accessToken: 'FAKE-TOKEN' } })
const vscodeEnv = (value: string): string =>
  `{ // c\n "claudeCode.environmentVariables": [ { "name": "CLAUDE_CONFIG_DIR", "value": ${JSON.stringify(value)} }, ], }`
const find = (r: DetectedDir[], dir: string): DetectedDir | undefined => r.find((d) => d.configDir === dir)

describe('R-02 looksLikeClaudeConfigDir', () => {
  it('R-02 .claude.json alone is enough', () => {
    expect(looksLikeClaudeConfigDir(['.claude.json'])).toBe(true)
  })
  it('R-02 two markers are enough, one is not', () => {
    expect(looksLikeClaudeConfigDir(['settings.json', 'projects'])).toBe(true)
    expect(looksLikeClaudeConfigDir(['settings.json'])).toBe(false)
    expect(looksLikeClaudeConfigDir(['config.json', 'feature-flags.json', 'tool-history.jsonl', 'x.log'])).toBe(false)
    expect(looksLikeClaudeConfigDir([])).toBe(false)
  })
  it('R-05 the credentials file is not a marker', () => {
    expect(looksLikeClaudeConfigDir([DENIED])).toBe(false)
    expect(looksLikeClaudeConfigDir([DENIED, 'settings.json'])).toBe(false)
  })
})

describe('R-02/R-03 detectLogins', () => {
  it('R-03 default dir shows the email from ~/.claude.json, not the stub in ~/.claude', async () => {
    const fs = mk({ [`${HOME}/.claude.json`]: signedIn(), [`${HOME}/.claude/.claude.json`]: '{"numStartups":1}' })
    const r = await detectLogins(fs, host())
    const d = find(r, '~/.claude')!
    expect(d).toBeDefined()
    expect(d.isDefaultDir).toBe(true)
    expect(d.exists).toBe(true)
    expect(d.display).toEqual({ signedIn: true, email: 'me@example.com', org: 'Example Org' })
    expect(d.sources).toContain('Claude Code CLI (default folder)')
    expect(JSON.stringify(r)).not.toContain('FAKE')
    expect(r[0].configDir).toBe('~/.claude')
  })

  it('R-02 ~/.claude-server-commander is excluded; a dir with settings.json + projects/ is included, not signed in', async () => {
    const fs = mk({
      [`${HOME}/.claude-server-commander/config.json`]: '{}',
      [`${HOME}/.claude-server-commander/feature-flags.json`]: '{}',
      [`${HOME}/.claude-server-commander/tool-history.jsonl`]: '',
      [`${HOME}/.claude-personal/settings.json`]: '{}',
      [`${HOME}/.claude-personal/projects/p/a.jsonl`]: ''
    })
    const r = await detectLogins(fs, host())
    expect(find(r, '~/.claude-server-commander')).toBeUndefined()
    const p = find(r, '~/.claude-personal')!
    expect(p.display.signedIn).toBe(false)
    expect(p.sources).toContain('Claude Code CLI (~/.claude-personal)')
    expect(p.isDefaultDir).toBe(false)
  })

  it('R-02 a dir with only .claude.json is included; one with a single marker is not', async () => {
    const fs = mk({
      [`${HOME}/.claude-solo/.claude.json`]: signedIn('solo@example.com', 'Solo'),
      [`${HOME}/.claude-weak/settings.json`]: '{}'
    })
    const r = await detectLogins(fs, host())
    expect(find(r, '~/.claude-solo')?.display.email).toBe('solo@example.com')
    expect(find(r, '~/.claude-weak')).toBeUndefined()
  })

  it('R-02 no ~/.claude and no ~/.claude.json -> default is not listed', async () => {
    const r = await detectLogins(mk({}, [HOME]), host())
    expect(find(r, '~/.claude')).toBeUndefined()
  })

  it('R-02 a VS Code user setting for a nonexistent dir is listed with exists=false and its source', async () => {
    const fs = mk({ [`${USER_DIR}/settings.json`]: vscodeEnv('~/.claude-vsc') })
    const d = find(await detectLogins(fs, host()), '~/.claude-vsc')!
    expect(d.exists).toBe(false)
    expect(d.sources).toContain('VS Code user settings')
    expect(d.warnings).toEqual([])
  })

  it('R-02 a profile settings finding is labelled as profile settings', async () => {
    const fs = mk({ [`${USER_DIR}/profiles/p1/settings.json`]: vscodeEnv('~/.claude-prof') })
    expect(find(await detectLogins(fs, host()), '~/.claude-prof')?.sources).toContain('VS Code profile settings')
  })

  it('R-02 a workspace finding is shown with the machine-scoped warning (user decision)', async () => {
    const fs = mk({
      [`${USER_DIR}/globalStorage/storage.json`]: JSON.stringify({ profileAssociations: { workspaces: { 'file:///d%3A/proj': 'x' } } }),
      'd:/proj/.vscode/settings.json': vscodeEnv('C:/Users/u/.claude-ws')
    })
    const d = find(await detectLogins(fs, host()), '~/.claude-ws')!
    expect(d).toBeDefined()
    expect(d.warnings).toContain('Set in workspace settings - VS Code ignores this machine-scoped setting there')
    expect(d.sources.some((s) => /\.vscode\/settings\.json in /.test(s))).toBe(true)
  })

  it('R-02 extraWorkspaceFolders are scanned', async () => {
    const fs = mk({ 'e:/extra/.vscode/settings.json': vscodeEnv('C:/Users/u/.claude-extra') })
    const r = await detectLogins(fs, host(), { extraWorkspaceFolders: ['e:/extra'] })
    expect(find(r, '~/.claude-extra')).toBeDefined()
  })

  it('R-02 Claude settings.json env.CLAUDE_CONFIG_DIR is a source', async () => {
    const fs = mk({ [`${HOME}/.claude/settings.json`]: JSON.stringify({ env: { CLAUDE_CONFIG_DIR: '~/.claude-fromsettings' } }) })
    expect(find(await detectLogins(fs, host()), '~/.claude-fromsettings')?.sources).toContain(
      'Claude settings env (~/.claude/settings.json)'
    )
  })

  it('R-02 the app CLAUDE_CONFIG_DIR env var is a source', async () => {
    const r = await detectLogins(mk({}), host({ CLAUDE_CONFIG_DIR: 'C:\\Users\\u\\.claude-env' }))
    expect(find(r, '~/.claude-env')?.sources).toContain('CLAUDE_CONFIG_DIR environment variable')
  })

  it('R-02 a relative value keeps the raw value and warns', async () => {
    const r = await detectLogins(mk({}), host({ CLAUDE_CONFIG_DIR: 'rel/dir' }))
    const d = find(r, 'rel/dir')!
    expect(d).toBeDefined()
    expect(d.warnings).toContain('Not an absolute path - Claude Code resolves it relative to the current folder')
  })

  it('R-02 an explicit setting that points at ~/.claude warns about the stub file', async () => {
    const fs = mk({ [`${HOME}/.claude.json`]: signedIn() })
    const r = await detectLogins(fs, host({ CLAUDE_CONFIG_DIR: 'C:\\Users\\u\\.claude' }))
    const d = find(r, '~/.claude')!
    expect(d.sources).toEqual(expect.arrayContaining(['Claude Code CLI (default folder)', 'CLAUDE_CONFIG_DIR environment variable']))
    expect(d.warnings).toContain(
      'CLAUDE_CONFIG_DIR points at ~/.claude, so Claude reads ~/.claude/.claude.json instead of ~/.claude.json'
    )
    expect(r.filter((x) => x.isDefaultDir)).toHaveLength(1)
  })

  it('R-02 the same dir from two sources (case / slash differences) is merged once with both sources', async () => {
    const fs = mk({
      [`${HOME}/.claude-personal/.claude.json`]: signedIn('p@example.com', 'P'),
      [`${USER_DIR}/settings.json`]: vscodeEnv('C:\\USERS\\U\\.Claude-Personal\\')
    })
    const r = await detectLogins(fs, host({ CLAUDE_CONFIG_DIR: 'c:/users/u/.claude-personal' }))
    const matching = r.filter((d) => d.configDir.toLowerCase() === '~/.claude-personal')
    expect(matching).toHaveLength(1)
    expect(matching[0].sources).toEqual(
      expect.arrayContaining(['Claude Code CLI (~/.claude-personal)', 'VS Code user settings', 'CLAUDE_CONFIG_DIR environment variable'])
    )
    expect(matching[0].display.email).toBe('p@example.com')
  })

  it('R-02 default first, the rest alphabetical by configDir', async () => {
    const fs = mk({
      [`${HOME}/.claude.json`]: signedIn(),
      [`${HOME}/.claude-zeta/.claude.json`]: signedIn('z@example.com', 'Z'),
      [`${HOME}/.claude-alpha/.claude.json`]: signedIn('a@example.com', 'A')
    })
    const r = await detectLogins(fs, host())
    expect(r.map((d) => d.configDir)).toEqual(['~/.claude', '~/.claude-alpha', '~/.claude-zeta'])
  })

  it('R-05 no read ever ends with the denied basename, even when it sits in a detected dir', async () => {
    const mem = mk({
      [`${HOME}/.claude/${DENIED}`]: 'FAKE',
      [`${HOME}/.claude.json`]: signedIn(),
      [`${HOME}/.claude-personal/${DENIED}`]: 'FAKE',
      [`${HOME}/.claude-personal/settings.json`]: '{}',
      [`${HOME}/.claude-personal/projects/x.jsonl`]: ''
    })
    const r = await detectLogins(createSafeFs(mem), host())
    expect(r.length).toBeGreaterThan(0)
    expect(mem.reads.some((p) => p.replace(/\\/g, '/').toLowerCase().endsWith(DENIED))).toBe(false)
  })

  it('R-14 detection performs no writes', async () => {
    const mem = mk({ [`${HOME}/.claude.json`]: signedIn() })
    await detectLogins(mem, host())
    expect(mem.writes).toEqual([])
  })

  it('R-02 works on posix hosts', async () => {
    const fs = createMemoryFs({ '/home/u/.claude.json': signedIn(), '/home/u/.claude-w/.claude.json': signedIn('w@example.com', 'W') })
    const r = await detectLogins(fs, { home: '/home/u', platform: 'linux', env: {} })
    expect(r.map((d) => d.configDir)).toEqual(['~/.claude', '~/.claude-w'])
  })
})

describe('R-02 toDetectedLogin', () => {
  const dir: DetectedDir = {
    configDir: '~/.claude-personal',
    absPath: `${HOME}/.claude-personal`,
    isDefaultDir: false,
    exists: true,
    display: { signedIn: true, email: 'p@example.com', org: 'P' },
    sources: ['VS Code user settings'],
    warnings: ['w']
  }
  const profile = (over: Partial<AccountProfile>): AccountProfile => ({
    id: 'p1',
    name: 'P',
    color: '#6E9BF0',
    configDir: '~/.claude-personal',
    folderRules: [],
    ...over
  })

  it('R-02 links a profile whose configDir is the same path (case and form differences)', () => {
    const l = toDetectedLogin(dir, [profile({ configDir: 'C:\\USERS\\u\\.Claude-Personal' })], HOME, 'win32')
    expect(l.linkedAccountId).toBe('p1')
    expect(l).toMatchObject({ configDir: '~/.claude-personal', email: 'p@example.com', org: 'P', signedIn: true, exists: true, isDefaultDir: false })
    expect(l.sources).toEqual(['VS Code user settings'])
    expect(l.warnings).toEqual(['w'])
  })

  it('R-02 no matching profile -> no linkedAccountId', () => {
    expect(toDetectedLogin(dir, [profile({ configDir: '~/.claude-other' })], HOME, 'win32').linkedAccountId).toBeUndefined()
  })

  it('R-03 never exposes plan or token data', () => {
    expect(JSON.stringify(toDetectedLogin(dir, [], HOME, 'win32'))).not.toMatch(/plan|token/i)
  })
})
