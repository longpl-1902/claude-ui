import type { ContextUsage } from '@shared/types'
import { Button } from '../ui/Button'
import './controlBar.css'

export const AMBER_AT = 75
export const RED_AT = 90

const fmt = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export type MeterLevel = 'ok' | 'warn' | 'high'
export const meterLevel = (pct: number): MeterLevel => (pct >= RED_AT ? 'high' : pct >= AMBER_AT ? 'warn' : 'ok')

export interface ContextMeterProps {
  context?: ContextUsage
  onRefresh(): void
}

export function ContextMeter({ context, onRefresh }: ContextMeterProps): JSX.Element {
  const pct = context ? Math.max(0, Math.min(100, Math.round(context.percentage))) : 0
  const level = meterLevel(pct)
  const label = context
    ? `${pct}% context (${fmt(context.totalTokens)} / ${fmt(context.maxTokens)})`
    : 'Context usage not loaded'
  const tip = context
    ? context.categories.map((c) => `${c.name}: ${fmt(c.tokens)} (${Math.round(c.percentage)}%)`).join('\n')
    : 'Press refresh to read the context window usage'
  return (
    <span className="ac-ctx">
      <span
        role="meter"
        aria-label="Context window"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        data-level={level}
        title={tip}
        className="ac-ctx__meter"
      >
        <span aria-hidden className="ac-ctx__track">
          <span data-testid="context-fill" className="ac-ctx__fill" style={{ width: `${pct}%` }} />
        </span>
        <span>{label}</span>
      </span>
      <Button size="sm" variant="ghost" aria-label="Refresh context usage" onClick={onRefresh}>
        Refresh
      </Button>
    </span>
  )
}
