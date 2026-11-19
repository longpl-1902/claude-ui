import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ActivitySpan, Agent } from '@shared/types'
import { useAgentStatuses, useConsoleStore } from '../../store/useConsoleStore'
import { Button } from '../ui/Button'
import { midEllipsis } from '../ui/midEllipsis'
import { SEGMENT_COLORS, TIMELINE_LEGEND } from '../../theme/colors'
import './teamCenter.css'
import './teamLeft.css'

export const WINDOW_MS = 20 * 60 * 1000
const TICKS = ['-20m', '-15m', '-10m', '-5m', 'now']
const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Segment geometry in percent of the window [nowMs - 20 min, nowMs]; null when outside it. */
export function spanGeometry(s: ActivitySpan, nowMs: number): { left: number; width: number } | null {
  const from = nowMs - WINDOW_MS
  const end = Math.min(s.endMs ?? nowMs, nowMs)
  const start = Math.max(s.startMs, from)
  if (end <= start) return null
  return { left: ((start - from) / WINDOW_MS) * 100, width: ((end - start) / WINDOW_MS) * 100 }
}

const LANE_LABEL_MAX = 16
const legendText = TIMELINE_LEGEND.map((l) => l.label).join(', ')

/** Legend chips; in a narrow column (container query) they fold into one "Legend" button with a tooltip. */
function Legend(): JSX.Element {
  return (
    <>
      <span className="ac-tc-legend-chips">
        {TIMELINE_LEGEND.map((l) => (
          <span key={l.kind} className="ac-tc-legend">
            <i style={{ background: SEGMENT_COLORS[l.kind] }} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </span>
      <button type="button" className="ac-tc-legend-btn" title={legendText} aria-label={`Legend: ${legendText}`}>
        Legend
      </button>
    </>
  )
}

/** Title row with the collapse toggle (T32 U5); collapsed = just this one-line strip. */
function TimelineHead({ open, onToggle, children }: { open: boolean; onToggle(): void; children?: ReactNode }): JSX.Element {
  return (
    <div className="ac-tc-tl-head">
      <button type="button" className="ac-tc-tl-toggle" aria-expanded={open} aria-label={open ? 'Collapse timeline' : 'Expand timeline'} onClick={onToggle}>
        {open ? '▾' : '▸'}
      </button>
      <h2>Timeline</h2>
      <span className="ac-tc-hint">last 20 min</span>
      <div className="ac-tc-spacer" />
      {children}
    </div>
  )
}

function LiveTimeline({ defaultCollapsed }: { defaultCollapsed: boolean }): JSX.Element {
  const agents = useConsoleStore((s) => s.team.agents)
  const nowMs = useConsoleStore((s) => s.nowMs)
  const selectedAgentId = useConsoleStore((s) => s.selectedAgentId)
  const statuses = useAgentStatuses()
  const [showFinished, setShowFinished] = useState(false)
  const [open, setOpen] = useState(!defaultCollapsed)

  const geo = (a: Agent): { span: ActivitySpan; left: number; width: number }[] =>
    (a.spans ?? []).flatMap((span) => {
      const g = spanGeometry(span, nowMs)
      return g ? [{ span, ...g }] : []
    })
  // U12: the lead, agents with activity in the window, and running / needs-you agents; the rest stays out of the way.
  const isLead = (a: Agent, i: number): boolean => a.runtime?.kind === 'lead' || a.id === 'lead' || i === 0
  const shown: Agent[] = []
  let finished = 0
  agents.forEach((a, i) => {
    const lead = isLead(a, i)
    const done = statuses[a.id] === 'done' && !lead
    const live = statuses[a.id] === 'running' || statuses[a.id] === 'needs-you'
    const relevant = lead || live || geo(a).length > 0
    if (done && !showFinished) finished += 1
    else if (relevant || showFinished) shown.push(a)
  })
  const anyActivity = agents.some((a) => geo(a).length > 0)

  return (
    <section className="ac-tc-panel">
      <TimelineHead open={open} onToggle={() => setOpen((o) => !o)}>
        {open && <Legend />}
      </TimelineHead>
      {!open ? null : !anyActivity ? (
        <p className="ac-tc-empty-line">No activity in the last 20 minutes</p>
      ) : (
        <div className="ac-tc-scroll">
          <div className="ac-tc-tl ac-tc-tl--live">
            {shown.map((a) => (
              <div key={a.id} className="ac-tc-lane-row">
                <span
                  className={a.id === selectedAgentId ? 'ac-tc-lane-name ac-tc-lane-name--sel' : 'ac-tc-lane-name'}
                  title={a.name}
                >
                  {midEllipsis(a.name, LANE_LABEL_MAX)}
                </span>
                <div className="ac-tc-lane" role="img" aria-label={`${a.name} activity, last 20 minutes`}>
                  {geo(a).map(({ span, left, width }, i) => (
                    <span
                      key={i}
                      className="ac-tc-seg"
                      title={`${span.kind} ${clock(Math.max(span.startMs, nowMs - WINDOW_MS))}-${clock(Math.min(span.endMs ?? nowMs, nowMs))}`}
                      style={{ left: `${left}%`, width: `${width}%`, background: SEGMENT_COLORS[span.kind] }}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="ac-tc-lane-row">
              <span />
              <div className="ac-tc-ticks">
                {TICKS.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {open && (finished > 0 || showFinished) && (
        <div className="ac-tc-finished">
          {finished > 0 && <span>{`${finished} finished`}</span>}
          <Button variant="ghost" size="sm" aria-pressed={showFinished} onClick={() => setShowFinished((v) => !v)}>
            {showFinished ? 'Hide finished' : 'Show finished'}
          </Button>
        </div>
      )}
    </section>
  )
}

export function Timeline({ defaultCollapsed = false }: { defaultCollapsed?: boolean } = {}): JSX.Element {
  const team = useConsoleStore((s) => s.team)
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  const selectedAgentId = useConsoleStore((s) => s.selectedAgentId)
  if (!demo) return <LiveTimeline defaultCollapsed={defaultCollapsed} />
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
