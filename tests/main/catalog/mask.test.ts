import { describe, expect, it } from 'vitest'
import { maskArgv, maskText } from '../../../src/main/catalog/mask'

describe('mask', () => {
  it('masks env and header values after their flags', () => {
    expect(maskArgv(['mcp', 'add', '-e', 'API_KEY=abc123', '-H', 'Authorization: Bearer zzz', 'n', 'u'])).toEqual([
      'mcp', 'add', '-e', 'API_KEY=***', '-H', 'Authorization: ***', 'n', 'u'
    ])
    expect(maskArgv(['--env', 'A=b', '--header', 'X-K: v'])).toEqual(['--env', 'A=***', '--header', 'X-K: ***'])
  })
  it('masks bearer, url userinfo/query and token shapes', () => {
    expect(maskText('Bearer abc.def')).toBe('Bearer ***')
    expect(maskText('https://user:pw@example.com/p?key=1&b=2')).toBe('https://***@example.com/p?key=***&b=***')
    expect(maskText('t sk-abcdefgh1 ghp_ABCDEF123 xoxb-123456-abc')).toBe('t *** *** ***')
  })
  it('leaves plain values alone', () => {
    expect(maskArgv(['mcp', 'add', 'srv', 'node', '--', 'server.js'])).toEqual(['mcp', 'add', 'srv', 'node', '--', 'server.js'])
  })
})
