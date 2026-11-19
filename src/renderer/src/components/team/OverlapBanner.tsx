import { rendererPlatform, selectWorktreeViews, useWorkspaceStore } from '../../store/useWorkspaceStore'
import { useConsoleStore } from '../../store/useConsoleStore'
import { Button } from '../ui/Button'
import { WarningIcon } from '../ui/Icons'
import { CompareDiffsDialog } from './CompareDiffsDialog'
import './teamCenter.css'

export function OverlapBanner(): JSX.Element | null {
  const team = useConsoleStore((s) => s.team)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const openCompare = useWorkspaceStore((s) => s.openCompare)
  const nameOf = (id: string): string => team.agents.find((a) => a.id === id)?.name ?? id

  if (team.source !== 'demo') {
    const { worktrees, overlaps } = selectWorktreeViews(workspace, team.agents, rendererPlatform())
    const paths = overlaps.map((o) => o.path)
    const dialog = <CompareDiffsDialog paths={paths} />
    if (overlaps.length === 0) return dialog
    const describe = (branch: string): string => {
      const w = worktrees.find((x) => x.branch === branch)
      const who = (w?.agentIds ?? []).map(nameOf)
      return who.length ? `${branch} (${who.join(', ')})` : branch
    }
    const sentence = (o: (typeof overlaps)[number]): string => {
      const parts = o.worktrees.map(describe)
      const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '')
      return `${o.path} changed in ${joined}`
    }
    const shown = overlaps.slice(0, 3)
    const more = overlaps.length - shown.length
    return (
      <>
        <div role="alert" className="ac-tc-banner">
          <WarningIcon color="var(--ac-status-running)" />
          <span className="ac-tc-banner__text">
            {shown.map((o, i) => (
              <span key={o.path} className="ac-tc-banner__file">
                {i > 0 && '; '}
                {sentence(o)}
              </span>
            ))}
            {more > 0 && ` +${more} more`}
          </span>
          <Button variant="ghost" className="ac-tc-banner__btn" onClick={() => void openCompare(paths[0]!)}>
            Compare diffs
          </Button>
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
