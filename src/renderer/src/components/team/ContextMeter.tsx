import type { ContextUsage } from '@shared/types'
import { Button } from '../ui/Button'

export const AMBER_AT = 75
export const RED_AT = 90

const fmt = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export type MeterLevel = 'ok' | 'warn' | 'high'
export const meterLevel = (pct: number): MeterLevel => (pct >= RED_AT ? 'high' : pct >= AMBER_AT ? 'warn' : 'ok')
const COLOR: Record<MeterLevel, string> = {
  ok: 'var(--ac-accent)',
  warn: 'var(--ac-status-waiting, #d99a00)',
  high: 'var(--ac-status-error, #e5484d)'
}

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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
      <span
        role="meter"
        aria-label="Context window"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        data-level={level}
        title={tip}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, minWidth: 0 }}
      >
        <span
          aria-hidden
          style={{
            width: 80,
            height: 6,
            borderRadius: 3,
            background: 'var(--ac-border-btn)',
            overflow: 'hidden',
            display: 'inline-block'
          }}
        >
          <span
            data-testid="context-fill"
            style={{ display: 'block', width: `${pct}%`, height: '100%', background: COLOR[level] }}
          />
        </span>
        <span>{label}</span>
      </span>
      <Button size="sm" variant="ghost" aria-label="Refresh context usage" onClick={onRefresh}>
        Refresh
      </Button>
    </span>
  )
}
