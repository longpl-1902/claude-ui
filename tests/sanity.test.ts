import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('sanity', () => {
  it('adds numbers', () => {
    expect(1 + 1).toBe(2)
  })

  it('renderer index.html has a local-only CSP', () => {
    const html = readFileSync(resolve(__dirname, '../src/renderer/index.html'), 'utf8')
    const m = /<meta[^>]*Content-Security-Policy[^>]*content="([^"]*)"/i.exec(html)
    expect(m).not.toBeNull()
    const csp = m![1]!
    expect(csp).not.toContain('https:')
    expect(csp.replace(/http:\/\/localhost/g, '')).not.toContain('http://')
    expect(html).not.toContain('fonts.googleapis')
  })
})
