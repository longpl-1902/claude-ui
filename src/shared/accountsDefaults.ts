import type { AccountsFile, AccountsSnapshot, LimitPolicy, SafetySettings } from './types'

export const DEFAULT_SAFETY: SafetySettings = {
  warnPersonalInCompanyFolder: true,
  showAccountColorEdge: true,
  lockAccountOnTeamStart: true
}

export const DEFAULT_LIMIT_POLICY: LimitPolicy = 'pause'

export const ACCOUNT_COLORS = ['#6E9BF0', '#F2A541', '#5ED3A8', '#C792EA', '#F07178', '#82AAFF']

export const EMPTY_ACCOUNTS_SNAPSHOT: AccountsSnapshot = {
  accounts: [],
  defaultAccountId: '',
  activeAccountId: '',
  detected: [],
  rules: [],
  safety: DEFAULT_SAFETY,
  limitPolicy: 'pause',
  sessions: []
}

export function emptyAccountsFile(): AccountsFile {
  return {
    version: 1,
    profiles: [],
    rules: [],
    defaultAccountId: null,
    safety: { ...DEFAULT_SAFETY },
    limitPolicy: DEFAULT_LIMIT_POLICY
  }
}
