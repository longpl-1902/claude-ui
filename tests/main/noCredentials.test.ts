import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'src')
const SAFE_FS = 'src/main/accounts/safeFs.ts'
// Built from parts so this test does not itself spell the name in a way a looser grep could trip on.
const NAME = ['.credentials', 'json'].join('.')
const BARE = ['credentials', 'json'].join('.')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs|cjs|json|css|html|md)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(SRC).map((f) => ({ rel: relative(process.cwd(), f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }))

describe('R-05 credential file is spelled in exactly one place', () => {
  it('R-05 src/ is non-empty and safeFs.ts exists and names the denied file', () => {
    expect(files.length).toBeGreaterThan(5)
    const safe = files.find((f) => f.rel === SAFE_FS)
    expect(safe, `${SAFE_FS} must exist`).toBeDefined()
    expect(safe!.text).toContain(NAME)
  })

  it('R-05 no other file under src/ names the credentials file', () => {
    const offenders = files.filter((f) => f.rel !== SAFE_FS && (f.text.includes(NAME) || f.text.includes(BARE))).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('R-05 no file under src/ touches the keychain or macOS security tool', () => {
    const offenders = files
      .filter((f) => /keychain|security find-generic-password/i.test(f.text))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})
