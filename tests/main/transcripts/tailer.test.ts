import { describe, expect, it } from 'vitest'
import { createTailer } from '../../../src/main/transcripts/tailer'
import { createMemoryByteFs } from './memoryByteFs'

const P = 'C:/Users/u/.claude/projects/p/s.jsonl'
const enc = new TextEncoder()

async function drain(t: ReturnType<typeof createTailer>, path: string, max = 100) {
  const lines: string[] = []
  let reset = false
  let dropped = 0
  let skipped = 0
  for (let i = 0; i < max; i++) {
    const r = await t.read(path)
    lines.push(...r.lines)
    reset = reset || r.reset
    dropped += r.droppedLines
    skipped = Math.max(skipped, r.skippedBytes)
    if (r.eof) break
  }
  return { lines, reset, dropped, skipped }
}

describe('R-03 tailer basics', () => {
  it('R-03 first read returns all complete lines and sets the offset', async () => {
    const fs = createMemoryByteFs({ [P]: 'one\ntwo\nthree\n' })
    const t = createTailer(fs)
    const r = await t.read(P)
    expect(r).toMatchObject({ lines: ['one', 'two', 'three'], reset: false, skippedBytes: 0, droppedLines: 0, eof: true })
    expect(t.offsetOf(P)).toBe(14)
  })

  it('R-03 offsetOf is undefined for an unknown path', () => {
    expect(createTailer(createMemoryByteFs({})).offsetOf(P)).toBeUndefined()
  })

  it('R-03 a second read with no new data returns nothing', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\n' })
    const t = createTailer(fs)
    await t.read(P)
    expect(await t.read(P)).toMatchObject({ lines: [], reset: false, eof: true })
  })

  it('R-03 appended lines are returned incrementally', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\nb\n' })
    const t = createTailer(fs)
    await t.read(P)
    fs.append(P, 'c\nd\n')
    expect((await t.read(P)).lines).toEqual(['c', 'd'])
  })

  it('R-03 a partial last line is held back and completed on the next read', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\nbb' })
    const t = createTailer(fs)
    expect((await t.read(P)).lines).toEqual(['a'])
    fs.append(P, 'bb\nc')
    expect((await t.read(P)).lines).toEqual(['bbbb'])
    fs.append(P, '\n')
    expect((await t.read(P)).lines).toEqual(['c'])
  })

  it('R-03 handles CRLF endings and skips empty lines', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\r\nb\r\n\r\n\nc\r\n' })
    const t = createTailer(fs)
    expect((await t.read(P)).lines).toEqual(['a', 'b', 'c'])
  })

  it('R-03 a multibyte char split across two reads is not corrupted', async () => {
    const bytes = enc.encode('héllo 日本語 😀\n')
    const cut = enc.encode('héllo 日').length + 1 // in the middle of the 3-byte "日"? (cut inside 本)
    const fs = createMemoryByteFs({ [P]: bytes.slice(0, cut) })
    const t = createTailer(fs)
    expect((await t.read(P)).lines).toEqual([])
    fs.append(P, bytes.slice(cut))
    const r = await t.read(P)
    expect(r.lines).toEqual(['héllo 日本語 😀'])
    expect(r.lines[0]).not.toContain('\uFFFD')
  })

  it('R-03 a line that is not valid UTF-8 does not throw', async () => {
    const fs = createMemoryByteFs({ [P]: new Uint8Array([0x61, 0xff, 0xfe, 0x0a, 0x62, 0x0a]) })
    const r = await createTailer(fs).read(P)
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1]).toBe('b')
  })

  it('R-03 forget drops the state so the next read starts from the beginning', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\nb\n' })
    const t = createTailer(fs)
    await t.read(P)
    t.forget(P)
    expect(t.offsetOf(P)).toBeUndefined()
    expect((await t.read(P)).lines).toEqual(['a', 'b'])
  })

  it('R-03 tracks each path independently', async () => {
    const Q = 'C:/Users/u/.claude/projects/p/other.jsonl'
    const fs = createMemoryByteFs({ [P]: 'a\n', [Q]: 'x\ny\n' })
    const t = createTailer(fs)
    expect((await t.read(P)).lines).toEqual(['a'])
    expect((await t.read(Q)).lines).toEqual(['x', 'y'])
    fs.append(P, 'b\n')
    expect((await t.read(P)).lines).toEqual(['b'])
    expect(t.offsetOf(Q)).toBe(4)
  })
})

describe('R-03 tailer reset (truncate / replace / missing)', () => {
  it('R-03 truncation below the offset resets and re-reads from the start', async () => {
    const fs = createMemoryByteFs({ [P]: 'line1\nline2\nline3\n' })
    const t = createTailer(fs)
    await t.read(P)
    fs.truncate(P, 6) // keeps "line1\n"
    const r = await t.read(P)
    expect(r.reset).toBe(true)
    expect(r.lines).toEqual(['line1'])
  })

  it('R-03 a replaced file (new birthtime) resets even when it is longer than the old offset', async () => {
    const fs = createMemoryByteFs({ [P]: 'old1\n' })
    const t = createTailer(fs)
    await t.read(P)
    fs.replace(P, 'new1\nnew2\nnew3\n')
    const r = await t.read(P)
    expect(r.reset).toBe(true)
    expect(r.lines).toEqual(['new1', 'new2', 'new3'])
  })

  it('R-03 a reset drops a held partial line', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\npartial-without-eol' })
    const t = createTailer(fs)
    await t.read(P)
    fs.replace(P, 'x\n')
    expect((await t.read(P)).lines).toEqual(['x'])
  })

  it('R-03 a missing file returns an empty eof result and forgets the state', async () => {
    const fs = createMemoryByteFs({ [P]: 'a\n' })
    const t = createTailer(fs)
    await t.read(P)
    fs.remove(P)
    const r = await t.read(P)
    expect(r).toMatchObject({ lines: [], reset: false, eof: true })
    expect(t.offsetOf(P)).toBeUndefined()
    fs.set(P, 'fresh\n')
    expect((await t.read(P)).lines).toEqual(['fresh'])
  })

  it('R-03 a file that never existed returns an empty eof result', async () => {
    const r = await createTailer(createMemoryByteFs({})).read(P)
    expect(r).toMatchObject({ lines: [], reset: false, eof: true, droppedLines: 0 })
  })
})

describe('R-03 tailer backfill window', () => {
  it('R-03 when the file is larger than backfillBytes the first read starts near the end, aligned after a newline', async () => {
    const fs = createMemoryByteFs({ [P]: 'line1\nline2\nline3\n' }) // 18 bytes
    const t = createTailer(fs, { backfillBytes: 8 })
    const r = await t.read(P)
    expect(r.lines).toEqual(['line3'])
    expect(r.skippedBytes).toBeGreaterThan(0)
    expect(t.offsetOf(P)).toBe(18)
  })

  it('R-03 a window that starts exactly on a line boundary keeps that line', async () => {
    const fs = createMemoryByteFs({ [P]: 'line1\nline2\nline3\n' }) // line3 starts at byte 12
    const r = await createTailer(fs, { backfillBytes: 6 }).read(P) // window = bytes 12..17
    expect(r.lines).toEqual(['line3'])
    const r2 = await createTailer(fs, { backfillBytes: 12 }).read(P)
    expect(r2.lines).toEqual(['line2', 'line3'])
  })

  it('R-03 files within the window are read whole with skippedBytes 0', async () => {
    const fs = createMemoryByteFs({ [P]: 'line1\nline2\n' })
    const r = await createTailer(fs, { backfillBytes: 1000 }).read(P)
    expect(r.lines).toEqual(['line1', 'line2'])
    expect(r.skippedBytes).toBe(0)
  })

  it('R-03 backfillBytes Infinity reads everything', async () => {
    const body = Array.from({ length: 500 }, (_, i) => `line-${i}`).join('\n') + '\n'
    const fs = createMemoryByteFs({ [P]: body })
    const { lines, skipped } = await drain(createTailer(fs, { backfillBytes: Infinity, chunkBytes: 256 }), P)
    expect(lines).toHaveLength(500)
    expect(skipped).toBe(0)
  })

  it('R-03 later reads after a windowed first read continue from the offset (no re-skip)', async () => {
    const fs = createMemoryByteFs({ [P]: 'line1\nline2\nline3\n' })
    const t = createTailer(fs, { backfillBytes: 8 })
    await t.read(P)
    fs.append(P, 'line4\n')
    const r = await t.read(P)
    expect(r.lines).toEqual(['line4'])
    expect(r.skippedBytes).toBe(0)
  })
})

describe('R-03 tailer chunking', () => {
  it('R-03 one read call reads at most chunkBytes and reports eof=false while more remains', async () => {
    const body = Array.from({ length: 20 }, (_, i) => `row-${String(i).padStart(3, '0')}`).join('\n') + '\n' // 8 bytes per row
    const fs = createMemoryByteFs({ [P]: body })
    const t = createTailer(fs, { chunkBytes: 40 })
    const first = await t.read(P)
    expect(first.eof).toBe(false)
    expect(fs.rangeCalls.every((c) => c.end - c.start <= 40)).toBe(true)
    const rest = await drain(t, P)
    const all = [...first.lines, ...rest.lines]
    expect(all).toHaveLength(20)
    expect(all[0]).toBe('row-000')
    expect(all[19]).toBe('row-019')
    for (const c of fs.rangeCalls) expect(c.end - c.start).toBeLessThanOrEqual(40)
  })

  it('R-03 a line spanning a chunk boundary is delivered whole', async () => {
    const fs = createMemoryByteFs({ [P]: 'x'.repeat(25) + '\nshort\n' })
    const { lines } = await drain(createTailer(fs, { chunkBytes: 10 }), P)
    expect(lines).toEqual(['x'.repeat(25), 'short'])
  })
})

describe('R-03 tailer over-long lines', () => {
  it('R-03 a complete line longer than maxLineBytes is dropped and counted', async () => {
    const fs = createMemoryByteFs({ [P]: 'ok\n' + 'x'.repeat(100) + '\nafter\n' })
    const { lines, dropped } = await drain(createTailer(fs, { maxLineBytes: 20 }), P)
    expect(lines).toEqual(['ok', 'after'])
    expect(dropped).toBe(1)
  })

  it('R-03 an unterminated partial longer than maxLineBytes is dropped, and its tail is skipped up to the end of the line', async () => {
    const fs = createMemoryByteFs({ [P]: 'ok\n' + 'y'.repeat(60) })
    const t = createTailer(fs, { maxLineBytes: 20 })
    const first = await t.read(P)
    expect(first.lines).toEqual(['ok'])
    expect(first.droppedLines).toBe(1)
    fs.append(P, 'zzzz\nnext\n')
    expect((await t.read(P)).lines).toEqual(['next'])
  })
})

describe('R-03 tailer performance (soft)', () => {
  it.skipIf(Boolean(process.env.CI))('R-03 a 20 MB file with the default 16 MiB backfill reads in well under 1.5 s', async () => {
    const line = JSON.stringify({ type: 'user', pad: 'a'.repeat(950) }) + '\n'
    const count = Math.ceil((20 * 1024 * 1024) / line.length)
    const fs = createMemoryByteFs({ [P]: line.repeat(count) })
    const t = createTailer(fs)
    const started = performance.now()
    const { lines, skipped } = await drain(t, P, 50)
    const ms = performance.now() - started
    console.log(`[perf] 20 MB tail took ${ms.toFixed(0)} ms, ${lines.length} lines`)
    expect(skipped).toBeGreaterThan(0)
    expect(lines.length).toBeGreaterThan(10_000)
    expect(ms).toBeLessThan(1500)
  })
})
