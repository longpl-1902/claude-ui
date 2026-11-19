import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addDevConnectSrc, devCspPlugin } from '../scripts/devCsp'

const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; img-src 'self' data:; connect-src 'self'"

function cspOf(html: string): string {
  const m = /<meta[^>]*Content-Security-Policy[^>]*content="([^"]*)"/i.exec(html)
  expect(m).not.toBeNull()
  return m![1]!
}

const indexHtml = readFileSync(resolve(__dirname, '../src/renderer/index.html'), 'utf8')

describe('sanity', () => {
  it('adds numbers', () => {
    expect(1 + 1).toBe(2)
  })

  it('renderer index.html carries exactly the production CSP', () => {
    expect(cspOf(indexHtml)).toBe(PROD_CSP)
    expect(indexHtml).not.toContain('localhost')
    expect(indexHtml).not.toContain('https:')
    expect(indexHtml).not.toContain('http://')
    expect(indexHtml).not.toContain('fonts.googleapis')
  })
})

describe('dev CSP plugin', () => {
  it('only applies while serving (dev), never to build', () => {
    expect(devCspPlugin().apply).toBe('serve')
  })

  it('appends localhost dev-server sources to connect-src only', () => {
    const dev = cspOf(addDevConnectSrc(indexHtml))
    expect(dev).toBe(
      PROD_CSP.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*")
    )
  })

  it('leaves the rest of the document untouched', () => {
    const out = addDevConnectSrc(indexHtml)
    expect(out.replace(' ws://localhost:* http://localhost:*', '')).toBe(indexHtml)
  })

  it('wires the transform through transformIndexHtml', () => {
    const hook = devCspPlugin().transformIndexHtml
    expect(typeof hook).toBe('function')
    const out = (hook as (html: string) => string)(indexHtml)
    expect(cspOf(out)).toContain('ws://localhost:*')
  })

  it('throws when there is no CSP meta', () => {
    expect(() => addDevConnectSrc('<html></html>')).toThrow()
  })
})
