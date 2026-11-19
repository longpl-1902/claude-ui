// Pure parsers for the git output we read (formats verified in the phase 3b.5 plan, fact 12). No process spawning here.

export interface RawWorktree {
  path: string
  head: string
  branch?: string
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
}

/** `git worktree list --porcelain`: blank-line separated blocks; the first block is the main worktree. */
export function parseWorktreeList(out: string): RawWorktree[] {
  const res: RawWorktree[] = []
  let cur: RawWorktree | null = null
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') {
      cur = null
      continue
    }
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), head: '', detached: false, bare: false, locked: false, prunable: false }
      res.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (line === 'detached') cur.detached = true
    else if (line === 'bare') cur.bare = true
    else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true
  }
  return res
}

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | '?' | 'U'

export interface StatusEntry {
  path: string
  origPath?: string
  x: string
  y: string
  status: ChangeStatus
}

function statusLetter(x: string, y: string): ChangeStatus {
  if (x === '?' && y === '?') return '?'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'U'
  const l = y !== ' ' ? y : x
  if (l === 'M' || l === 'A' || l === 'D' || l === 'R') return l
  if (l === 'C') return 'A'
  return 'M'
}

/** `git status --porcelain=v1 -z`. Renames/copies emit `XY new\0old\0`. Ignored (`!!`) entries are skipped. */
export function parseStatusZ(out: string): StatusEntry[] {
  const parts = out.split('\0')
  const res: StatusEntry[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (p.length < 4) continue
    const x = p[0]!
    const y = p[1]!
    const path = p.slice(3)
    const hasOrig = x === 'R' || x === 'C' || y === 'R' || y === 'C'
    const orig = hasOrig ? parts[++i] : undefined
    if (x === '!' && y === '!') continue
    const e: StatusEntry = { path, x, y, status: statusLetter(x, y) }
    if (orig) e.origPath = orig
    res.push(e)
  }
  return res
}

/** `rev-list --left-right --count base...head` -> "behind\tahead". */
export function parseLeftRight(out: string): { behind: number; ahead: number } | null {
  const m = /^(\d+)\t(\d+)\s*$/.exec(out)
  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null
}

export interface NumstatEntry {
  path: string
  added: number | null
  removed: number | null
}

/** `git diff --numstat -z`: `a\td\tpath\0`, rename `a\td\t\0old\0new\0`, binary `-\t-\t`. */
export function parseNumstatZ(out: string): NumstatEntry[] {
  const parts = out.split('\0')
  const res: NumstatEntry[] = []
  const num = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(p)
    if (!m) continue
    let path = m[3]!
    if (path === '') {
      i += 2
      path = parts[i] ?? ''
    }
    if (path === '') continue
    res.push({ path, added: num(m[1]!), removed: num(m[2]!) })
  }
  return res
}

/** Base branch: the origin/HEAD target if it exists, else the first existing of the usual names. */
export function pickBase(c: { originHead: string | null; existing: (ref: string) => boolean }): string | null {
  if (c.originHead && c.existing(c.originHead)) return c.originHead
  for (const r of ['main', 'master', 'origin/main', 'origin/master']) if (c.existing(r)) return r
  return null
}

/** `symbolic-ref refs/remotes/origin/HEAD` output -> 'origin/main'. */
export function parseSymbolicRef(out: string): string | null {
  const s = out.trim().replace(/^refs\/remotes\//, '')
  return s === '' ? null : s
}

export interface ChangedFile {
  path: string
  status: StatusEntry['status']
  added?: number
  removed?: number
  committed: boolean
  uncommitted: boolean
}

/** Merge committed (numstat vs base) and uncommitted (status) changes into one capped file list. */
export function mergeChanged(
  committed: NumstatEntry[],
  status: StatusEntry[],
  cap = 500
): { files: ChangedFile[]; total: number } {
  const map = new Map<string, ChangedFile>()
  for (const c of committed) {
    const f: ChangedFile = { path: c.path, status: 'M', committed: true, uncommitted: false }
    if (c.added !== null) f.added = c.added
    if (c.removed !== null) f.removed = c.removed
    map.set(c.path, f)
  }
  for (const s of status) {
    const f = map.get(s.path)
    if (f) {
      f.uncommitted = true
      f.status = s.status
    } else map.set(s.path, { path: s.path, status: s.status, committed: false, uncommitted: true })
  }
  const all = [...map.values()]
  return { files: all.slice(0, cap), total: all.length }
}
