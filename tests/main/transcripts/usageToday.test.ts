import { describe, expect, it } from 'vitest'
import { createUsageCounter } from '../../../src/main/transcripts/usageToday'
import { assistantBlocks, at, jsonl, textBlock, usage, userPrompt } from '../../fixtures/transcripts/builders'
import { NOW_MS, buildTranscriptTree, utcDay } from '../../fixtures/transcripts/trees'
import { createMemoryByteFs } from './memoryByteFs'

// Signature assumptions (T06 Notes): createUsageCounter({fs, nowMs, localDay}); addFile(path, accountId);
// pump(): Promise<boolean> (true while work remains); today(): {day, byAccount: Record<string, TokenTotals>}; forgetAccount(id).
const TODAY = '2026-11-18'
const ZERO = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }

function make(files: Record<string, string> = {}, now = { ms: NOW_MS }) {
  const fs = createMemoryByteFs(files)
  const counter = createUsageCounter({ fs, nowMs: () => now.ms, localDay: utcDay })
  const drain = async (max = 1000) => {
    let n = 0
    while ((await counter.pump()) && n++ < max);
    return n
  }
  return { fs, counter, drain, now }
}
const msgLine = (id: string, u: [number, number, number?, number?], sec: number, extra: Record<string, unknown> = {}) =>
  assistantBlocks([textBlock('x')], { ts: at(sec), messageId: id, stopReason: 'end_turn', usage: usage(u[0], u[1], u[2] ?? 0, u[3] ?? 0), ...extra })

describe('R-09 usage today from the synthetic tree', () => {
  it('R-09 sums the deduped usage of a session, its sub-agents and a fork copy for one account', async () => {
    const tree = buildTranscriptTree()
    const { counter, drain } = make(tree.files)
    for (const p of [tree.paths.s1, tree.paths.sub1, tree.paths.nested, tree.paths.team, tree.paths.nometa, tree.paths.orphan, tree.paths.s2]) counter.addFile(p, 'acme')
    await drain()
    const t = counter.today()
    expect(t.day).toBe(TODAY)
    expect(t.byAccount.acme).toEqual(tree.expect.acmeTotals)
  })

  it('R-09 cacheRead is tracked separately from the headline inputs', async () => {
    const tree = buildTranscriptTree()
    const { counter, drain } = make(tree.files)
    counter.addFile(tree.paths.s1, 'acme')
    await drain()
    const t = counter.today().byAccount.acme!
    expect(t.cacheRead).toBe(11_000) // 5000 + 6000 from msg_L1 and msg_L2
    expect(t.cacheCreation).toBe(1000)
  })

  it('R-09 only today counts; yesterday lines, synthetic API errors, malformed and multibyte lines are handled; CRLF files are read', async () => {
    const tree = buildTranscriptTree()
    const { counter, drain } = make(tree.files)
    counter.addFile(tree.paths.s3, '')
    counter.addFile(tree.paths.s4, '')
    await drain()
    // msg_Y1 (1000/1000) is yesterday and excluded; msg_D1 is split over 2 lines but counted once; msg_C1 comes from a CRLF file.
    expect(counter.today().byAccount['']).toEqual(tree.expect.defaultTodayTotals)
  })

  it('R-09 accounts are kept apart', async () => {
    const tree = buildTranscriptTree()
    const { counter, drain } = make(tree.files)
    counter.addFile(tree.paths.s1, 'acme')
    counter.addFile(tree.paths.s4, '')
    await drain()
    const by = counter.today().byAccount
    expect(Object.keys(by).sort()).toEqual(['', 'acme'])
    expect(by['']).toEqual({ input: 3, output: 4, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 the same file added twice is not double counted', async () => {
    const tree = buildTranscriptTree()
    const { counter, drain } = make(tree.files)
    counter.addFile(tree.paths.s4, '')
    counter.addFile(tree.paths.s4, '')
    await drain()
    counter.addFile(tree.paths.s4, '')
    await drain()
    expect(counter.today().byAccount['']).toEqual({ input: 3, output: 4, cacheCreation: 0, cacheRead: 0 })
  })
})

describe('R-09 dedupe and edge cases', () => {
  it('R-09 two lines with one message id (one per content block) count once', async () => {
    const lines = assistantBlocks([textBlock('a'), textBlock('b')], { ts: at(1), messageId: 'msg_1', stopReason: 'end_turn', usage: usage(10, 5) })
    const { counter, drain } = make({ 'C:/x/a.jsonl': jsonl(lines) })
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc).toEqual({ input: 10, output: 5, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 the same message id in two files (a fork copy) counts once', async () => {
    const { counter, drain } = make({ 'C:/x/a.jsonl': jsonl(msgLine('msg_f', [7, 3], 1)), 'C:/x/b.jsonl': jsonl(msgLine('msg_f', [7, 3], 1)) })
    counter.addFile('C:/x/a.jsonl', 'acc')
    counter.addFile('C:/x/b.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc).toEqual({ input: 7, output: 3, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 the same message id under two accounts counts once per account', async () => {
    const { counter, drain } = make({ 'C:/x/a.jsonl': jsonl(msgLine('msg_f', [7, 3], 1)), 'C:/y/b.jsonl': jsonl(msgLine('msg_f', [7, 3], 1)) })
    counter.addFile('C:/x/a.jsonl', 'one')
    counter.addFile('C:/y/b.jsonl', 'two')
    await drain()
    expect(counter.today().byAccount.one!.input).toBe(7)
    expect(counter.today().byAccount.two!.input).toBe(7)
  })

  it('R-09 <synthetic> / API error lines add nothing', async () => {
    const { apiErrorLine } = await import('../../fixtures/transcripts/builders')
    const { counter, drain } = make({ 'C:/x/a.jsonl': jsonl([apiErrorLine('rate_limit', { ts: at(1) }), userPrompt('hi', { ts: at(2) })]) })
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc ?? ZERO).toEqual(ZERO)
  })

  it('R-09 a missing file is harmless', async () => {
    const { counter, drain } = make()
    counter.addFile('C:/x/missing.jsonl', 'acc')
    await expect(drain()).resolves.toBeGreaterThanOrEqual(0)
    expect(counter.today().byAccount.acc ?? ZERO).toEqual(ZERO)
  })

  it('R-09 appended lines are added incrementally (earlier lines are not re-counted)', async () => {
    const { counter, drain, fs } = make({ 'C:/x/a.jsonl': jsonl(msgLine('msg_1', [10, 10], 1)) })
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    fs.append('C:/x/a.jsonl', jsonl(msgLine('msg_2', [5, 5], 2)))
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc).toEqual({ input: 15, output: 15, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 reads the whole file (no 16 MiB backfill window): an early line in a large file still counts', async () => {
    const pad = ('{"type":"user","pad":"' + 'p'.repeat(1000) + '"}\n').repeat(20_000) // ~20 MB, larger than the 16 MiB tail window
    const first = jsonl(msgLine('msg_first', [42, 1], 1))
    const { counter, drain } = make({ 'C:/x/a.jsonl': first + pad })
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc!.input).toBe(42)
  })
})

describe('R-09 truncate / replace resets without double counting', () => {
  const A = jsonl(msgLine('msg_A', [10, 10], 1))
  const B = jsonl(msgLine('msg_B', [20, 20], 2))

  it('R-09 truncating a file drops ids that only it held and keeps the rest', async () => {
    const { counter, drain, fs } = make({ 'C:/x/a.jsonl': A + B })
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc!.input).toBe(30)
    fs.truncate('C:/x/a.jsonl', A.length)
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc).toEqual({ input: 10, output: 10, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 an id also present in another file survives a reset of the first file', async () => {
    const { counter, drain, fs } = make({ 'C:/x/a.jsonl': A + B, 'C:/x/b.jsonl': B })
    counter.addFile('C:/x/a.jsonl', 'acc')
    counter.addFile('C:/x/b.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc!.input).toBe(30)
    fs.truncate('C:/x/a.jsonl', A.length)
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc!.input).toBe(30) // A (a.jsonl) + B (still in b.jsonl)
  })

  it('R-09 a replaced file (new birthtime) is re-read from the start without double counting', async () => {
    const { counter, drain, fs } = make({ 'C:/x/a.jsonl': A })
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    fs.replace('C:/x/a.jsonl', A + B)
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc!.input).toBe(30)
  })
})

describe('R-09 pump is incremental', () => {
  it('R-09 a large file is processed chunk by chunk (each range at most 4 MiB), returning true while work remains', async () => {
    const lines: unknown[] = []
    for (let i = 0; i < 9500; i++) lines.push(...assistantBlocks([textBlock('t'.repeat(900))], { ts: at(i % 3000), messageId: `msg_big_${i}`, stopReason: 'end_turn', usage: usage(1, 1) }))
    const { counter, fs } = make({ 'C:/x/big.jsonl': jsonl(lines) })
    counter.addFile('C:/x/big.jsonl', 'acc')
    let pumps = 0
    while (await counter.pump()) pumps++
    expect(pumps).toBeGreaterThanOrEqual(2) // > 8 MiB of lines => at least 3 chunks => at least 2 `true` results
    for (const c of fs.rangeCalls) expect(c.end - c.start).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(counter.today().byAccount.acc).toEqual({ input: 9500, output: 9500, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 pump with nothing queued returns false', async () => {
    expect(await make().counter.pump()).toBe(false)
  })

  it('R-09 several queued files are all processed', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 5; i++) files[`C:/x/f${i}.jsonl`] = jsonl(msgLine(`msg_${i}`, [1, 1], i))
    const { counter, drain } = make(files)
    for (const p of Object.keys(files)) counter.addFile(p, 'acc')
    await drain()
    expect(counter.today().byAccount.acc!.input).toBe(5)
  })
})

describe('R-09 day rollover and forgetAccount', () => {
  it('R-09 after local midnight today() reports the new day and clears the old totals', async () => {
    const now = { ms: NOW_MS }
    const { counter, drain, fs } = make({ 'C:/x/a.jsonl': jsonl(msgLine('msg_1', [10, 10], 1)) }, now)
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().day).toBe(TODAY)
    now.ms = NOW_MS + 24 * 3_600_000
    const next = counter.today()
    expect(next.day).toBe('2026-11-19')
    expect(next.byAccount.acc ?? ZERO).toEqual(ZERO)
    // a new line stamped on the new day is counted; the old-day line stays out
    fs.append('C:/x/a.jsonl', jsonl(msgLine('msg_2', [3, 3], 24 * 3600 + 5)))
    counter.addFile('C:/x/a.jsonl', 'acc')
    await drain()
    expect(counter.today().byAccount.acc).toEqual({ input: 3, output: 3, cacheCreation: 0, cacheRead: 0 })
  })

  it('R-09 forgetAccount removes that account only', async () => {
    const { counter, drain } = make({ 'C:/x/a.jsonl': jsonl(msgLine('msg_1', [1, 1], 1)), 'C:/y/b.jsonl': jsonl(msgLine('msg_2', [2, 2], 2)) })
    counter.addFile('C:/x/a.jsonl', 'one')
    counter.addFile('C:/y/b.jsonl', 'two')
    await drain()
    counter.forgetAccount('one')
    expect(counter.today().byAccount.one ?? ZERO).toEqual(ZERO)
    expect(counter.today().byAccount.two!.input).toBe(2)
  })
})
