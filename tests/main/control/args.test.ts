// T02 / R-02: CLI argument builder for a controlled (stream-json) session.
import { describe, expect, it } from 'vitest'
import { MODEL_RE, SESSION_ID_RE, buildControlArgs } from '../../../src/main/control/args'

const SID = '11111111-aaaa-4bbb-8ccc-000000000001'
const BASE = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode']

describe('R-02 buildControlArgs', () => {
  it('R-02 minimal launch: fixed flag order then the mode', () => {
    expect(buildControlArgs({ permissionMode: 'default' })).toEqual([...BASE, 'default'])
  })
  it('R-02 model is appended after the mode', () => {
    expect(buildControlArgs({ permissionMode: 'acceptEdits', model: 'opus' })).toEqual([...BASE, 'acceptEdits', '--model', 'opus'])
  })
  it('R-02 resume adds --resume <id>; fork adds --fork-session', () => {
    expect(buildControlArgs({ permissionMode: 'plan', resume: { kind: 'resume', sessionId: SID } })).toEqual([...BASE, 'plan', '--resume', SID])
    expect(buildControlArgs({ permissionMode: 'plan', resume: { kind: 'resume', sessionId: SID, fork: true } })).toEqual([...BASE, 'plan', '--resume', SID, '--fork-session'])
  })
  it('R-02 continue adds --continue; model comes before resume/continue', () => {
    expect(buildControlArgs({ permissionMode: 'auto', resume: { kind: 'continue' } })).toEqual([...BASE, 'auto', '--continue'])
    expect(buildControlArgs({ permissionMode: 'dontAsk', model: 'sonnet', resume: { kind: 'continue' } })).toEqual([...BASE, 'dontAsk', '--model', 'sonnet', '--continue'])
  })
  it('R-02 every one of the five modes is accepted', () => {
    for (const m of ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const) expect(buildControlArgs({ permissionMode: m })).not.toBeNull()
  })
  it('R-02 bypassPermissions / unknown modes -> null (never offered)', () => {
    for (const m of ['bypassPermissions', 'manual', '', 'x']) expect(buildControlArgs({ permissionMode: m as never })).toBeNull()
  })
  it('R-02 invalid model -> null', () => {
    for (const model of ['', 'a b', '--help', 'x;y', 'a'.repeat(65), 'a/b']) expect(buildControlArgs({ permissionMode: 'default', model })).toBeNull()
  })
  it('R-02 invalid session id -> null', () => {
    for (const sessionId of ['', 'abc', '--version', SID + 'x', '../etc']) expect(buildControlArgs({ permissionMode: 'default', resume: { kind: 'resume', sessionId } })).toBeNull()
  })
  it('R-02 never contains dangerous flags, whatever the input', () => {
    const all = [
      buildControlArgs({ permissionMode: 'default' }),
      buildControlArgs({ permissionMode: 'auto', model: 'opus', resume: { kind: 'resume', sessionId: SID, fork: true } })
    ].flat() as string[]
    for (const a of all) {
      expect(a).not.toMatch(/dangerously/i)
      expect(a).not.toBe('bypassPermissions')
    }
  })
  it('R-02 MODEL_RE and SESSION_ID_RE', () => {
    expect(MODEL_RE.test('claude-sonnet-4.5[1m]')).toBe(true)
    expect(MODEL_RE.test('bad model')).toBe(false)
    expect(SESSION_ID_RE.test(SID)).toBe(true)
    expect(SESSION_ID_RE.test(SID.toUpperCase())).toBe(true)
    expect(SESSION_ID_RE.test('not-a-uuid')).toBe(false)
  })
})
