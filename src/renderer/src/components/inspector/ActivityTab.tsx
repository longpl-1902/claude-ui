import type { ActivityItem } from '@shared/types'
import { shortenPathsInText } from '@shared/displayPath'
import { toolColor } from '../../theme/colors'
import { useConsoleStore } from '../../store/useConsoleStore'
import { rendererPlatform } from '../../store/useWorkspaceStore'

/** The async-launch result is internal bookkeeping; show what it means. */
export function activityResult(result: string): string {
  if (result === '…') return 'running…'
  return /^Async agent launched successfully/i.test(result) ? 'launched in background' : result
}

export function ActivityTab({ items }: { items: ActivityItem[] }): JSX.Element {
  const root = useConsoleStore((s) => s.team.cwd)
  const opts = { ...(root ? { root } : {}), platform: rendererPlatform() }
  return (
    <ol className="insp-activity">
      {items.length === 0 && <li className="insp-empty">No tool calls yet</li>}
      {items.map((e, i) => {
        const color = toolColor(e.tool)
        return (
          <li key={`${e.time}-${i}`} className="insp-event">
            <span className="insp-event__time">{e.time}</span>
            <span className="insp-event__rail" aria-hidden="true">
              <span className="insp-event__dot" style={{ background: color }} />
              <span className="insp-event__line" />
            </span>
            <span className="insp-event__body">
              <span className="insp-event__cmd">
                <span className="insp-event__tool" style={{ color }}>
                  {e.tool}
                </span>{' '}
                <span className="insp-event__target" title={e.target}>
                  {shortenPathsInText(e.target, opts)}
                </span>
              </span>
              <span className={e.failed ? 'insp-event__result insp-event__result--failed' : 'insp-event__result'}>
                {activityResult(e.result)}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
