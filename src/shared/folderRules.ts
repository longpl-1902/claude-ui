import type { FolderRule } from './types'

export interface MatchOptions {
  home: string
  caseInsensitive: boolean
}

// Structurally identical to the T01 contract types in @shared/types.
export interface FolderResolution {
  accountId: string | 'ask'
  ruleIndex: number
  pattern?: string
}

function cleanSeparators(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

export function normalizeFolder(p: string, o: MatchOptions): string {
  let s = p.trim()
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) {
    s = o.home + s.slice(1)
  }
  s = cleanSeparators(s)
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return o.caseInsensitive ? s.toLowerCase() : s
}

function escapeChar(c: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(c) ? '\\' + c : c
}

export function globToRegExp(pattern: string, o: MatchOptions): RegExp | null {
  if (pattern.trim() === '') return null
  const p = normalizeFolder(pattern, o)
  if (p === '') return null
  const hasGlob = /[*?]/.test(p)
  let out = ''
  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i)
    if (c === '*' && p[i + 1] === '*') {
      const atStart = i === 0 || p[i - 1] === '/'
      const atEnd = i + 2 >= p.length
      const beforeSlash = p[i + 2] === '/'
      if (atStart && (atEnd || beforeSlash)) {
        if (atEnd) {
          if (i === 0) out += '.*'
          else out = out.slice(0, -1) + '(?:/.*)?'
        } else {
          out += '(?:.*/)?'
          i += 2
          continue
        }
        i += 1
        continue
      }
      out += '[^/]*'
      i += 1
    } else if (c === '*') {
      out += '[^/]*'
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += escapeChar(c)
    }
  }
  if (!hasGlob) out += '(?:/.*)?'
  return new RegExp('^' + out + '$')
}

export function isFallbackPattern(p: string): boolean {
  const t = p.trim()
  return t === '*' || t.toLowerCase() === 'anything else'
}

export function matchFolder(rules: readonly FolderRule[], folder: string, o: MatchOptions): FolderResolution {
  const f = normalizeFolder(folder, o)
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule) continue
    if (isFallbackPattern(rule.pattern)) continue
    const re = globToRegExp(rule.pattern, o)
    if (re && re.test(f)) return { accountId: rule.accountId, ruleIndex: i, pattern: rule.pattern }
  }
  return { accountId: 'ask', ruleIndex: -1 }
}
