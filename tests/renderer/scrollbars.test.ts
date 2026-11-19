import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../../src/renderer/src/styles/global.css'), 'utf8')

describe('themed scrollbars (user feedback)', () => {
  it('declares a dark color-scheme so native widgets follow the theme', () => {
    expect(css).toMatch(/color-scheme:\s*dark/)
  })
  it('styles thin scrollbars with a transparent track and rounded thumb', () => {
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*8px/)
    expect(css).toMatch(/::-webkit-scrollbar-track[^{]*\{[^}]*background:\s*transparent/)
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius/)
  })
  it('hides the arrow buttons', () => {
    expect(css).toMatch(/::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/)
  })
})
