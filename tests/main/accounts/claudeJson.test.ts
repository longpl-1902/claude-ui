import { describe, expect, it } from 'vitest'
import { parseDisplayFields, readDisplayFields } from '../../../src/main/accounts/claudeJson'
import { createSafeFs } from '../../../src/main/accounts/safeFs'
import { createMemoryFs } from './memoryFs'

const FULL = JSON.stringify({
  numStartups: 7,
  oauthAccount: {
    accountUuid: 'FAKE-UUID',
    emailAddress: 'me@example.com',
    organizationName: 'Example Org',
    organizationUuid: 'FAKE-ORG-UUID',
    displayName: 'FAKE-DISPLAY',
    fullName: 'FAKE-FULL',
    billingType: 'FAKE-BILLING',
    planDisplayName: 'FAKE-PLAN',
    accessToken: 'FAKE-TOKEN'
  },
  userID: 'FAKE-USER'
})

describe('R-03 parseDisplayFields', () => {
  it('R-03 returns only signedIn, email and org (no leaked siblings, no plan)', () => {
    const r = parseDisplayFields(FULL)
    expect(r).toEqual({ signedIn: true, email: 'me@example.com', org: 'Example Org' })
    expect(Object.keys(r).every((k) => ['signedIn', 'email', 'org'].includes(k))).toBe(true)
    expect(JSON.stringify(r)).not.toContain('FAKE')
    expect(r).not.toHaveProperty('planDisplayName')
    expect(r).not.toHaveProperty('plan')
  })
  it('R-03 no oauthAccount -> signedIn false', () => {
    expect(parseDisplayFields('{"numStartups":1}')).toEqual({ signedIn: false })
  })
  it('R-03 empty or non-string email -> signedIn false', () => {
    expect(parseDisplayFields('{"oauthAccount":{"emailAddress":""}}').signedIn).toBe(false)
    expect(parseDisplayFields('{"oauthAccount":{"emailAddress":42}}').signedIn).toBe(false)
  })
  it('R-03 email without org is signed in', () => {
    const r = parseDisplayFields('{"oauthAccount":{"emailAddress":"a@example.com"}}')
    expect(r.signedIn).toBe(true)
    expect(r.org).toBeUndefined()
  })
  it('R-03 malformed JSON -> unreadable and nothing from the content leaks', () => {
    const r = parseDisplayFields('{"oauthAccount": {"emailAddress": "leak@example.com", FAKE-TOKEN')
    expect(r.signedIn).toBe(false)
    expect(r.unreadable).toBe(true)
    expect(JSON.stringify(r)).not.toContain('leak@example.com')
    expect(JSON.stringify(r)).not.toContain('FAKE-TOKEN')
  })
})

describe('R-03 readDisplayFields', () => {
  const home = 'C:/Users/u'
  const fwd = (p: string): string => p.replace(/\\/g, '/')

  it('R-03 default dir reads <home>/.claude.json, not the stub in ~/.claude', async () => {
    const fs = createMemoryFs(
      { [`${home}/.claude.json`]: FULL, [`${home}/.claude/.claude.json`]: '{"numStartups":1,"a":2}' },
      [],
      { caseInsensitive: true }
    )
    const r = await readDisplayFields(fs, `${home}/.claude`, home, 'win32')
    expect(r).toEqual({ signedIn: true, email: 'me@example.com', org: 'Example Org' })
    expect(fs.reads.map(fwd)).not.toContain(`${home}/.claude/.claude.json`)
  })

  it('R-03 default dir with only the stub is reported missing, not signed in', async () => {
    const fs = createMemoryFs({ [`${home}/.claude/.claude.json`]: FULL }, [], { caseInsensitive: true })
    const r = await readDisplayFields(fs, `${home}/.claude`, home, 'win32')
    expect(r.signedIn).toBe(false)
    expect(r.missing).toBe(true)
  })

  it('R-03 a custom dir reads <dir>/.claude.json', async () => {
    const fs = createMemoryFs({ [`${home}/.claude-work/.claude.json`]: FULL }, [], { caseInsensitive: true })
    const r = await readDisplayFields(fs, `${home}/.claude-work`, home, 'win32')
    expect(r.email).toBe('me@example.com')
  })

  it('R-03 falls back to the legacy .config.json', async () => {
    const fs = createMemoryFs({ [`${home}/.claude-old/.config.json`]: FULL }, [], { caseInsensitive: true })
    const r = await readDisplayFields(fs, `${home}/.claude-old`, home, 'win32')
    expect(r.signedIn).toBe(true)
    expect(r.org).toBe('Example Org')
  })

  it('R-03 neither file present -> missing', async () => {
    const fs = createMemoryFs({}, [`${home}/.claude-none`], { caseInsensitive: true })
    expect(await readDisplayFields(fs, `${home}/.claude-none`, home, 'win32')).toEqual({ signedIn: false, missing: true })
  })

  it('R-03 malformed file -> unreadable', async () => {
    const fs = createMemoryFs({ [`${home}/.claude-bad/.claude.json`]: '{nope' }, [], { caseInsensitive: true })
    const r = await readDisplayFields(fs, `${home}/.claude-bad`, home, 'win32')
    expect(r.unreadable).toBe(true)
  })

  it('R-05 never touches the credentials file even when it sits next to .claude.json', async () => {
    const denied = ['.credentials', 'json'].join('.')
    const mem = createMemoryFs(
      { [`${home}/.claude-work/.claude.json`]: FULL, [`${home}/.claude-work/${denied}`]: 'FAKE' },
      [],
      { caseInsensitive: true }
    )
    const r = await readDisplayFields(createSafeFs(mem), `${home}/.claude-work`, home, 'win32')
    expect(r.signedIn).toBe(true)
    expect(mem.reads.some((p) => p.toLowerCase().endsWith(denied))).toBe(false)
  })
})
