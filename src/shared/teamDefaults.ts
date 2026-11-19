import type { Agent, TeamSnapshot, TokenTotals } from './types'

export const LEAD_ID = 'lead'

export const EMPTY_TEAM_SNAPSHOT: TeamSnapshot = {
  repo: '',
  teamName: '',
  accountId: '',
  now: new Date(0).toISOString(),
  agents: [],
  events: [],
  worktrees: [],
  tasks: [],
  overlaps: [],
  console: [],
  timelineTicks: [],
  source: 'empty'
}

export const PLACEHOLDER_AGENT: Agent = {
  id: '',
  name: '\u2014',
  initials: '',
  avatarColor: '#8E95A0',
  role: '',
  model: '',
  worktree: '',
  taskTitle: '',
  current: { tool: '', target: '' },
  elapsedSec: 0,
  tokens: 0,
  toolCalls: 0,
  timeline: [],
  activity: [],
  files: [],
  messages: []
}

export const tokenHeadline = (t: TokenTotals): number => t.input + t.output + t.cacheCreation
