// CLI argument builder for a controlled (stream-json) session. Pure; never emits bypass/dangerous flags.

export interface ControlLaunch {
  model?: string
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk'
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  outputStyle?: string
  /** Fork point (message uuid); emitted only with resume+fork. */
  resumeAt?: string
  resume?: { kind: 'resume'; sessionId: string; fork?: boolean } | { kind: 'continue' }
}

export const MODEL_RE = /^[A-Za-z0-9._\[\]-]{1,64}$/
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const OUTPUT_STYLE_RE = /^[A-Za-z0-9 _.-]{1,64}$/
export const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
/** Env var (value '1') that enables SDK file checkpointing so rewind_files works. */
export const CHECKPOINT_ENV = 'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING'

const MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']

/** Returns the argument list, or null when the model, mode or session id is invalid. */
export function buildControlArgs(l: ControlLaunch): string[] | null {
  if (!MODES.includes(l.permissionMode)) return null
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool', 'stdio',
    '--permission-mode', l.permissionMode,
    '--replay-user-messages'
  ]
  if (l.model !== undefined) {
    if (!MODEL_RE.test(l.model) || l.model.startsWith('-')) return null
    args.push('--model', l.model)
  }
  if (l.effort !== undefined) {
    if (!EFFORTS.includes(l.effort)) return null
    args.push('--effort', l.effort)
  }
  if (l.outputStyle !== undefined) {
    if (!OUTPUT_STYLE_RE.test(l.outputStyle)) return null
    args.push('--settings', JSON.stringify({ outputStyle: l.outputStyle }))
  }
  if (l.resume) {
    if (l.resume.kind === 'continue') args.push('--continue')
    else {
      if (!SESSION_ID_RE.test(l.resume.sessionId)) return null
      args.push('--resume', l.resume.sessionId)
      if (l.resume.fork) args.push('--fork-session')
      if (l.resume.fork && l.resumeAt !== undefined) {
        if (!SESSION_ID_RE.test(l.resumeAt)) return null
        args.push('--resume-session-at', l.resumeAt)
      }
    }
  }
  return args
}
