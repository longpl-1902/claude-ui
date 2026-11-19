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
const GOOD_HOOK = "'use strict'\nconst http = require('node:http')\nprocess.exit(0)\n"
function hookFile(code: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-hook-'))
  dirs.push(dir)
  const p = join(dir, 'agent-console-hook.cjs')
  if (code !== null) writeFileSync(p, code)
  return p
}
function run(dir: string, hook: string = hookFile(GOOD_HOOK)) {
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8', env: { ...process.env, HOOK_SCRIPT: hook } })
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

  const ok = (): string => fixture(PROD_HTML, { 'index.js': REACT })

  it('fails when the hook script is missing', () => {
    const r = run(ok(), hookFile(null))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('hook script missing')
  })

  it('fails when the hook script is not CommonJS', () => {
    const r = run(ok(), hookFile("import http from 'node:http'\nprocess.exit(0)\n"))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('not CommonJS')
  })

  it('fails when the hook script prints or writes files', () => {
    const r = run(ok(), hookFile(GOOD_HOOK + "console.log('x')\nrequire('fs').writeFileSync('a','b')\n"))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('console.')
    expect(r.stderr).toContain('writeFile')
  })

  it('passes the real shipped hook script', () => {
    const r = spawnSync(process.execPath, [script, fixture(PROD_HTML, { 'index.js': REACT })], {
      encoding: 'utf8',
      cwd: resolve(__dirname, '..')
    })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it('works from a narrow-width (small viewport) build: the check is layout independent', () => {
    // Responsive addendum: this task has no UI; the CSP meta check must hold for the narrow-viewport build too.
    const html = PROD_HTML + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    expect(run(fixture(html, { 'index.js': REACT })).status).toBe(0)
  })
})
