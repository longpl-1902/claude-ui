import { posix, win32 } from 'node:path'
import type { WriteFs } from '../contracts'
import { ACCOUNT_COLORS, DEFAULT_SAFETY, emptyAccountsFile } from '@shared/accountsDefaults'
import { isFallbackPattern } from '@shared/folderRules'
import type { AccountKind, AccountProfile, AccountsFile, FolderRule, LimitPolicy, SafetySettings } from '@shared/types'

export const ACCOUNTS_FILE_NAME = 'accounts.json'

export interface LoadResult {
  data: AccountsFile
  warnings: string[]
  recoveredFrom?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const joinIn = (dir: string, name: string): string => (dir.includes('\\') ? win32 : posix).join(dir, name)

export function validateAccountsFile(raw: unknown): { data: AccountsFile; warnings: string[]; lossy: boolean } {
  const warnings: string[] = []
  let dropped = false
  if (!isRecord(raw)) return { data: emptyAccountsFile(), warnings: ['accounts file is not an object - using defaults'], lossy: true }
  if (raw.version !== 1) {
    return { data: emptyAccountsFile(), warnings: ['accounts file has an unsupported version - using defaults'], lossy: true }
  }

  const profiles: AccountProfile[] = []
  const ids = new Set<string>()
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : []
  rawProfiles.forEach((p, i) => {
    if (!isRecord(p)) {
      warnings.push(`profile #${i + 1} is not an object - dropped`); dropped = true
      return
    }
    const id = typeof p.id === 'string' ? p.id.trim() : ''
    if (!id) {
      warnings.push(`profile #${i + 1} has no id - dropped`); dropped = true
      return
    }
    if (ids.has(id)) {
      warnings.push(`profile "${id}" has a duplicate id - dropped`); dropped = true
      return
    }
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 40).trim() : ''
    if (!name) {
      warnings.push(`profile "${id}" has no name - dropped`); dropped = true
      return
    }
    const configDir = typeof p.configDir === 'string' ? p.configDir.trim() : ''
    if (!configDir) {
      warnings.push(`profile "${id}" has no configDir - dropped`); dropped = true
      return
    }
    let color: string
    if (typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) color = p.color
    else {
      color = ACCOUNT_COLORS[profiles.length % ACCOUNT_COLORS.length]!
      warnings.push(`profile "${id}" has an invalid color - replaced`)
    }
    ids.add(id)
    const profile: AccountProfile = { id, name, color, configDir, folderRules: [] }
    if (p.kind === 'company' || p.kind === 'personal') profile.kind = p.kind as AccountKind
    else if (p.kind !== undefined) warnings.push(`profile "${id}" has an invalid kind - ignored`)
    profiles.push(profile)
  })

  const rules: FolderRule[] = []
  const rawRules = Array.isArray(raw.rules) ? raw.rules : []
  rawRules.forEach((r, i) => {
    if (!isRecord(r)) {
      warnings.push(`rule #${i + 1} is not an object - dropped`); dropped = true
      return
    }
    if (typeof r.pattern !== 'string' || r.pattern.trim() === '') {
      warnings.push(`rule #${i + 1} has no pattern - dropped`); dropped = true
      return
    }
    if (isFallbackPattern(r.pattern)) {
      warnings.push(`rule #${i + 1} is a fallback pattern - dropped`); dropped = true
      return
    }
    if (typeof r.accountId !== 'string' || (r.accountId !== 'ask' && !ids.has(r.accountId))) {
      warnings.push(`rule "${r.pattern}" points at an unknown account - dropped`); dropped = true
      return
    }
    if (typeof r.note !== 'string') {
      warnings.push(`rule "${r.pattern}" has no note - dropped`); dropped = true
      return
    }
    rules.push({ pattern: r.pattern, accountId: r.accountId, note: r.note })
  })
  for (const p of profiles) p.folderRules = rules.filter((r) => r.accountId === p.id)

  let defaultAccountId: string | null = null
  if (typeof raw.defaultAccountId === 'string' && ids.has(raw.defaultAccountId)) defaultAccountId = raw.defaultAccountId
  else if (raw.defaultAccountId !== null && raw.defaultAccountId !== undefined) {
    warnings.push('defaultAccountId does not match any account - cleared')
  }

  const rawSafety = isRecord(raw.safety) ? raw.safety : {}
  const safety: SafetySettings = { ...DEFAULT_SAFETY }
  for (const k of Object.keys(DEFAULT_SAFETY) as Array<keyof SafetySettings>) {
    const v = rawSafety[k]
    if (typeof v === 'boolean') safety[k] = v
    else if (v !== undefined) warnings.push(`safety.${k} is not a boolean - default used`)
  }

  let limitPolicy: LimitPolicy = 'pause'
  if (raw.limitPolicy === 'pause' || raw.limitPolicy === 'wait' || raw.limitPolicy === 'switch') limitPolicy = raw.limitPolicy
  else if (raw.limitPolicy !== undefined) warnings.push('limitPolicy is invalid - using pause')

  return { data: { version: 1, profiles, rules, defaultAccountId, safety, limitPolicy }, warnings, lossy: dropped }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const stamp = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

export async function loadAccountsFile(fs: WriteFs, dir: string, now: () => Date = () => new Date()): Promise<LoadResult> {
  const file = joinIn(dir, ACCOUNTS_FILE_NAME)
  let text: string
  try {
    text = await fs.readFile(file)
  } catch (e) {
    if ((e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return { data: emptyAccountsFile(), warnings: [] }
    return { data: emptyAccountsFile(), warnings: ['accounts file could not be read - using defaults'] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const moved = `${file}.corrupt-${stamp(now())}`
    try {
      await fs.rename(file, moved)
    } catch {
      return { data: emptyAccountsFile(), warnings: ['accounts file is corrupt and could not be moved aside - using defaults'] }
    }
    return {
      data: emptyAccountsFile(),
      warnings: ['accounts file was corrupt - moved aside and defaults loaded'],
      recoveredFrom: moved
    }
  }
  const result = validateAccountsFile(parsed)
  if (!result.lossy) return { data: result.data, warnings: result.warnings }
  // The file parsed but could not be used as is: keep the original under a .corrupt- name so a later save cannot lose it.
  const copy = `${file}.corrupt-${stamp(now())}`
  try {
    await fs.writeFile(copy, text)
  } catch {
    return {
      data: result.data,
      warnings: [...result.warnings, 'accounts file could not be backed up before using defaults']
    }
  }
  return {
    data: result.data,
    warnings: [...result.warnings, 'original accounts file was kept aside as a .corrupt copy'],
    recoveredFrom: copy
  }
}

export async function saveAccountsFile(fs: WriteFs, dir: string, data: AccountsFile): Promise<void> {
  const out: AccountsFile = {
    ...data,
    profiles: data.profiles.map((p) => ({ ...p, folderRules: data.rules.filter((r) => r.accountId === p.id) }))
  }
  const file = joinIn(dir, ACCOUNTS_FILE_NAME)
  const tmp = `${file}.tmp`
  await fs.mkdir(dir)
  await fs.writeFile(tmp, JSON.stringify(out, null, 2) + '\n')
  await fs.rename(tmp, file)
}

export function makeProfileId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'account'
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
}
