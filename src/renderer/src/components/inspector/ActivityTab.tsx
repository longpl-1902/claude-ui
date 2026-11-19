import type { ActivityItem } from '@shared/types'
import { toolColor } from '../../theme/colors'

export function ActivityTab({ items }: { items: ActivityItem[] }): JSX.Element {
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
                <span className="insp-event__target">{e.target}</span>
              </span>
              <span className={e.failed ? 'insp-event__result insp-event__result--failed' : 'insp-event__result'}>
                {e.result === '…' ? 'running…' : e.result}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
