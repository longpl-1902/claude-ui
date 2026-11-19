import { useEffect, useState } from 'react'
import type { WorkspaceSnapshot } from '@shared/types'
import { rendererPlatform, selectWorktreeViews, useWorkspaceStore } from '../../store/useWorkspaceStore'
import { useConsoleStore } from '../../store/useConsoleStore'
import { Button } from '../ui/Button'
import { WarningIcon } from '../ui/Icons'
import { CompareDiffsDialog } from './CompareDiffsDialog'
import './teamCenter.css'

const MAX_WT = 3
export const DISMISS_PREFIX = 'ac.overlapDismissed:'

/**
 * Indexes of `ws.overlaps` that are being edited right now: the file has uncommitted changes in two or more of its
 * worktrees, or in one worktree where an agent of the viewed team works. Files that branches merely changed in past
 * commits are a merge-time concern and stay in the worktree panel only.
 */
export function liveOverlapIndexes(ws: WorkspaceSnapshot, agentWorktrees: Set<string>): number[] {
  const dirty = new Map<string, Set<string>>()
  for (const w of ws.worktrees) dirty.set(w.path, new Set(w.files.filter((f) => f.uncommitted).map((f) => f.path)))
  const out: number[] = []
  ws.overlaps.forEach((o, i) => {
    const editing = o.worktrees.filter((p) => dirty.get(p)?.has(o.path))
    if (editing.length >= 2 || editing.some((p) => agentWorktrees.has(p))) out.push(i)
  })
  return out
}

function readDismissed(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeDismissed(key: string, paths: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...paths].slice(-2000)))
  } catch {
    /* storage unavailable: dismissed for this session only */
  }
}

export function OverlapBanner(): JSX.Element | null {
  const team = useConsoleStore((s) => s.team)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const openCompare = useWorkspaceStore((s) => s.openCompare)
  const nameOf = (id: string): string => team.agents.find((a) => a.id === id)?.name ?? id
  const root = workspace?.root ?? ''
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(`${DISMISS_PREFIX}${root}`))
  useEffect(() => {
    setDismissed(readDismissed(`${DISMISS_PREFIX}${root}`))
    setExpanded(false)
  }, [root])

  if (team.source !== 'demo') {
    const { worktrees, overlaps: all } = selectWorktreeViews(workspace, team.agents, rendererPlatform())
    // Only overlaps someone is editing right now (user: the warning listed every file two branches ever touched).
    const live = workspace ? liveOverlapIndexes(workspace, new Set(worktrees.filter((w) => w.agentIds.length > 0).map((w) => w.path))) : []
    const liveOverlaps = live.flatMap((i) => (all[i] ? [all[i]] : []))
    const dismissKey = `${DISMISS_PREFIX}${workspace?.root ?? ''}`
    const overlaps = liveOverlaps.filter((o) => !dismissed.has(o.path))
    // Live overlaps first in the dialog's file list; the rest stay reachable from the worktree panel.
    const paths = [...liveOverlaps, ...all.filter((o) => !liveOverlaps.includes(o))].map((o) => o.path)
    const dialog = <CompareDiffsDialog paths={paths} />
    if (overlaps.length === 0) return dialog
    const describe = (branch: string): string => {
      const w = worktrees.find((x) => x.branch === branch)
      const who = (w?.agentIds ?? []).map(nameOf)
      return who.length ? `${branch} (${who.join(', ')})` : branch
    }
    const sentence = (o: (typeof overlaps)[number]): string => {
      const parts = o.worktrees.slice(0, MAX_WT).map(describe)
      const rest = o.worktrees.length - parts.length
      if (rest > 0) return `${o.path} changed in ${parts.join(', ')} and ${rest} more worktree${rest === 1 ? '' : 's'}`
      const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '')
      return `${o.path} changed in ${joined}`
    }
    const shown = expanded ? overlaps : overlaps.slice(0, 3)
    const more = overlaps.length - shown.length
    const dismiss = (): void => {
      const next = new Set([...dismissed, ...liveOverlaps.map((o) => o.path)])
      setDismissed(next)
      writeDismissed(dismissKey, next)
    }
    return (
      <>
        <div role="alert" className="ac-tc-banner">
          <WarningIcon color="var(--ac-status-running)" />
          <span className={expanded ? 'ac-tc-banner__text is-expanded' : 'ac-tc-banner__text'}>
            {shown.map((o, i) => (
              <span key={o.path} className="ac-tc-banner__file">
                {i > 0 && '; '}
                {sentence(o)}
              </span>
            ))}
            {more > 0 && ` +${more} more`}
          </span>
          {overlaps.length > 1 && (
            <Button variant="ghost" className="ac-tc-banner__btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Less' : 'Details'}
            </Button>
          )}
          <Button variant="ghost" className="ac-tc-banner__btn" onClick={() => void openCompare(overlaps[0]!.path)}>
            Compare diffs
          </Button>
          <button
            type="button"
            className="ac-tc-banner__close"
            aria-label="Dismiss overlap warning"
            title="Hide this warning until another file overlaps"
            onClick={dismiss}
          >
            ×
          </button>
        </div>
        {dialog}
      </>
    )
  }

  if (team.overlaps.length === 0) return null
  return (
    <>
      {team.overlaps.map((o) => (
        <div key={o.path} role="alert" className="ac-tc-banner">
          <WarningIcon color="var(--ac-status-running)" />
          <span className="ac-tc-banner__text">
            File overlap: <span className="ac-tc-mono">{o.path}</span> is being edited by{' '}
            {o.agentIds.map(nameOf).join(' and ')} in different worktrees.
          </span>
          <Button variant="ghost" className="ac-tc-banner__btn">
            Compare diffs
          </Button>
        </div>
      ))}
    </>
  )
}
