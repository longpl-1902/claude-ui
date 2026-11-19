import { describe, expect, it } from 'vitest'
import { checkLaunch, isSameOrNested, type CheckLaunchInput } from '@shared/safety'
import type { FolderRule, SafetySettings } from '@shared/types'

const match = { home: 'C:/Users/u', caseInsensitive: true }
const ON: SafetySettings = { warnPersonalInCompanyFolder: true, showAccountColorEdge: true, lockAccountOnTeamStart: true }
const rules: FolderRule[] = [{ pattern: 'D:/company/**', accountId: 'work', note: '' }]

function input(over: Partial<CheckLaunchInput> = {}): CheckLaunchInput {
  return {
    folder: 'D:/company/repo',
    accountId: 'work',
    profiles: [
      { id: 'work', kind: 'company' },
      { id: 'me', kind: 'personal' },
      { id: 'nokind' }
    ],
    rules,
    safety: ON,
    sessions: [],
    match,
    ...over
  }
}

describe('R-08 isSameOrNested', () => {
  it('R-08 same folder, either direction of nesting, case-insensitive', () => {
    expect(isSameOrNested('D:/a/b', 'd:\\A\\B\\', match)).toBe(true)
    expect(isSameOrNested('D:/a', 'D:/a/b/c', match)).toBe(true)
    expect(isSameOrNested('D:/a/b/c', 'D:/a', match)).toBe(true)
  })
  it('R-08 siblings with a shared prefix are not nested', () => {
    expect(isSameOrNested('D:/a/b', 'D:/a/bc', match)).toBe(false)
    expect(isSameOrNested('D:/x', 'D:/y', match)).toBe(false)
  })
})

describe('R-08 checkLaunch', () => {
  it('R-08 company account in company folder with no sessions is allowed without warnings', () => {
    const r = checkLaunch(input())
    expect(r).toMatchObject({ allowed: true, warnings: [], matched: { accountId: 'work', ruleIndex: 0 } })
    expect(r.blockedReason).toBeUndefined()
  })

  it('R-08 unknown account is blocked', () => {
    const r = checkLaunch(input({ accountId: 'ghost' }))
    expect(r).toMatchObject({ allowed: false, blockedReason: 'unknown-account' })
  })

  it('R-08 a different account is blocked while a session is running in the same folder (lock on)', () => {
    const r = checkLaunch(input({ accountId: 'me', sessions: [{ path: 'D:/company/repo', accountId: 'work' }] }))
    expect(r).toMatchObject({ allowed: false, blockedReason: 'account-locked' })
  })

  it('R-08 lock applies for nested session paths in both directions', () => {
    const parentRunning = checkLaunch(input({ accountId: 'me', sessions: [{ path: 'D:/company', accountId: 'work' }] }))
    expect(parentRunning.blockedReason).toBe('account-locked')
    const childRunning = checkLaunch(
      input({ accountId: 'me', folder: 'D:/company', sessions: [{ path: 'D:/company/repo/sub', accountId: 'work' }] })
    )
    expect(childRunning.blockedReason).toBe('account-locked')
  })

  it('R-08 the same account in a locked folder is allowed', () => {
    const r = checkLaunch(input({ sessions: [{ path: 'D:/company/repo', accountId: 'work' }] }))
    expect(r.allowed).toBe(true)
  })

  it('R-08 a session in an unrelated folder does not lock', () => {
    const r = checkLaunch(input({ accountId: 'me', safety: { ...ON, warnPersonalInCompanyFolder: false }, sessions: [{ path: 'D:/other', accountId: 'work' }] }))
    expect(r.allowed).toBe(true)
  })

  it('R-08 lock toggle off disables the block', () => {
    const r = checkLaunch(
      input({
        accountId: 'me',
        safety: { ...ON, lockAccountOnTeamStart: false, warnPersonalInCompanyFolder: false },
        sessions: [{ path: 'D:/company/repo', accountId: 'work' }]
      })
    )
    expect(r.allowed).toBe(true)
  })

  it('R-08 personal account in a company folder warns but is still allowed', () => {
    const r = checkLaunch(input({ accountId: 'me' }))
    expect(r.allowed).toBe(true)
    expect(r.warnings).toEqual(['personal-in-company-folder'])
    expect(r.matched).toMatchObject({ accountId: 'work' })
  })

  it('R-08 warn toggle off removes the warning', () => {
    const r = checkLaunch(input({ accountId: 'me', safety: { ...ON, warnPersonalInCompanyFolder: false } }))
    expect(r.warnings).toEqual([])
  })

  it('R-08 an account with no kind never warns', () => {
    expect(checkLaunch(input({ accountId: 'nokind' })).warnings).toEqual([])
  })

  it('R-08 a personal account in a folder matched to a personal account does not warn', () => {
    const r = checkLaunch(input({ folder: 'D:/me/blog', rules: [{ pattern: 'D:/me/**', accountId: 'me', note: '' }], accountId: 'me' }))
    expect(r.warnings).toEqual([])
  })

  it('R-08 an unmatched folder (ask) does not warn and reports the fallback match', () => {
    const r = checkLaunch(input({ folder: 'D:/elsewhere', accountId: 'me' }))
    expect(r.warnings).toEqual([])
    expect(r.matched).toEqual({ accountId: 'ask', ruleIndex: -1 })
  })

  it('R-08 a rule that points at an unknown profile does not warn', () => {
    const r = checkLaunch(input({ accountId: 'me', rules: [{ pattern: 'D:/company/**', accountId: 'deleted', note: '' }] }))
    expect(r.warnings).toEqual([])
  })
})
