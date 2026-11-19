import { describe, expect, it } from 'vitest'
import {
  ENV_SETTING_KEYS,
  extractClaudeSettingsEnvDir,
  extractConfigDirValues,
  scanVscode
} from '../../../src/main/accounts/vscodeSettings'
import type { HostEnv } from '../../../src/main/contracts'
import { createMemoryFs } from './memoryFs'

const HOME = 'C:/Users/u'
const USER_DIR = `${HOME}/AppData/Roaming/Code/User`
const host: HostEnv = { home: HOME, platform: 'win32', env: {}, appData: `${HOME}/AppData/Roaming` }
const fwd = (s: string): string => s.replace(/\\/g, '/')

const envSetting = (value: string, key = 'claudeCode.environmentVariables'): string =>
  `{
  // user comment
  "editor.fontSize": 14,
  "${key}": [
    { "name": "CLAUDE_CONFIG_DIR", "value": ${JSON.stringify(value)} }, // trailing
  ],
}`

describe('R-02 extractConfigDirValues', () => {
  it('R-02 exposes both the current and the legacy key', () => {
    expect(ENV_SETTING_KEYS).toEqual(['claudeCode.environmentVariables', 'claude-code.environmentVariables'])
  })
  it('R-02 reads items named CLAUDE_CONFIG_DIR from both keys', () => {
    const s = {
      'claudeCode.environmentVariables': [
        { name: 'OTHER', value: 'x' },
        { name: 'CLAUDE_CONFIG_DIR', value: '~/.claude-a' }
      ],
      'claude-code.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: '~/.claude-b' }]
    }
    expect(extractConfigDirValues(s, 'linux').sort()).toEqual(['~/.claude-a', '~/.claude-b'])
  })
  it('R-02 accepts the nested shape', () => {
    const s = { claudeCode: { environmentVariables: [{ name: 'CLAUDE_CONFIG_DIR', value: '~/.claude-n' }] } }
    expect(extractConfigDirValues(s, 'linux')).toEqual(['~/.claude-n'])
  })
  it('R-02 name match is case-insensitive on win32 only', () => {
    const s = { 'claudeCode.environmentVariables': [{ name: 'claude_config_dir', value: 'C:/x' }] }
    expect(extractConfigDirValues(s, 'win32')).toEqual(['C:/x'])
    expect(extractConfigDirValues(s, 'linux')).toEqual([])
  })
  it('R-02 ignores wrong shapes and empty values', () => {
    expect(extractConfigDirValues(null, 'win32')).toEqual([])
    expect(extractConfigDirValues('str', 'win32')).toEqual([])
    expect(extractConfigDirValues({ 'claudeCode.environmentVariables': 'nope' }, 'win32')).toEqual([])
    expect(extractConfigDirValues({ 'claudeCode.environmentVariables': { name: 'CLAUDE_CONFIG_DIR', value: 'x' } }, 'win32')).toEqual([])
    expect(
      extractConfigDirValues(
        {
          'claudeCode.environmentVariables': [
            { name: 'CLAUDE_CONFIG_DIR', value: '' },
            { name: 'CLAUDE_CONFIG_DIR', value: 5 },
            { name: 'CLAUDE_CONFIG_DIR' },
            null,
            7
          ]
        },
        'win32'
      )
    ).toEqual([])
  })
})

describe('R-02 extractClaudeSettingsEnvDir', () => {
  it('R-02 reads env.CLAUDE_CONFIG_DIR', () => {
    expect(extractClaudeSettingsEnvDir({ env: { CLAUDE_CONFIG_DIR: '~/.claude-e' } })).toBe('~/.claude-e')
  })
  it('R-02 ignores missing or non-string values', () => {
    expect(extractClaudeSettingsEnvDir({})).toBeUndefined()
    expect(extractClaudeSettingsEnvDir({ env: { CLAUDE_CONFIG_DIR: 3 } })).toBeUndefined()
    expect(extractClaudeSettingsEnvDir(null)).toBeUndefined()
  })
})

describe('R-02 scanVscode', () => {
  it('R-02 user settings (JSONC with comments and trailing commas) yield a user finding', async () => {
    const fs = createMemoryFs({ [`${USER_DIR}/settings.json`]: envSetting('~/.claude-work') }, [], { caseInsensitive: true })
    const r = await scanVscode(fs, host)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ value: '~/.claude-work', scope: 'user', ignoredByVsCode: false })
    expect(fwd(r.findings[0]!.file)).toBe(`${USER_DIR}/settings.json`)
  })

  it('R-02 profile settings yield a user-profile finding', async () => {
    const fs = createMemoryFs({ [`${USER_DIR}/profiles/abc123/settings.json`]: envSetting('~/.claude-prof') }, [], {
      caseInsensitive: true
    })
    const r = await scanVscode(fs, host)
    expect(r.findings.map((f) => [f.value, f.scope])).toEqual([['~/.claude-prof', 'user-profile']])
  })

  it('R-02 the legacy key is read', async () => {
    const fs = createMemoryFs({ [`${USER_DIR}/settings.json`]: envSetting('~/.claude-old', 'claude-code.environmentVariables') }, [], {
      caseInsensitive: true
    })
    expect((await scanVscode(fs, host)).findings[0]?.value).toBe('~/.claude-old')
  })

  it('R-02 storage.json URIs are decoded and the workspace finding is flagged ignored by VS Code', async () => {
    const storage = JSON.stringify({
      profileAssociations: { workspaces: { 'file:///d%3A/work/proj': '__default__profile__' } }
    })
    const fs = createMemoryFs(
      {
        [`${USER_DIR}/globalStorage/storage.json`]: storage,
        'd:/work/proj/.vscode/settings.json': envSetting('C:/Users/u/.claude-ws')
      },
      [],
      { caseInsensitive: true }
    )
    const r = await scanVscode(fs, host)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ value: 'C:/Users/u/.claude-ws', scope: 'workspace', ignoredByVsCode: true })
    expect(fwd(r.findings[0]!.file).toLowerCase()).toBe('d:/work/proj/.vscode/settings.json')
  })

  it('R-02 backupWorkspaces folders and .code-workspace files are scanned (workspace-file scope)', async () => {
    const storage = JSON.stringify({
      backupWorkspaces: {
        folders: [{ folderUri: 'file:///d%3A/a%20b/proj' }],
        workspaces: [{ configURIPath: 'file:///d%3A/ws/team.code-workspace' }]
      }
    })
    const fs = createMemoryFs(
      {
        [`${USER_DIR}/globalStorage/storage.json`]: storage,
        'd:/a b/proj/.vscode/settings.json': envSetting('C:/c/one'),
        'd:/ws/team.code-workspace': JSON.stringify({
          folders: [],
          settings: { 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: 'C:/c/two' }] }
        })
      },
      [],
      { caseInsensitive: true }
    )
    const r = await scanVscode(fs, host)
    const byValue = Object.fromEntries(r.findings.map((f) => [f.value, f]))
    expect(byValue['C:/c/one']).toMatchObject({ scope: 'workspace', ignoredByVsCode: true })
    expect(byValue['C:/c/two']).toMatchObject({ scope: 'workspace-file', ignoredByVsCode: true })
  })

  it('R-02 opts.extraFolders are scanned and deduped against storage.json (samePath)', async () => {
    const storage = JSON.stringify({ profileAssociations: { workspaces: { 'file:///d%3A/work/proj': 'x' } } })
    const fs = createMemoryFs(
      {
        [`${USER_DIR}/globalStorage/storage.json`]: storage,
        'd:/work/proj/.vscode/settings.json': envSetting('C:/c/dup')
      },
      [],
      { caseInsensitive: true }
    )
    const r = await scanVscode(fs, host, { extraFolders: ['D:\\Work\\Proj'] })
    expect(r.findings.filter((f) => f.value === 'C:/c/dup')).toHaveLength(1)
  })

  it('R-02 respects maxWorkspaces', async () => {
    const ws: Record<string, string> = {}
    const files: Record<string, string> = {}
    for (let i = 0; i < 5; i++) {
      ws[`file:///d%3A/w${i}`] = 'x'
      files[`d:/w${i}/.vscode/settings.json`] = envSetting(`C:/c/${i}`)
    }
    files[`${USER_DIR}/globalStorage/storage.json`] = JSON.stringify({ profileAssociations: { workspaces: ws } })
    const fs = createMemoryFs(files, [], { caseInsensitive: true })
    const r = await scanVscode(fs, host, { maxWorkspaces: 2 })
    expect(r.findings.length).toBeLessThanOrEqual(2)
  })

  it('R-02 parses the extension version from the install dir name', async () => {
    const fs = createMemoryFs({}, [`${HOME}/.vscode/extensions/anthropic.claude-code-2.1.326-win32-x64`, `${HOME}/.vscode/extensions/other.ext-1.0.0`], {
      caseInsensitive: true
    })
    const r = await scanVscode(fs, host)
    expect(r.extensionInstalled).toBe(true)
    expect(r.extensionVersion).toBe('2.1.326')
  })

  it('R-02 missing files and invalid JSON give an empty result and never throw', async () => {
    const empty = await scanVscode(createMemoryFs({}, [], { caseInsensitive: true }), host)
    expect(empty).toMatchObject({ findings: [], extensionInstalled: false })
    const bad = createMemoryFs(
      { [`${USER_DIR}/settings.json`]: '{ not json', [`${USER_DIR}/globalStorage/storage.json`]: '[[[' },
      [],
      { caseInsensitive: true }
    )
    await expect(scanVscode(bad, host)).resolves.toMatchObject({ findings: [] })
  })

  it('R-02 settings without the env key produce no finding', async () => {
    const fs = createMemoryFs({ [`${USER_DIR}/settings.json`]: '{"editor.fontSize": 12}' }, [], { caseInsensitive: true })
    expect((await scanVscode(fs, host)).findings).toEqual([])
  })
})
