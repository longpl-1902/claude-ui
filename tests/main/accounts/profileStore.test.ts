import { describe, expect, it } from 'vitest'
import {
  ACCOUNTS_FILE_NAME,
  loadAccountsFile,
  makeProfileId,
  saveAccountsFile,
  validateAccountsFile
} from '../../../src/main/accounts/profileStore'
import { ACCOUNT_COLORS, DEFAULT_SAFETY, emptyAccountsFile } from '@shared/accountsDefaults'
import type { AccountsFile } from '@shared/types'
import { createMemoryFs } from './memoryFs'

const DIR = 'C:/Users/u/AppData/Roaming/agent-console'
const FILE = `${DIR}/${ACCOUNTS_FILE_NAME}`
const goodFile = (): AccountsFile => ({
  version: 1,
  profiles: [
    { id: 'work', name: 'Work', color: '#6E9BF0', configDir: '~/.claude-work', kind: 'company', folderRules: [{ pattern: '~/work/**', accountId: 'work', note: 'n' }] },
    { id: 'me', name: 'Me', color: '#F2A541', configDir: '~/.claude', kind: 'personal', folderRules: [] }
  ],
  rules: [{ pattern: '~/work/**', accountId: 'work', note: 'n' }],
  defaultAccountId: 'me',
  safety: { warnPersonalInCompanyFolder: false, showAccountColorEdge: true, lockAccountOnTeamStart: false },
  limitPolicy: 'wait'
})

describe('R-06 validateAccountsFile', () => {
  it('R-06 a valid file passes unchanged with no warnings', () => {
    const r = validateAccountsFile(goodFile())
    expect(r.warnings).toEqual([])
    expect(r.data).toEqual(goodFile())
  })

  it('R-06 non-object or wrong version -> defaults with a warning', () => {
    for (const raw of [null, 'x', 42, [], { version: 2, profiles: [] }]) {
      const r = validateAccountsFile(raw)
      expect(r.data).toEqual(emptyAccountsFile())
      expect(r.warnings.length).toBeGreaterThan(0)
    }
  })

  it('R-06 drops profiles with missing/duplicate id, empty name, or empty configDir', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    raw.profiles = [
      { id: 'ok', name: 'Ok', color: '#6E9BF0', configDir: '~/a' },
      { id: '', name: 'NoId', color: '#6E9BF0', configDir: '~/b' },
      { id: 'ok', name: 'Dup', color: '#6E9BF0', configDir: '~/c' },
      { id: 'noname', name: '  ', color: '#6E9BF0', configDir: '~/d' },
      { id: 'nodir', name: 'X', color: '#6E9BF0', configDir: '' },
      'garbage',
      null
    ]
    raw.rules = []
    raw.defaultAccountId = null
    const r = validateAccountsFile(raw)
    expect(r.data.profiles.map((p) => p.id)).toEqual(['ok'])
    expect(r.warnings.length).toBeGreaterThanOrEqual(5)
  })

  it('R-06 trims the name to 40 chars and replaces a bad color with the next palette color', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    raw.profiles = [{ id: 'a', name: `  ${'n'.repeat(60)}  `, color: 'red', configDir: '~/a' }]
    raw.rules = []
    raw.defaultAccountId = null
    const p = validateAccountsFile(raw).data.profiles[0]
    expect(p.name).toBe('n'.repeat(40))
    expect(ACCOUNT_COLORS).toContain(p.color)
  })

  it('R-06 an invalid kind is dropped, valid kinds are kept', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    raw.profiles = [
      { id: 'a', name: 'A', color: '#112233', configDir: '~/a', kind: 'enterprise' },
      { id: 'b', name: 'B', color: '#112233', configDir: '~/b', kind: 'personal' }
    ]
    raw.rules = []
    raw.defaultAccountId = null
    const ps = validateAccountsFile(raw).data.profiles
    expect(ps[0].kind).toBeUndefined()
    expect(ps[1].kind).toBe('personal')
  })

  it('R-06 drops rules with bad pattern, unknown account, or a fallback pattern; keeps ask', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    raw.rules = [
      { pattern: '~/ok/**', accountId: 'work', note: '' },
      { pattern: '', accountId: 'work', note: '' },
      { pattern: '~/x/**', accountId: 'ghost', note: '' },
      { pattern: 'Anything else', accountId: 'work', note: '' },
      { pattern: '*', accountId: 'work', note: '' },
      { pattern: '~/ask/**', accountId: 'ask', note: '' },
      { pattern: '~/nonote/**', accountId: 'work' },
      { accountId: 'work', note: '' }
    ]
    const r = validateAccountsFile(raw)
    expect(r.data.rules.map((x) => x.pattern)).toEqual(['~/ok/**', '~/ask/**'])
    expect(r.warnings.length).toBeGreaterThanOrEqual(4)
  })

  it('R-06 defaultAccountId must reference an existing profile, else null', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    raw.defaultAccountId = 'ghost'
    expect(validateAccountsFile(raw).data.defaultAccountId).toBeNull()
  })

  it('R-06 non-boolean safety keys fall back to defaults; an invalid limit policy falls back to pause', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    raw.safety = { warnPersonalInCompanyFolder: 'yes', showAccountColorEdge: false }
    raw.limitPolicy = 'explode'
    const r = validateAccountsFile(raw).data
    expect(r.safety).toEqual({ ...DEFAULT_SAFETY, showAccountColorEdge: false })
    expect(r.limitPolicy).toBe('pause')
  })

  it('R-06 profile.folderRules is re-derived from the global rules list', () => {
    const raw = goodFile() as unknown as Record<string, unknown>
    ;(raw.profiles as Array<{ folderRules: unknown }>)[0].folderRules = [{ pattern: 'stale', accountId: 'work', note: '' }]
    const r = validateAccountsFile(raw).data
    expect(r.profiles[0].folderRules).toEqual([{ pattern: '~/work/**', accountId: 'work', note: 'n' }])
    expect(r.profiles[1].folderRules).toEqual([])
  })
})

describe('R-06 loadAccountsFile / saveAccountsFile', () => {
  it('R-06 a missing file returns the defaults without writing anything', async () => {
    const fs = createMemoryFs({}, [DIR], { caseInsensitive: true })
    const r = await loadAccountsFile(fs, DIR)
    expect(r.data).toEqual(emptyAccountsFile())
    expect(r.recoveredFrom).toBeUndefined()
    expect(fs.writes).toEqual([])
  })

  it('R-06 save then load round-trips', async () => {
    const fs = createMemoryFs({}, [], { caseInsensitive: true })
    await saveAccountsFile(fs, DIR, goodFile())
    const r = await loadAccountsFile(fs, DIR)
    expect(r.warnings).toEqual([])
    expect(r.data).toEqual(goodFile())
  })

  it('R-06 save writes pretty JSON with 2-space indent', async () => {
    const fs = createMemoryFs({}, [], { caseInsensitive: true })
    await saveAccountsFile(fs, DIR, goodFile())
    const text = fs.content(FILE)!
    expect(text).toContain('\n  "version": 1')
    expect(JSON.parse(text).version).toBe(1)
  })

  it('R-06 save is atomic: mkdir, write the .tmp, then rename over accounts.json', async () => {
    const fs = createMemoryFs({}, [], { caseInsensitive: true })
    await saveAccountsFile(fs, DIR, goodFile())
    const tmp = `${FILE}.tmp`
    const iTmp = fs.ops.indexOf(`write:${tmp}`)
    const iRename = fs.ops.indexOf(`rename:${tmp}->${FILE}`)
    expect(iTmp).toBeGreaterThanOrEqual(0)
    expect(iRename).toBeGreaterThan(iTmp)
    expect(fs.ops.filter((o) => o.startsWith('write:'))).toEqual([`write:${tmp}`])
    expect(fs.has(tmp)).toBe(false)
    expect(fs.has(FILE)).toBe(true)
  })

  it('R-14 the store writes only inside its dir', async () => {
    const fs = createMemoryFs({}, [], { caseInsensitive: true })
    await saveAccountsFile(fs, DIR, goodFile())
    expect(fs.writes.length).toBeGreaterThan(0)
    for (const w of fs.writes) expect(w.replace(/\\/g, '/').startsWith(DIR)).toBe(true)
  })

  it('R-06 an unparsable file is moved aside to accounts.json.corrupt-<timestamp> and defaults are returned', async () => {
    const fs = createMemoryFs({ [FILE]: '{ this is not json' }, [], { caseInsensitive: true })
    const r = await loadAccountsFile(fs, DIR, () => new Date(2026, 10, 19, 13, 45, 30))
    expect(r.data).toEqual(emptyAccountsFile())
    expect(r.recoveredFrom).toBeDefined()
    expect(fs.has(FILE)).toBe(false)
    const moved = fs.fileKeys().filter((k) => /accounts\.json\.corrupt-\d{8}-\d{6}$/.test(k))
    expect(moved).toHaveLength(1)
    expect(fs.content(moved[0])).toBe('{ this is not json')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('R-06 a parsable file with bad entries loads with warnings, not recovery', async () => {
    const bad = { ...goodFile(), rules: [{ pattern: '', accountId: 'work', note: '' }] }
    const fs = createMemoryFs({ [FILE]: JSON.stringify(bad) }, [], { caseInsensitive: true })
    const r = await loadAccountsFile(fs, DIR)
    expect(r.recoveredFrom).toBeUndefined()
    expect(r.data.rules).toEqual([])
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('R-06 save writes derived folderRules into each profile', async () => {
    const fs = createMemoryFs({}, [], { caseInsensitive: true })
    const data = goodFile()
    data.profiles[0].folderRules = []
    await saveAccountsFile(fs, DIR, data)
    const saved = JSON.parse(fs.content(FILE)!) as AccountsFile
    expect(saved.profiles[0].folderRules).toEqual([{ pattern: '~/work/**', accountId: 'work', note: 'n' }])
  })
})

describe('R-06 makeProfileId', () => {
  it('R-06 slugs the name to [a-z0-9-]', () => {
    expect(makeProfileId('My Work Acct!', [])).toBe('my-work-acct')
    expect(makeProfileId('  Hicas  ', [])).toBe('hicas')
  })
  it('R-06 falls back to "account" for an empty slug', () => {
    expect(makeProfileId('!!!', [])).toBe('account')
    expect(makeProfileId('', [])).toBe('account')
  })
  it('R-06 appends -2, -3 on clashes', () => {
    expect(makeProfileId('Work', ['work'])).toBe('work-2')
    expect(makeProfileId('Work', ['work', 'work-2'])).toBe('work-3')
  })
})
