import type { TokenTotals, UsageToday } from '../../shared/types'
import { parseLine } from './parseLine'
import { createTailer } from './tailer'
import type { ByteReadFs } from './transcriptFs'

export interface UsageCounterDeps {
  fs: ByteReadFs
  nowMs(): number
  /** local YYYY-MM-DD */
  localDay(ms: number): string
}
export interface UsageCounter {
  /** queue a file for an initial or incremental read */
  addFile(path: string, accountId: string): void
  /** processes at most one chunk of one queued file; true if work remains */
  pump(): Promise<boolean>
  /** totals for localDay(nowMs()) only */
  today(): UsageToday
  forgetAccount(accountId: string): void
}

interface Entry {
  accountId: string
  totals: TokenTotals
  files: Set<string>
}

const ASSISTANT_MARK = '"type":"assistant"'

export function createUsageCounter(deps: UsageCounterDeps): UsageCounter {
  const tailer = createTailer(deps.fs, { backfillBytes: Infinity })
  const queue: string[] = []
  const fileAccount = new Map<string, string>()
  const byId = new Map<string, Entry>()
  let currentDay = deps.localDay(deps.nowMs())

  function rollover(): void {
    const day = deps.localDay(deps.nowMs())
    if (day !== currentDay) {
      currentDay = day
      byId.clear()
    }
  }

  function dropFile(path: string): void {
    for (const [k, e] of byId) {
      e.files.delete(path)
      if (e.files.size === 0) byId.delete(k)
    }
  }

  return {
    addFile(path, accountId) {
      fileAccount.set(path, accountId)
      if (!queue.includes(path)) queue.push(path)
    },

    async pump() {
      rollover()
      const path = queue.shift()
      if (path === undefined) return false
      const accountId = fileAccount.get(path)
      if (accountId === undefined) return queue.length > 0
      try {
        const r = await tailer.read(path)
        if (r.reset) dropFile(path)
        for (const line of r.lines) {
          if (!line.includes(ASSISTANT_MARK)) continue
          const rec = parseLine(line)
          if (!rec || rec.t !== 'assistant' || !rec.usage) continue
          if (deps.localDay(rec.tsMs) !== currentDay) continue
          const key = `${accountId}|${rec.messageId}`
          const prev = byId.get(key)
          if (prev) {
            prev.totals = { ...rec.usage }
            prev.files.add(path)
          } else {
            byId.set(key, { accountId, totals: { ...rec.usage }, files: new Set([path]) })
          }
        }
        if (!r.eof) queue.unshift(path)
      } catch {
        // unreadable file: skip it until it is added again
      }
      return queue.length > 0
    },

    today() {
      rollover()
      const byAccount: Record<string, TokenTotals> = {}
      for (const e of byId.values()) {
        const t = (byAccount[e.accountId] ??= { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 })
        t.input += e.totals.input
        t.output += e.totals.output
        t.cacheCreation += e.totals.cacheCreation
        t.cacheRead += e.totals.cacheRead
      }
      return { day: currentDay, byAccount }
    },

    forgetAccount(accountId) {
      for (const [k, e] of byId) if (e.accountId === accountId) byId.delete(k)
      for (const [p, a] of [...fileAccount]) {
        if (a !== accountId) continue
        fileAccount.delete(p)
        tailer.forget(p)
        const i = queue.indexOf(p)
        if (i >= 0) queue.splice(i, 1)
      }
    }
  }
}
