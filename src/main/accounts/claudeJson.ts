import type { DisplayFields, ReadFs } from '../contracts'
import { claudeJsonPathFor, legacyConfigJsonPathFor } from './paths'

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

/** Returns ONLY signedIn/email/org. Never copies other fields or error text. */
export function parseDisplayFields(text: string): DisplayFields {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { signedIn: false, unreadable: true }
  }
  const acct = (data as { oauthAccount?: unknown } | null)?.oauthAccount
  const rec = acct && typeof acct === 'object' ? (acct as Record<string, unknown>) : {}
  const email = nonEmpty(rec.emailAddress)
  const org = nonEmpty(rec.organizationName)
  const out: DisplayFields = { signedIn: email !== undefined }
  if (email !== undefined) out.email = email
  if (org !== undefined) out.org = org
  return out
}

export async function readDisplayFields(
  fs: ReadFs,
  dir: string,
  home: string,
  platform: NodeJS.Platform
): Promise<DisplayFields> {
  for (const path of [claudeJsonPathFor(dir, home, platform), legacyConfigJsonPathFor(dir, home, platform)]) {
    let text: string
    try {
      text = await fs.readFile(path)
    } catch (e) {
      if ((e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') continue
      return { signedIn: false, unreadable: true }
    }
    return parseDisplayFields(text)
  }
  return { signedIn: false, missing: true }
}
