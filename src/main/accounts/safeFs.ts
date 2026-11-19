import { access, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { WriteFs } from '../contracts'

/** The ONLY place in src/ that is allowed to spell the credentials file name. */
export const DENIED_BASENAMES = ['.credentials.json'] as const

export class CredentialAccessError extends Error {
  constructor(message = 'Access to credential files is not allowed') {
    super(message)
    this.name = 'CredentialAccessError'
  }
}

export function isDeniedPath(p: string): boolean {
  const base = (p.split(/[\\/]/).pop() ?? '').toLowerCase()
  return (DENIED_BASENAMES as readonly string[]).includes(base)
}

function guard(...paths: string[]): void {
  for (const p of paths) if (isDeniedPath(p)) throw new CredentialAccessError()
}

export function createSafeFs(inner: WriteFs): WriteFs {
  return {
    async readFile(p) {
      guard(p)
      return inner.readFile(p)
    },
    async readdir(p) {
      guard(p)
      return inner.readdir(p)
    },
    async exists(p) {
      guard(p)
      return inner.exists(p)
    },
    async mtimeMs(p) {
      guard(p)
      return inner.mtimeMs(p)
    },
    async writeFile(p, data) {
      guard(p)
      return inner.writeFile(p, data)
    },
    async rename(from, to) {
      guard(from, to)
      return inner.rename(from, to)
    },
    async mkdir(p) {
      guard(p)
      return inner.mkdir(p)
    }
  }
}

export const nodeFs: WriteFs = {
  readFile: (p) => readFile(p, 'utf8'),
  readdir: (p) => readdir(p, { withFileTypes: true }),
  async exists(p) {
    try {
      await access(p)
      return true
    } catch {
      return false
    }
  },
  async mtimeMs(p) {
    try {
      return (await stat(p)).mtimeMs
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  },
  writeFile: (p, data) => writeFile(p, data, 'utf8'),
  rename: (a, b) => rename(a, b),
  async mkdir(p) {
    await mkdir(p, { recursive: true })
  }
}

export const safeNodeFs: WriteFs = createSafeFs(nodeFs)
