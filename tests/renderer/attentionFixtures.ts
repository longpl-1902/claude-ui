import type { AttentionItem, ProjectStatus } from '@shared/types'

export const NOW = 1_800_000_000_000

export const project = (key: string, over: Partial<ProjectStatus> = {}): ProjectStatus => ({
  key,
  name: key.split('/').pop()!,
  root: `D:/work/${key.split('/').pop()}`,
  git: true,
  accountIds: ['acc1'],
  mixedAccounts: false,
  liveSessions: 1,
  running: 0,
  waiting: 0,
  needsYou: 0,
  tokensToday: 0,
  lastActivityMs: NOW - 1000,
  hooksActive: true,
  ...over
})

export const item = (id: string, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id,
  kind: 'permission',
  severity: 'blocked',
  projectKey: 'd:/work/alpha',
  projectName: 'alpha',
  accountId: 'acc1',
  sessionId: 's1',
  agentId: 'lead',
  agentName: 'Lead',
  detail: 'Bash: npm test',
  sinceMs: NOW - 12 * 60_000,
  external: false,
  ...over
})
