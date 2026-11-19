// T02 / R-02: CLI argument builder for a controlled (stream-json) session.
import { describe, expect, it } from 'vitest'
import { CHECKPOINT_ENV, MODEL_RE, SESSION_ID_RE, buildControlArgs } from '../../../src/main/control/args'

const SID = '11111111-aaaa-4bbb-8ccc-000000000001'
const BASE = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode']
const RM = '--replay-user-messages'

describe('R-02 buildControlArgs', () => {
  it('R-02 minimal launch: fixed flag order then the mode', () => {
    expect(buildControlArgs({ permissionMode: 'default' })).toEqual([...BASE, 'default', RM])
  })
  it('R-02 model is appended after the mode', () => {
    expect(buildControlArgs({ permissionMode: 'acceptEdits', model: 'opus' })).toEqual([...BASE, 'acceptEdits', RM, '--model', 'opus'])
  })
  it('R-02 resume adds --resume <id>; fork adds --fork-session', () => {
    expect(buildControlArgs({ permissionMode: 'plan', resume: { kind: 'resume', sessionId: SID } })).toEqual([...BASE, 'plan', RM, '--resume', SID])
    expect(buildControlArgs({ permissionMode: 'plan', resume: { kind: 'resume', sessionId: SID, fork: true } })).toEqual([...BASE, 'plan', RM, '--resume', SID, '--fork-session'])
  })
  it('R-02 continue adds --continue; model comes before resume/continue', () => {
    expect(buildControlArgs({ permissionMode: 'auto', resume: { kind: 'continue' } })).toEqual([...BASE, 'auto', RM, '--continue'])
    expect(buildControlArgs({ permissionMode: 'dontAsk', model: 'sonnet', resume: { kind: 'continue' } })).toEqual([...BASE, 'dontAsk', RM, '--model', 'sonnet', '--continue'])
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

describe('T24 protocol v2 args', () => {
  const FORK = { kind: 'resume', sessionId: SID, fork: true } as const
  const UUID = '22222222-aaaa-4bbb-8ccc-000000000002'
  it('T24 --replay-user-messages is always present', () => {
    expect(buildControlArgs({ permissionMode: 'default' })).toContain('--replay-user-messages')
  })
  it('T24 effort accepts the five levels and rejects others', () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(buildControlArgs({ permissionMode: 'default', effort: e })).toEqual([...BASE, 'default', RM, '--effort', e])
    }
    for (const e of ['', 'ultra', 'HIGH', '--x']) expect(buildControlArgs({ permissionMode: 'default', effort: e as never })).toBeNull()
  })
  it('T24 outputStyle becomes exactly --settings {"outputStyle":...}', () => {
    expect(buildControlArgs({ permissionMode: 'default', outputStyle: 'Explanatory' })).toEqual([...BASE, 'default', RM, '--settings', '{"outputStyle":"Explanatory"}'])
    expect(buildControlArgs({ permissionMode: 'default', outputStyle: 'my style_1.2-x' })).toContain('{"outputStyle":"my style_1.2-x"}')
  })
  it('T24 invalid outputStyle -> null', () => {
    for (const o of ['', 'a"b', 'a/b', 'x'.repeat(65), '{"a":1}', 'a;b']) expect(buildControlArgs({ permissionMode: 'default', outputStyle: o })).toBeNull()
  })
  it('T24 resumeAt only with resume+fork; ignored otherwise', () => {
    expect(buildControlArgs({ permissionMode: 'plan', resume: FORK, resumeAt: UUID })).toEqual([...BASE, 'plan', RM, '--resume', SID, '--fork-session', '--resume-session-at', UUID])
    expect(buildControlArgs({ permissionMode: 'plan', resume: { kind: 'resume', sessionId: SID }, resumeAt: UUID })).not.toContain('--resume-session-at')
    expect(buildControlArgs({ permissionMode: 'plan', resumeAt: UUID })).not.toContain('--resume-session-at')
    expect(buildControlArgs({ permissionMode: 'plan', resume: { kind: 'continue' }, resumeAt: UUID })).not.toContain('--resume-session-at')
  })
  it('T24 invalid resumeAt with fork -> null', () => {
    for (const r of ['', 'abc', '--x', UUID + 'z']) expect(buildControlArgs({ permissionMode: 'plan', resume: FORK, resumeAt: r })).toBeNull()
  })
  it('T24 CHECKPOINT_ENV name', () => {
    expect(CHECKPOINT_ENV).toBe('CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING')
  })
})
