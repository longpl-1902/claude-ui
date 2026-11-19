import type { AccountsSnapshot, FolderRule } from '../types'

const companyRule: FolderRule = { pattern: '~/work/hicas/**', accountId: 'company', note: 'All company repos' }
const personalRule: FolderRule = { pattern: '~/code/personal/**', accountId: 'personal', note: 'Side projects' }

// SPEC GAP: the mockup's usage % bars are intentionally not mocked.
export const mockAccountsSnapshot: AccountsSnapshot = {
  accounts: [
    {
      id: 'company',
      name: 'Company',
      color: '#6E9BF0',
      configDir: '~/.claude',
      email: 'you@company.com',
      signedIn: false,
      tokensToday: 1125000,
      folderRules: [companyRule]
    },
    {
      id: 'personal',
      name: 'Personal',
      color: '#F2A541',
      configDir: '~/.claude-personal',
      email: 'you@gmail.com',
      signedIn: false,
      folderRules: [personalRule]
    }
  ],
  defaultAccountId: 'company',
  activeAccountId: 'company',
  detected: [
    {
      configDir: '~/.claude',
      email: 'you@company.com',
      org: '[COMPANY ORG]',
      sources: ['VS Code extension', 'Claude Code CLI (default folder)'],
      signedIn: true,
      suggestedAccountId: 'company'
    },
    {
      configDir: '~/.claude-personal',
      sources: ['.vscode/settings.json in ~/code/personal/revit-playground'],
      signedIn: false,
      suggestedAccountId: 'personal'
    }
  ],
  rules: [
    { ...companyRule },
    { ...personalRule },
    { pattern: 'anything else', accountId: 'ask', note: 'Prompt when opening a new folder' }
  ],
  safety: { warnPersonalInCompanyFolder: true, showAccountColorEdge: true, lockAccountOnTeamStart: true },
  limitPolicy: 'pause',
  sessions: [
    { teamName: 'sheet-export', path: '~/work/hicas/sheet-automation', accountId: 'company', agentCount: 6 },
    { teamName: 'scratch', path: '~/code/personal/revit-playground', accountId: 'personal', agentCount: 1 }
  ]
}
