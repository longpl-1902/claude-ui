import type { ByteReadFs } from './transcriptFs'

export interface TailOptions {
  backfillBytes?: number
  chunkBytes?: number
  maxLineBytes?: number
}
export interface TailRead {
  lines: string[]
  reset: boolean
  skippedBytes: number
  droppedLines: number
  eof: boolean
}
export interface Tailer {
  read(path: string): Promise<TailRead>
  offsetOf(path: string): number | undefined
  forget(path: string): void
}

interface State {
  offset: number
  birthtimeMs: number
  partial: Uint8Array
  /** discard bytes up to and including the next newline */
  discarding: boolean
}

const EMPTY = new Uint8Array(0)
const MiB = 1024 * 1024

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export function createTailer(fs: ByteReadFs, opts: TailOptions = {}): Tailer {
  const backfill = opts.backfillBytes ?? 16 * MiB
  const chunkBytes = opts.chunkBytes ?? 4 * MiB
  const maxLine = opts.maxLineBytes ?? 8 * MiB
  const states = new Map<string, State>()
  const decoder = new TextDecoder('utf-8', { fatal: false })

  async function read(path: string): Promise<TailRead> {
    const st = await fs.stat(path)
    if (!st) {
      states.delete(path)
      return { lines: [], reset: false, skippedBytes: 0, droppedLines: 0, eof: true }
    }
    let state = states.get(path)
    let reset = false
    let skippedBytes = 0
    if (state && (st.size < state.offset || st.birthtimeMs !== state.birthtimeMs)) {
      reset = true
      state = undefined
    }
    if (!state) {
      const start = st.size > backfill ? st.size - backfill : 0
      state = { offset: start, birthtimeMs: st.birthtimeMs, partial: EMPTY, discarding: start > 0 }
      skippedBytes = start
      states.set(path, state)
    }
    const end = Math.min(st.size, state.offset + chunkBytes)
    const chunk = end > state.offset ? await fs.readRange(path, state.offset, end) : EMPTY
    state.offset += chunk.length
    const lines: string[] = []
    let dropped = 0
    let pos = 0
    while (pos < chunk.length) {
      const nl = chunk.indexOf(0x0a, pos)
      if (nl === -1) {
        if (!state.discarding) {
          const rest = chunk.subarray(pos)
          if (state.partial.length + rest.length > maxLine) {
            dropped++
            state.partial = EMPTY
            state.discarding = true
          } else {
            state.partial = concat(state.partial, rest)
          }
        }
        break
      }
      if (state.discarding) {
        state.discarding = false
      } else {
        let seg = chunk.subarray(pos, nl)
        if (state.partial.length > 0) {
          seg = concat(state.partial, seg)
          state.partial = EMPTY
        }
        if (seg.length > maxLine) {
          dropped++
        } else {
          if (seg.length > 0 && seg[seg.length - 1] === 0x0d) seg = seg.subarray(0, seg.length - 1)
          if (seg.length > 0) lines.push(decoder.decode(seg))
        }
      }
      pos = nl + 1
    }
    return { lines, reset, skippedBytes, droppedLines: dropped, eof: state.offset >= st.size }
  }

  return {
    read,
    offsetOf: (p) => states.get(p)?.offset,
    forget: (p) => void states.delete(p)
  }
}
