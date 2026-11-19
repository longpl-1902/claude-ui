import type { ActivityKind, AgentStatus } from '../../../shared/types'

/**
 * Every colour here is a CSS variable reference resolved by the active theme (styles/tokens.css), so the same
 * strings work in both the dark and the light theme. Never put a hex literal in a component.
 */
export const STATUS_META: Record<
  AgentStatus,
  { label: string; color: string; bg: string; pulse: boolean }
> = {
  running: { label: 'Running', color: 'var(--ac-status-running)', bg: 'var(--ac-status-running-bg)', pulse: true },
  waiting: { label: 'Waiting', color: 'var(--ac-status-waiting)', bg: 'var(--ac-status-waiting-bg)', pulse: false },
  'needs-you': { label: 'Needs you', color: 'var(--ac-status-needs-you)', bg: 'var(--ac-status-needs-you-bg)', pulse: false },
  done: { label: 'Done', color: 'var(--ac-status-done)', bg: 'var(--ac-status-done-bg)', pulse: false }
}

export const TOOL_COLORS: Record<string, string> = {
  Edit: 'var(--ac-tool-edit)',
  Write: 'var(--ac-tool-edit)',
  Read: 'var(--ac-tool-read)',
  Grep: 'var(--ac-tool-read)',
  Bash: 'var(--ac-tool-bash)',
  SendMessage: 'var(--ac-tool-message)',
  TaskUpdate: 'var(--ac-tool-message)',
  Spawn: 'var(--ac-tool-spawn)',
  Wait: 'var(--ac-tool-wait)',
  Fail: 'var(--ac-tool-fail)',
  Done: 'var(--ac-tool-done)'
}

export function toolColor(tool: string): string {
  return TOOL_COLORS[tool] ?? 'var(--ac-tool-read)'
}

export const SEGMENT_COLORS: Record<ActivityKind, string> = {
  think: 'var(--ac-seg-think)',
  read: 'var(--ac-seg-read)',
  edit: 'var(--ac-seg-edit)',
  bash: 'var(--ac-seg-bash)',
  wait: 'var(--ac-seg-wait)',
  error: 'var(--ac-seg-error)'
}

export const TIMELINE_LEGEND: { label: string; kind: ActivityKind }[] = [
  { label: 'Thinking', kind: 'think' },
  { label: 'Read / Grep', kind: 'read' },
  { label: 'Edit', kind: 'edit' },
  { label: 'Bash', kind: 'bash' },
  { label: 'Error', kind: 'error' }
]

export const ACCOUNT_FALLBACK_COLOR = 'var(--ac-account-fallback)'
