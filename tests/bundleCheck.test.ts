// Covers scripts/check-bundle.mjs, which `npm run build` runs on out/renderer.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve(__dirname, '../scripts/check-bundle.mjs')
const PROD_HTML =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\'" />'
const REACT = 'exports.Suspense = w;\nexports.StrictMode = q;\n'
const REACT_DOM = 'var ua = aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;\n'

const dirs: string[] = []
function fixture(html: string, assets: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-bundle-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'index.html'), html)
  mkdirSync(join(dir, 'assets'))
  for (const [name, code] of Object.entries(assets)) writeFileSync(join(dir, 'assets', name), code)
  return dir
}
function run(dir: string) {
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('check-bundle', () => {
  it('passes with one React copy and the production CSP', () => {
    const r = run(fixture(PROD_HTML, { 'index.js': REACT + REACT_DOM, 'xterm.js': 'x' }))
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it('fails when React is bundled twice (unminified or minified)', () => {
    const r = run(fixture(PROD_HTML, { 'index.js': REACT + REACT_DOM + 'e.Suspense=w;' }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('found 2')
  })

  it('fails when React copies are split across chunks', () => {
    const r = run(fixture(PROD_HTML, { 'a.js': REACT, 'b.js': REACT }))
    expect(r.status).toBe(1)
  })

  it('fails when the built CSP allows localhost', () => {
    const html = PROD_HTML.replace("connect-src 'self'", "connect-src 'self' ws://localhost:*")
    const r = run(fixture(html, { 'index.js': REACT }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('connect-src')
  })
})
