import type { ContextUsage } from '@shared/types'
import './controlBar.css'

export const AMBER_AT = 75
export const RED_AT = 90

const fmt = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export type MeterLevel = 'ok' | 'warn' | 'high'
export const meterLevel = (pct: number): MeterLevel => (pct >= RED_AT ? 'high' : pct >= AMBER_AT ? 'warn' : 'ok')

export interface ContextMeterProps {
  context?: ContextUsage
  /** Extra tooltip lines (last-turn tokens and cost, session cost). */
  detail?: string
}

/** Compact meter: an 80 px bar and "28%"; the tooltip carries "284k / 1000k", the categories and the cost line. */
export function ContextMeter({ context, detail }: ContextMeterProps): JSX.Element {
  const pct = context ? Math.max(0, Math.min(100, Math.round(context.percentage))) : 0
  const level = meterLevel(pct)
  const label = context
    ? `${pct}% context (${fmt(context.totalTokens)} / ${fmt(context.maxTokens)})`
    : 'Context usage not loaded'
  const cats = context
    ? context.categories.map((c) => `${c.name}: ${fmt(c.tokens)} (${Math.round(c.percentage)}%)`).join('\n')
    : 'Use "Refresh usage" in the more menu to read the context window usage'
  const tip = [label, cats, detail].filter(Boolean).join('\n')
  return (
    <span className="ac-ctx">
      <span
        role="meter"
        aria-label="Context window"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={label}
        data-level={level}
        title={tip}
        className="ac-ctx__meter"
      >
        <span aria-hidden className="ac-ctx__track">
          <span data-testid="context-fill" className="ac-ctx__fill" style={{ width: `${pct}%` }} />
        </span>
        <span aria-hidden="true">{context ? `${pct}%` : '--'}</span>
      </span>
    </span>
  )
}
