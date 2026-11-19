import { useConsoleStore } from '../../store/useConsoleStore'
import { SEGMENT_COLORS, TIMELINE_LEGEND } from '../../theme/colors'
import './teamCenter.css'

export function Timeline(): JSX.Element {
  const team = useConsoleStore((s) => s.team)
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  const selectedAgentId = useConsoleStore((s) => s.selectedAgentId)
  if (!demo) {
    return (
      <section className="ac-tc-panel">
        <div className="ac-tc-tl-head">
          <h2>Timeline</h2>
        </div>
        <p className="ac-tc-placeholder">Timeline arrives in Phase 5</p>
      </section>
    )
  }
  return (
    <section className="ac-tc-panel">
      <div className="ac-tc-tl-head">
        <h2>Timeline</h2>
        <span className="ac-tc-hint">last 20 min</span>
        <div className="ac-tc-spacer" />
        {TIMELINE_LEGEND.map((l) => (
          <span key={l.kind} className="ac-tc-legend">
            <i style={{ background: SEGMENT_COLORS[l.kind] }} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </div>
      <div className="ac-tc-scroll">
        <div className="ac-tc-tl">
          {team.agents.map((a) => (
            <div key={a.id} className="ac-tc-lane-row">
              <span className={a.id === selectedAgentId ? 'ac-tc-lane-name ac-tc-lane-name--sel' : 'ac-tc-lane-name'}>
                {a.name}
              </span>
              <div className="ac-tc-lane" role="img" aria-label={`${a.name} activity, last 20 minutes`}>
                {a.timeline.map((s, i) => (
                  <span
                    key={i}
                    className="ac-tc-seg"
                    title={s.kind}
                    style={{ left: `${s.startPct}%`, width: `${s.widthPct}%`, background: SEGMENT_COLORS[s.kind] }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="ac-tc-lane-row">
            <span />
            <div className="ac-tc-ticks">
              {team.timelineTicks.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
