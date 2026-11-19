import { describe, expect, it } from 'vitest'
import { globToRegExp, isFallbackPattern, matchFolder, normalizeFolder } from '@shared/folderRules'
import type { FolderRule } from '@shared/types'

const win = { home: 'C:/Users/u', caseInsensitive: true }
const posix = { home: '/home/u', caseInsensitive: false }
const rule = (pattern: string, accountId: string, note = ''): FolderRule => ({ pattern, accountId, note })
const matches = (pattern: string, folder: string, o = win): boolean => !!globToRegExp(pattern, o)?.test(normalizeFolder(folder, o))

describe('R-07 normalizeFolder', () => {
  it('R-07 expands ~, normalizes separators, strips trailing slash, lowercases when insensitive', () => {
    expect(normalizeFolder('~\\Work//Acme\\', win)).toBe('c:/users/u/work/acme')
    expect(normalizeFolder('~/Work', posix)).toBe('/home/u/Work')
  })
})

describe('R-07 globToRegExp', () => {
  it('R-07 empty or whitespace pattern -> null', () => {
    expect(globToRegExp('', win)).toBeNull()
    expect(globToRegExp('   ', win)).toBeNull()
  })

  it('R-07 ~/work/acme/** matches the folder itself and anything below, not a sibling prefix', () => {
    const p = '~/work/acme/**'
    expect(matches(p, 'C:\\Users\\u\\work\\acme')).toBe(true)
    expect(matches(p, 'C:\\Users\\u\\work\\acme\\repo\\src')).toBe(true)
    expect(matches(p, 'C:/Users/u/work/acmex')).toBe(false)
    expect(matches(p, 'C:/Users/u/work')).toBe(false)
  })

  it('R-07 case-insensitive vs sensitive', () => {
    expect(matches('~/Work/**', 'c:/users/U/work/x', win)).toBe(true)
    expect(matches('~/Work/**', '/home/u/work/x', posix)).toBe(false)
    expect(matches('~/Work/**', '/home/u/Work/x', posix)).toBe(true)
  })

  it('R-07 * stays inside one segment', () => {
    expect(matches('D:/proj/*/src', 'D:/proj/a/src')).toBe(true)
    expect(matches('D:/proj/*/src', 'D:/proj/a/b/src')).toBe(false)
    expect(matches('D:/proj/app-*', 'D:/proj/app-one')).toBe(true)
    expect(matches('D:/proj/app-*', 'D:/proj/app-one/deeper')).toBe(false)
  })

  it('R-07 ? matches exactly one non-slash char', () => {
    expect(matches('D:/p?', 'D:/p1')).toBe(true)
    expect(matches('D:/p?', 'D:/p')).toBe(false)
    expect(matches('D:/p?', 'D:/p12')).toBe(false)
    expect(matches('D:/p?', 'D:/p/')).toBe(false)
  })

  it('R-07 **/company-*/** matches any company-* segment', () => {
    expect(matches('**/company-*/**', 'D:/x/y/company-acme/repo')).toBe(true)
    expect(matches('**/company-*/**', 'D:/company-acme')).toBe(true)
    expect(matches('**/company-*/**', 'D:/x/personal/repo')).toBe(false)
  })

  it('R-07 a plain path is a prefix: itself and descendants, not siblings', () => {
    expect(matches('D:/work', 'D:/work')).toBe(true)
    expect(matches('D:/work', 'D:/work/x/y')).toBe(true)
    expect(matches('D:/work', 'D:/workshop')).toBe(false)
  })

  it('R-07 regex metacharacters in the pattern are literal', () => {
    expect(matches('D:/a+b (1)/**', 'D:/a+b (1)/x')).toBe(true)
    expect(matches('D:/a+b (1)/**', 'D:/aab (1)/x')).toBe(false)
    expect(matches('D:/v1.0/**', 'D:/v1x0/x')).toBe(false)
  })

  it('R-07 the match is anchored (no substring hits)', () => {
    expect(matches('D:/work/*', 'E:/D:/work/x')).toBe(false)
    expect(matches('work/*', 'D:/work/x')).toBe(false)
  })
})

describe('R-07 isFallbackPattern', () => {
  it('R-07 recognises the "Anything else" row and a lone *', () => {
    expect(isFallbackPattern('Anything else')).toBe(true)
    expect(isFallbackPattern('anything ELSE')).toBe(true)
    expect(isFallbackPattern('*')).toBe(true)
    expect(isFallbackPattern('~/work/*')).toBe(false)
    expect(isFallbackPattern('**')).toBe(false)
  })
})

describe('R-07 matchFolder', () => {
  it('R-07 first match wins with overlapping rules', () => {
    const rules = [rule('~/work/personal/**', 'me'), rule('~/work/**', 'work')]
    expect(matchFolder(rules, 'C:/Users/u/work/personal/blog', win)).toEqual({
      accountId: 'me',
      ruleIndex: 0,
      pattern: '~/work/personal/**'
    })
    expect(matchFolder(rules, 'C:/Users/u/work/acme', win)).toEqual({ accountId: 'work', ruleIndex: 1, pattern: '~/work/**' })
  })

  it('R-07 rule order, not specificity, decides', () => {
    const rules = [rule('~/work/**', 'work'), rule('~/work/personal/**', 'me')]
    expect(matchFolder(rules, 'C:/Users/u/work/personal/blog', win).accountId).toBe('work')
  })

  it('R-07 an explicit ask rule returns ask with its index', () => {
    const rules = [rule('D:/x/**', 'ask'), rule('D:/**', 'work')]
    expect(matchFolder(rules, 'D:/x/y', win)).toMatchObject({ accountId: 'ask', ruleIndex: 0 })
  })

  it('R-07 no match or no rules -> ask / -1', () => {
    expect(matchFolder([], 'D:/x', win)).toEqual({ accountId: 'ask', ruleIndex: -1 })
    expect(matchFolder([rule('E:/**', 'a')], 'D:/x', win)).toEqual({ accountId: 'ask', ruleIndex: -1 })
  })

  it('R-07 fallback-pattern rules are skipped', () => {
    const rules = [rule('Anything else', 'work'), rule('*', 'work'), rule('D:/x/**', 'me')]
    expect(matchFolder(rules, 'D:/x/y', win)).toMatchObject({ accountId: 'me', ruleIndex: 2 })
    expect(matchFolder(rules.slice(0, 2), 'D:/x/y', win)).toEqual({ accountId: 'ask', ruleIndex: -1 })
  })

  it('R-07 empty patterns are ignored', () => {
    const rules = [rule('', 'work'), rule('  ', 'work'), rule('D:/x/**', 'me')]
    expect(matchFolder(rules, 'D:/x/y', win)).toMatchObject({ accountId: 'me', ruleIndex: 2 })
  })

  it('R-07 separators are normalized on both sides', () => {
    expect(matchFolder([rule('D:\\work\\**', 'w')], 'D:/work/a/b', win).accountId).toBe('w')
  })
})
