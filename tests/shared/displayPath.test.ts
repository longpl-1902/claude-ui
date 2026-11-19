// T02 / R-26 (UX S4): project-relative / short display paths.
import { describe, expect, it } from 'vitest'
import { shortenPath, shortenPathsInText } from '@shared/displayPath'

const win = { platform: 'win32', root: 'C:/Users/u/acme', home: 'C:/Users/u' }
const posix = { platform: 'linux', root: '/home/u/acme', home: '/home/u' }

describe('R-26 shortenPath', () => {
  it('R-26 inside the root -> relative, full keeps the original', () => {
    expect(shortenPath('C:/Users/u/acme/src/a.ts', win)).toEqual({ short: 'src/a.ts', full: 'C:/Users/u/acme/src/a.ts' })
  })
  it('R-26 win32 compares case- and slash-insensitively', () => {
    const r = shortenPath('c:\\users\\U\\Acme\\src\\a.ts', win)
    expect(r.short).toBe('src/a.ts')
    expect(r.full).toBe('c:\\users\\U\\Acme\\src\\a.ts')
  })
  it('R-26 posix is case sensitive', () => {
    expect(shortenPath('/home/u/acme/src/a.ts', posix).short).toBe('src/a.ts')
    expect(shortenPath('/home/u/ACME/src/a.ts', posix).short).not.toBe('src/a.ts')
  })
  it('R-26 a prefix-trap sibling folder is not treated as inside the root', () => {
    const r = shortenPath('C:/Users/u/acme-other/x.ts', win)
    expect(r.short).not.toBe('-other/x.ts')
    expect(r.short.startsWith('~')).toBe(true)
  })
  it('R-26 outside the root but inside home -> ~', () => {
    expect(shortenPath('C:/Users/u/docs/n.md', win).short).toBe('~/docs/n.md')
    expect(shortenPath('/home/u/docs/n.md', posix).short).toBe('~/docs/n.md')
  })
  it('R-26 temp / scratchpad dirs collapse to <tmp>/<last 2 segments>', () => {
    expect(shortenPath('C:/Users/u/AppData/Local/Temp/claude/abc123/scratch/out.txt', win).short).toBe('‹tmp›/scratch/out.txt')
    expect(shortenPath('/tmp/x/y/z/data.json', posix).short).toBe('‹tmp›/z/data.json')
  })
  it('R-26 anything else stays as it is', () => {
    expect(shortenPath('D:/other/file.txt', win).short).toBe('D:/other/file.txt')
    expect(shortenPath('/etc/hosts', posix).short).toBe('/etc/hosts')
  })
  it('R-26 works without root or home and never throws on odd input', () => {
    expect(shortenPath('C:/x/y.ts', { platform: 'win32' }).short).toBe('C:/x/y.ts')
    for (const p of ['', '.', 'relative/path', '//']) expect(() => shortenPath(p, win)).not.toThrow()
  })
})

describe('R-26 shortenPathsInText', () => {
  it('R-26 shortens Windows drive paths and posix paths inside a console line', () => {
    expect(shortenPathsInText('Edited C:/Users/u/acme/src/a.ts and C:\\Users\\u\\acme\\b.ts', win)).toBe('Edited src/a.ts and b.ts')
    expect(shortenPathsInText('Read /home/u/acme/src/a.ts (ok)', posix)).toBe('Read src/a.ts (ok)')
  })
  it('R-26 text without paths is unchanged', () => {
    expect(shortenPathsInText('All 12 tests passed in 3.4s', win)).toBe('All 12 tests passed in 3.4s')
  })
  it('R-26 URLs are not treated as paths', () => {
    expect(shortenPathsInText('see https://example.com/a/b/c.ts', posix)).toBe('see https://example.com/a/b/c.ts')
  })
})
