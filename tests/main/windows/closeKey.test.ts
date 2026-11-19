import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isCloseAccelerator } from '../../../src/main/windows/closeKey'

describe('isCloseAccelerator', () => {
  it('matches Ctrl/Cmd+W keyDown only', () => {
    expect(isCloseAccelerator({ type: 'keyDown', key: 'w', control: true })).toBe(true)
    expect(isCloseAccelerator({ type: 'keyDown', key: 'W', control: true })).toBe(true)
    expect(isCloseAccelerator({ type: 'keyDown', key: 'w', meta: true })).toBe(true)
    expect(isCloseAccelerator({ type: 'keyUp', key: 'w', control: true })).toBe(false)
    expect(isCloseAccelerator({ type: 'keyDown', key: 'w' })).toBe(false)
    expect(isCloseAccelerator({ type: 'keyDown', key: 'w', control: true, shift: true })).toBe(false)
    expect(isCloseAccelerator({ type: 'keyDown', key: 'w', control: true, alt: true })).toBe(false)
    expect(isCloseAccelerator({ type: 'keyDown', key: 'q', control: true })).toBe(false)
  })

  it('index.ts wires it for the main window only', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/main/index.ts'), 'utf8').replace(/\r\n/g, '\n')
    expect(src).toMatch(/if \(spec\.kind === 'main'\) \{\n\s+win\.webContents\.on\('before-input-event', \(event, input\) => \{\n\s+if \(isCloseAccelerator\(input\)\) event\.preventDefault\(\)/)
  })
})
