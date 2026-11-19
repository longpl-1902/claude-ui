import { useConsoleStore } from '../../store/useConsoleStore'
import { Button } from '../ui/Button'
import { WarningIcon } from '../ui/Icons'
import './teamCenter.css'

export function OverlapBanner(): JSX.Element | null {
  const team = useConsoleStore((s) => s.team)
  if (team.overlaps.length === 0) return null
  const nameOf = (id: string): string => team.agents.find((a) => a.id === id)?.name ?? id
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
