// Overlap detection and agent -> worktree mapping. Pure; must not import main-process code.
import type { FileOverlap, Worktree } from './types'

export interface WtFiles {
  path: string
  branch?: string
  files: { path: string }[]
}

function normKey(p: string, platform: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return platform === 'win32' ? s.toLowerCase() : s
}

/** Files present in two or more worktrees; sorted by path, worktrees in input order. */
export function detectOverlaps(wts: WtFiles[]): { path: string; worktrees: string[] }[] {
  const by = new Map<string, string[]>()
  for (const w of wts) {
    for (const p of new Set(w.files.map((f) => f.path))) {
      const l = by.get(p)
      if (l) l.push(w.path)
      else by.set(p, [w.path])
    }
  }
  return [...by.entries()]
    .filter(([, l]) => l.length >= 2)
    .map(([path, worktrees]) => ({ path, worktrees }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** The longest worktree path that equals or contains cwd (segment-wise). Returns it as given. */
export function worktreeForCwd(cwd: string | undefined, wtPaths: string[], platform: string): string | null {
  if (!cwd) return null
  const c = normKey(cwd, platform)
  let best: string | null = null
  let bestLen = -1
  for (const w of wtPaths) {
    const k = normKey(w, platform)
    if ((c === k || c.startsWith(k + '/')) && k.length > bestLen) {
      best = w
      bestLen = k.length
    }
  }
  return best
}

export function mapAgentsToWorktrees(
  agents: { id: string; cwd?: string }[],
  wtPaths: string[],
  platform: string
): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const a of agents) {
    const w = worktreeForCwd(a.cwd, wtPaths, platform)
    if (w === null) continue
    const l = m.get(w)
    if (l) l.push(a.id)
    else m.set(w, [a.id])
  }
  return m
}

export function toWorktreeViews(
  s: {
    worktrees: (WtFiles & { changedFiles: number; ahead: number | null; behind: number | null; isMain: boolean; error?: string })[]
    overlaps: { path: string; worktrees: string[] }[]
  },
  agents: { id: string; cwd?: string }[],
  platform: string
): { worktrees: Worktree[]; overlaps: FileOverlap[] } {
  const paths = s.worktrees.map((w) => w.path)
  const agentMap = mapAgentsToWorktrees(agents, paths, platform)
  const branchOf = new Map(s.worktrees.map((w) => [w.path, w.branch ?? '(detached)']))
  const worktrees = s.worktrees.map((w) => {
    const others = new Set<string>()
    for (const o of s.overlaps) {
      if (!o.worktrees.includes(w.path)) continue
      for (const p of o.worktrees) if (p !== w.path) others.add(branchOf.get(p) ?? p)
    }
    const view = {
      branch: w.branch ?? '(detached)',
      path: w.path,
      agentIds: agentMap.get(w.path) ?? [],
      changedFiles: w.changedFiles,
      ahead: w.ahead ?? 0,
      behind: w.behind,
      files: w.files.map((f) => f.path),
      isMain: w.isMain,
      error: w.error,
      overlapsWith: others.size ? [...others] : undefined
    }
    return view
  })
  const overlaps: FileOverlap[] = s.overlaps.map((o) => ({
    path: o.path,
    agentIds: o.worktrees.flatMap((p) => agentMap.get(p) ?? []),
    worktrees: o.worktrees.map((p) => branchOf.get(p) ?? p)
  }))
  return { worktrees, overlaps }
}
