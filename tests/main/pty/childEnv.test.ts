import { describe, expect, it } from 'vitest'
import { buildChildEnv, STRIPPED_ENV_VARS } from '../../../src/main/pty/childEnv'

// Plan Verified fact 13: the exact denylist.
const EXPECTED_STRIPPED = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_EMIT_STARTUP_TIMING',
  'CLAUDE_CODE_STARTUP_FAILURE_RESULTS',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'CLAUDE_CODE_ENABLE_TASKS',
  'MCP_CONNECTION_NONBLOCKING',
  'ELECTRON_RUN_AS_NODE'
]

describe('R-09 buildChildEnv', () => {
  it('R-09 STRIPPED_ENV_VARS contains the whole denylist', () => {
    for (const k of EXPECTED_STRIPPED) expect(STRIPPED_ENV_VARS).toContain(k)
  })

  it.each(EXPECTED_STRIPPED)('R-09 strips %s', (k) => {
    const env = buildChildEnv({ [k]: 'x', KEEP: '1' }, { configDirAbs: null, platform: 'linux' })
    expect(env).not.toHaveProperty(k)
    expect(env.KEEP).toBe('1')
  })

  it('R-09 win32 strips denylisted vars case-insensitively', () => {
    const env = buildChildEnv(
      { ClaudeCode: '1', electron_run_as_node: '1', Claude_Code_Session_Id: 's', Path: 'C:\\x' },
      { configDirAbs: null, platform: 'win32' }
    )
    expect(Object.keys(env).map((k) => k.toLowerCase())).not.toContain('claudecode')
    expect(Object.keys(env).map((k) => k.toLowerCase())).not.toContain('electron_run_as_node')
    expect(Object.keys(env).map((k) => k.toLowerCase())).not.toContain('claude_code_session_id')
    expect(env.Path).toBe('C:\\x')
  })

  it('R-09 posix strips only the exact case', () => {
    const env = buildChildEnv({ claudecode: 'lower', CLAUDECODE: 'upper' }, { configDirAbs: null, platform: 'linux' })
    expect(env.claudecode).toBe('lower')
    expect(env).not.toHaveProperty('CLAUDECODE')
  })

  it('R-09 default account (null): CLAUDE_CONFIG_DIR is absent even when the base had one', () => {
    const env = buildChildEnv({ CLAUDE_CONFIG_DIR: 'C:/old' }, { configDirAbs: null, platform: 'win32' })
    expect(Object.keys(env).map((k) => k.toLowerCase())).not.toContain('claude_config_dir')
  })

  it('R-09 an absolute dir sets CLAUDE_CONFIG_DIR, overriding the base value', () => {
    const env = buildChildEnv({ CLAUDE_CONFIG_DIR: 'C:/old' }, { configDirAbs: 'C:/Users/u/.claude-work', platform: 'win32' })
    expect(env.CLAUDE_CONFIG_DIR.replace(/\\/g, '/')).toBe('C:/Users/u/.claude-work')
  })

  it('R-09 win32 removes a differently-cased existing CLAUDE_CONFIG_DIR before setting', () => {
    const env = buildChildEnv({ claude_config_dir: 'C:/old' }, { configDirAbs: 'C:/new', platform: 'win32' })
    const keys = Object.keys(env).filter((k) => k.toLowerCase() === 'claude_config_dir')
    expect(keys).toHaveLength(1)
    expect(env[keys[0]].replace(/\\/g, '/')).toBe('C:/new')
  })

  it('R-09 a relative dir throws', () => {
    expect(() => buildChildEnv({}, { configDirAbs: 'rel/dir', platform: 'linux' })).toThrow()
    expect(() => buildChildEnv({}, { configDirAbs: '~/.claude-x', platform: 'linux' })).toThrow()
    expect(() => buildChildEnv({}, { configDirAbs: '.claude-x', platform: 'win32' })).toThrow()
  })

  it('R-09 keeps user vars (PATH, ANTHROPIC_*, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)', () => {
    const base = { PATH: '/bin', ANTHROPIC_API_KEY: 'FAKE', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
    const env = buildChildEnv(base, { configDirAbs: null, platform: 'linux' })
    expect(env).toMatchObject(base)
  })

  it('R-09 drops undefined values and sets TERM / COLORTERM when absent', () => {
    const env = buildChildEnv({ A: undefined, B: 'b' }, { configDirAbs: null, platform: 'linux' })
    expect(env).not.toHaveProperty('A')
    expect(env.B).toBe('b')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })

  it('R-09 does not overwrite an existing TERM', () => {
    expect(buildChildEnv({ TERM: 'screen' }, { configDirAbs: null, platform: 'linux' }).TERM).toBe('screen')
  })

  it('R-09 does not mutate the base env', () => {
    const base = { CLAUDECODE: '1' }
    buildChildEnv(base, { configDirAbs: '/x', platform: 'linux' })
    expect(base).toEqual({ CLAUDECODE: '1' })
  })
})
