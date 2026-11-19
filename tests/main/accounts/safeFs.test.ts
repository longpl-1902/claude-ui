import { describe, expect, it, vi } from 'vitest'
import { createSafeFs, CredentialAccessError, DENIED_BASENAMES, isDeniedPath } from '../../../src/main/accounts/safeFs'
import type { WriteFs } from '../../../src/main/contracts'

// The denied name is assembled here so this test file never needs to be exempt from the src/ grep.
const DENIED = ['.credentials', 'json'].join('.')

function spyFs(): { inner: WriteFs; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn()
  const inner: WriteFs = {
    readFile: async (p) => (calls('readFile', p), 'x'),
    readdir: async (p) => (calls('readdir', p), []),
    exists: async (p) => (calls('exists', p), true),
    mtimeMs: async (p) => (calls('mtimeMs', p), 1),
    writeFile: async (p) => void calls('writeFile', p),
    rename: async (a, b) => void calls('rename', a, b),
    mkdir: async (p) => void calls('mkdir', p)
  }
  return { inner, calls }
}

describe('R-05 safeFs credential guard', () => {
  it('R-05 DENIED_BASENAMES holds the credentials file name', () => {
    expect(DENIED_BASENAMES).toContain(DENIED)
  })

  it('R-05 isDeniedPath checks the basename on both separators, case-insensitively', () => {
    expect(isDeniedPath(`C:/Users/u/.claude/${DENIED}`)).toBe(true)
    expect(isDeniedPath(`C:\\Users\\u\\.claude\\${DENIED.toUpperCase()}`)).toBe(true)
    expect(isDeniedPath(DENIED)).toBe(true)
    expect(isDeniedPath('C:/Users/u/.claude/.claude.json')).toBe(false)
    expect(isDeniedPath(`C:/Users/u/${DENIED}/other.txt`)).toBe(false)
  })

  it.each([`X/${DENIED}`, `X\\${DENIED.toUpperCase()}`, `C:\\a\\b\\${DENIED}`])(
    'R-05 every method rejects %s with CredentialAccessError and never reaches the inner fs',
    async (p) => {
      const { inner, calls } = spyFs()
      const fs = createSafeFs(inner)
      await expect(fs.readFile(p)).rejects.toBeInstanceOf(CredentialAccessError)
      await expect(fs.exists(p)).rejects.toBeInstanceOf(CredentialAccessError)
      await expect(fs.mtimeMs(p)).rejects.toBeInstanceOf(CredentialAccessError)
      await expect(fs.writeFile(p, 'x')).rejects.toBeInstanceOf(CredentialAccessError)
      await expect(fs.mkdir(p)).rejects.toBeInstanceOf(CredentialAccessError)
      await expect(fs.rename(p, 'Y/z')).rejects.toBeInstanceOf(CredentialAccessError)
      await expect(fs.rename('Y/z', p)).rejects.toBeInstanceOf(CredentialAccessError)
      expect(calls).not.toHaveBeenCalled()
    }
  )

  it('R-05 allows ordinary paths and readdir of a directory', async () => {
    const { inner, calls } = spyFs()
    const fs = createSafeFs(inner)
    await expect(fs.readFile('C:/Users/u/.claude.json')).resolves.toBe('x')
    await expect(fs.readdir('C:/Users/u/.claude')).resolves.toEqual([])
    expect(calls).toHaveBeenCalledWith('readFile', 'C:/Users/u/.claude.json')
    expect(calls).toHaveBeenCalledWith('readdir', 'C:/Users/u/.claude')
  })
})
