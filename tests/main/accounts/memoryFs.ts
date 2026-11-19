// Test helper: in-memory WriteFs. Paths are compared after `\` -> `/`.
// `caseInsensitive` lowercases keys for lookups (use for win32 fixtures).
import type { DirEntry, WriteFs } from '../../../src/main/contracts'

export interface MemoryFs extends WriteFs {
  /** Paths passed to writeFile, rename (destination) and mkdir, in call order. */
  writes: string[]
  /** Every operation in call order, e.g. `write:<p>`, `rename:<a>-><b>`, `mkdir:<p>`. */
  ops: string[]
  /** Every path touched by readFile / readdir / exists / mtimeMs (original spelling). */
  reads: string[]
  /** Set or replace a file without recording a write (bumps mtime unless given). */
  setFile(path: string, content: string, mtime?: number): void
  removeFile(path: string): void
  has(path: string): boolean
  content(path: string): string | undefined
  /** Case-normalised keys of all files. */
  fileKeys(): string[]
}

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })
}

export function createMemoryFs(
  files: Record<string, string>,
  dirs: string[] = [],
  opts: { caseInsensitive?: boolean } = {}
): MemoryFs {
  const ci = opts.caseInsensitive === true
  const fwd = (p: string): string => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  const key = (p: string): string => (ci ? fwd(p).toLowerCase() : fwd(p))

  const fileMap = new Map<string, { name: string; data: string; mtime: number }>()
  const dirMap = new Map<string, string>() // key -> display name (original case, forward slashes)
  let clock = 1000

  const addAncestors = (p: string): void => {
    const parts = fwd(p).split('/')
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (d) dirMap.set(key(d), d)
    }
  }
  const putFile = (p: string, data: string, mtime?: number): void => {
    fileMap.set(key(p), { name: fwd(p), data, mtime: mtime ?? ++clock })
    addAncestors(p)
  }

  for (const [p, d] of Object.entries(files)) putFile(p, d)
  for (const d of dirs) {
    dirMap.set(key(d), fwd(d))
    addAncestors(d)
  }

  const fs: MemoryFs = {
    writes: [],
    ops: [],
    reads: [],
    async readFile(path) {
      fs.reads.push(path)
      const f = fileMap.get(key(path))
      if (!f) throw enoent(path)
      return f.data
    },
    async readdir(path) {
      fs.reads.push(path)
      const base = key(path)
      if (!dirMap.has(base)) throw enoent(path)
      const out = new Map<string, DirEntry>()
      const add = (full: string, isDir: boolean): void => {
        const k = ci ? full.toLowerCase() : full
        if (!k.startsWith(base + '/')) return
        const rest = full.slice(base.length + 1)
        const first = rest.split('/')[0]
        if (!first) return
        const nested = rest.includes('/')
        const dir = isDir || nested
        const existing = out.get(first)
        if (existing && existing.isDirectory()) return
        out.set(first, { name: first, isDirectory: () => dir, isFile: () => !dir })
      }
      for (const f of fileMap.values()) add(f.name, false)
      for (const d of dirMap.values()) add(d, true)
      return [...out.values()]
    },
    async exists(path) {
      fs.reads.push(path)
      return fileMap.has(key(path)) || dirMap.has(key(path))
    },
    async mtimeMs(path) {
      fs.reads.push(path)
      return fileMap.get(key(path))?.mtime ?? null
    },
    async writeFile(path, data) {
      fs.writes.push(path)
      fs.ops.push(`write:${fwd(path)}`)
      putFile(path, data)
    },
    async rename(from, to) {
      const f = fileMap.get(key(from))
      if (!f) throw enoent(from)
      fs.writes.push(to)
      fs.ops.push(`rename:${fwd(from)}->${fwd(to)}`)
      fileMap.delete(key(from))
      putFile(to, f.data, f.mtime)
    },
    async mkdir(path) {
      fs.writes.push(path)
      fs.ops.push(`mkdir:${fwd(path)}`)
      dirMap.set(key(path), fwd(path))
      addAncestors(path)
    },
    setFile(path, content, mtime) {
      putFile(path, content, mtime)
    },
    removeFile(path) {
      fileMap.delete(key(path))
    },
    has(path) {
      return fileMap.has(key(path)) || dirMap.has(key(path))
    },
    content(path) {
      return fileMap.get(key(path))?.data
    },
    fileKeys() {
      return [...fileMap.keys()]
    }
  }
  return fs
}
