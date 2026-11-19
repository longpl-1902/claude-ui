import type { ActivityKind, AgentStatus } from '../../../shared/types'

export const STATUS_META: Record<
  AgentStatus,
  { label: string; color: string; bg: string; pulse: boolean }
> = {
  running: { label: 'Running', color: '#F2A541', bg: '#2E2415', pulse: true },
  waiting: { label: 'Waiting', color: '#8FB4FF', bg: '#18213A', pulse: false },
  'needs-you': { label: 'Needs you', color: '#FF8A8A', bg: '#361A1C', pulse: false },
  done: { label: 'Done', color: '#5ED3A8', bg: '#14302A', pulse: false }
}

export const TOOL_COLORS: Record<string, string> = {
  Edit: '#8FB4FF',
  Write: '#8FB4FF',
  Read: '#A4AAB4',
  Grep: '#A4AAB4',
  Bash: '#C49BFF',
  SendMessage: '#5ED3A8',
  TaskUpdate: '#5ED3A8',
  Spawn: '#F2A541',
  Wait: '#7D848F',
  Fail: '#FF8A8A',
  Done: '#5ED3A8'
}

export function toolColor(tool: string): string {
  return TOOL_COLORS[tool] ?? '#A4AAB4'
}

export const SEGMENT_COLORS: Record<ActivityKind, string> = {
  think: '#3A4150',
  read: '#5C6370',
  edit: '#6E9BF0',
  bash: '#A77FEF',
  wait: '#252930',
  error: '#FF8A8A'
}

export const TIMELINE_LEGEND: { label: string; kind: ActivityKind }[] = [
  { label: 'Thinking', kind: 'think' },
  { label: 'Read / Grep', kind: 'read' },
  { label: 'Edit', kind: 'edit' },
  { label: 'Bash', kind: 'bash' },
  { label: 'Error', kind: 'error' }
]

export const ACCOUNT_FALLBACK_COLOR = '#5C636E'
