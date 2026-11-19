// Test helper: in-memory ByteReadFs (plus mutation helpers) that records every read attempt.
// Paths are compared after `\` -> `/`; `caseInsensitive` lowercases keys (use for win32 fixtures).
// The interface has NO write methods on purpose: `writes` stays empty and exists so tests can assert it.
// Pass this object RAW (not wrapped by createTranscriptFs) to a module when you want to see whether the
// module itself ever asks for a forbidden path: forbidden attempts are still recorded in `reads`.
import type { DirEntry } from '../../../src/main/contracts'
import type { ByteReadFs, FileStat } from '../../../src/main/transcripts/transcriptFs'

export interface RangeCall {
  path: string
  start: number
  end: number
}

export interface MemoryByteFs extends ByteReadFs {
  /** Paths passed to stat / readRange / readText, in call order (original spelling). */
  reads: string[]
  /** Paths passed to readdir. */
  readdirs: string[]
  /** Every readRange call. */
  rangeCalls: RangeCall[]
  /** Always empty: there is no write API. */
  writes: string[]
  /** Set or replace a file without a new birthtime (mtime bumps unless given). */
  set(path: string, content: string | Uint8Array, opts?: { mtimeMs?: number }): void
  /** Append bytes (mtime bumps, birthtime unchanged). */
  append(path: string, content: string | Uint8Array): void
  /** Cut to `size` bytes (mtime bumps, birthtime unchanged). */
  truncate(path: string, size: number): void
  /** Replace the file with new content AND a new birthtime (log rotation / re-create). */
  replace(path: string, content: string | Uint8Array): void
  remove(path: string): void
  setMtime(path: string, mtimeMs: number): void
  has(path: string): boolean
  bytes(path: string): Uint8Array | undefined
  text(path: string): string | undefined
  /** Paths (original spelling, forward slashes) of all files. */
  paths(): string[]
  /** Forget recorded reads. */
  clearLog(): void
}

const enc = new TextEncoder()
const toBytes = (c: string | Uint8Array): Uint8Array => (typeof c === 'string' ? enc.encode(c) : Uint8Array.from(c))

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })
}

export function createMemoryByteFs(
  files: Record<string, string | Uint8Array> = {},
  opts: { caseInsensitive?: boolean; mtimes?: Record<string, number> } = {}
): MemoryByteFs {
  const ci = opts.caseInsensitive === true
  const fwd = (p: string): string => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  const key = (p: string): string => (ci ? fwd(p).toLowerCase() : fwd(p))
  interface F {
    name: string
    data: Uint8Array
    mtime: number
    birth: number
  }
  const map = new Map<string, F>()
  let clock = 1_000_000
  const tick = (): number => (clock += 1000)

  const put = (p: string, data: Uint8Array, mtime?: number, birth?: number): void => {
    const prev = map.get(key(p))
    map.set(key(p), { name: fwd(p), data, mtime: mtime ?? tick(), birth: birth ?? prev?.birth ?? tick() })
  }
  for (const [p, c] of Object.entries(files)) put(p, toBytes(c), opts.mtimes?.[p])

  const fs: MemoryByteFs = {
    reads: [],
    readdirs: [],
    rangeCalls: [],
    writes: [],
    async stat(path): Promise<FileStat | null> {
      fs.reads.push(path)
      const f = map.get(key(path))
      if (!f) return null
      return { size: f.data.length, mtimeMs: f.mtime, birthtimeMs: f.birth, isFile: true }
    },
    async readRange(path, start, end) {
      fs.reads.push(path)
      fs.rangeCalls.push({ path, start, end })
      const f = map.get(key(path))
      if (!f) throw enoent(path)
      const e = Math.min(end, f.data.length)
      if (start >= e) return new Uint8Array(0)
      return f.data.slice(Math.max(0, start), e)
    },
    async readdir(path): Promise<DirEntry[]> {
      fs.readdirs.push(path)
      const base = key(path)
      const out = new Map<string, DirEntry>()
      let found = false
      for (const f of map.values()) {
        const k = ci ? f.name.toLowerCase() : f.name
        if (!k.startsWith(base + '/')) continue
        found = true
        const rest = f.name.slice(base.length + 1)
        const first = rest.split('/')[0]!
        const nested = rest.includes('/')
        const existing = out.get(first)
        if (existing && existing.isDirectory()) continue
        out.set(first, { name: first, isDirectory: () => nested, isFile: () => !nested })
      }
      if (!found) throw enoent(path)
      return [...out.values()]
    },
    async readText(path) {
      fs.reads.push(path)
      const f = map.get(key(path))
      if (!f) throw enoent(path)
      return new TextDecoder().decode(f.data)
    },
    set(path, content, o) {
      put(path, toBytes(content), o?.mtimeMs)
    },
    append(path, content) {
      const f = map.get(key(path))
      const add = toBytes(content)
      const next = new Uint8Array((f?.data.length ?? 0) + add.length)
      if (f) next.set(f.data, 0)
      next.set(add, f?.data.length ?? 0)
      put(path, next)
    },
    truncate(path, size) {
      const f = map.get(key(path))
      if (!f) throw enoent(path)
      put(path, f.data.slice(0, size))
    },
    replace(path, content) {
      map.delete(key(path))
      put(path, toBytes(content))
    },
    remove(path) {
      map.delete(key(path))
    },
    setMtime(path, mtimeMs) {
      const f = map.get(key(path))
      if (f) f.mtime = mtimeMs
    },
    has: (path) => map.has(key(path)),
    bytes: (path) => map.get(key(path))?.data,
    text: (path) => {
      const f = map.get(key(path))
      return f ? new TextDecoder().decode(f.data) : undefined
    },
    paths: () => [...map.values()].map((f) => f.name),
    clearLog() {
      fs.reads.length = 0
      fs.readdirs.length = 0
      fs.rangeCalls.length = 0
    }
  }
  return fs
}
