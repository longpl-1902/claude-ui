import { matchFolder, normalizeFolder, type FolderResolution, type MatchOptions } from './folderRules'
import type { FolderRule, SafetySettings } from './types'

export type LaunchWarning = 'personal-in-company-folder'
export type LaunchBlock = 'unknown-account' | 'account-locked'

// Structurally identical to the T01 contract type in @shared/types.
export interface LaunchCheck {
  allowed: boolean
  blockedReason?: LaunchBlock
  warnings: LaunchWarning[]
  matched: FolderResolution
}

export interface SafetyProfile {
  id: string
  kind?: 'company' | 'personal'
}
export interface SafetySession {
  path: string
  accountId: string
}
export interface CheckLaunchInput {
  folder: string
  accountId: string
  profiles: readonly SafetyProfile[]
  rules: readonly FolderRule[]
  safety: SafetySettings
  sessions: readonly SafetySession[]
  match: MatchOptions
}

export function isSameOrNested(a: string, b: string, o: MatchOptions): boolean {
  const x = normalizeFolder(a, o)
  const y = normalizeFolder(b, o)
  return x === y || y.startsWith(x + '/') || x.startsWith(y + '/')
}

export function checkLaunch(i: CheckLaunchInput): LaunchCheck {
  const matched = matchFolder(i.rules, i.folder, i.match)
  const profile = i.profiles.find((p) => p.id === i.accountId)
  if (!profile) return { allowed: false, blockedReason: 'unknown-account', warnings: [], matched }

  if (
    i.safety.lockAccountOnTeamStart &&
    i.sessions.some((s) => s.accountId !== i.accountId && isSameOrNested(s.path, i.folder, i.match))
  ) {
    return { allowed: false, blockedReason: 'account-locked', warnings: [], matched }
  }

  const warnings: LaunchWarning[] = []
  if (i.safety.warnPersonalInCompanyFolder && profile.kind === 'personal') {
    const target = i.profiles.find((p) => p.id === matched.accountId)
    if (target?.kind === 'company') warnings.push('personal-in-company-folder')
  }
  return { allowed: true, warnings, matched }
}
