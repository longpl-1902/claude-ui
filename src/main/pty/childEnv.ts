import { isAbsolute as posixAbs } from 'node:path/posix'
import { isAbsolute as winAbs } from 'node:path/win32'

export const STRIPPED_ENV_VARS: readonly string[] = [
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

export function buildChildEnv(
  base: Readonly<Record<string, string | undefined>>,
  o: { configDirAbs: string | null; platform: NodeJS.Platform }
): Record<string, string> {
  const win = o.platform === 'win32'
  if (o.configDirAbs !== null && !(win ? winAbs(o.configDirAbs) : posixAbs(o.configDirAbs))) {
    throw new Error('CLAUDE_CONFIG_DIR must be an absolute path')
  }
  const norm = (k: string): string => (win ? k.toUpperCase() : k)
  const deny = new Set([...STRIPPED_ENV_VARS, 'CLAUDE_CONFIG_DIR'].map(norm))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string' || deny.has(norm(k))) continue
    env[k] = v
  }
  if (o.configDirAbs !== null) env.CLAUDE_CONFIG_DIR = o.configDirAbs
  if (!('TERM' in env)) env.TERM = 'xterm-256color'
  if (!('COLORTERM' in env)) env.COLORTERM = 'truecolor'
  return env
}
