import { open, readdir, readFile, stat } from 'node:fs/promises'
import type { DirEntry } from '../contracts'
import { isDeniedPath } from '../accounts/safeFs'

export interface FileStat {
  size: number
  mtimeMs: number
  birthtimeMs: number
  isFile: boolean
}

/** Read-only byte access. There are intentionally no write methods. */
export interface ByteReadFs {
  /** null on ENOENT */
  stat(path: string): Promise<FileStat | null>
  /** [start, end) */
  readRange(path: string, start: number, end: number): Promise<Uint8Array>
  readdir(path: string): Promise<DirEntry[]>
  /** utf8, small files (meta/registry) */
  readText(path: string): Promise<string>
}

export class TranscriptAccessError extends Error {
  constructor(message = 'Access to this path is not allowed') {
    super(message)
    this.name = 'TranscriptAccessError'
  }
}

export function isTranscriptReadable(path: string): boolean {
  if (isDeniedPath(path)) return false
  const parts = path.split(/[\\/]/)
  const base = (parts.pop() ?? '').toLowerCase()
  if (base.endsWith('.key')) return false
  if (base.endsWith('.jsonl') || base.endsWith('.meta.json')) return true
  if (/^\d+\.json$/.test(base)) {
    const parent = (parts.pop() ?? '').toLowerCase()
    return parent === 'sessions'
  }
  return false
}

export function createTranscriptFs(inner: ByteReadFs): ByteReadFs {
  const guard = (p: string): void => {
    if (!isTranscriptReadable(p)) throw new TranscriptAccessError()
  }
  return {
    async stat(p) {
      guard(p)
      return inner.stat(p)
    },
    async readRange(p, start, end) {
      guard(p)
      return inner.readRange(p, start, end)
    },
    async readdir(p) {
      return inner.readdir(p)
    },
    async readText(p) {
      guard(p)
      return inner.readText(p)
    }
  }
}

export const nodeByteFs: ByteReadFs = {
  async stat(p) {
    try {
      const s = await stat(p)
      return { size: s.size, mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs, isFile: s.isFile() }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  },
  async readRange(p, start, end) {
    const fh = await open(p, 'r')
    try {
      const { size } = await fh.stat()
      const e = Math.min(end, size)
      const s = Math.max(0, start)
      if (s >= e) return new Uint8Array(0)
      const buf = Buffer.alloc(e - s)
      let got = 0
      while (got < buf.length) {
        const { bytesRead } = await fh.read(buf, got, buf.length - got, s + got)
        if (bytesRead === 0) break
        got += bytesRead
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got)
    } finally {
      await fh.close()
    }
  },
  readdir: (p) => readdir(p, { withFileTypes: true }),
  readText: (p) => readFile(p, 'utf8')
}

export const transcriptNodeFs: ByteReadFs = createTranscriptFs(nodeByteFs)
