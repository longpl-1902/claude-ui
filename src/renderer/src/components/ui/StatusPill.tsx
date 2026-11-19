import type { AgentStatus } from '../../../../shared/types'
import { STATUS_META } from '../../theme/colors'
import './ui.css'

export function StatusPill({ status }: { status: AgentStatus }): JSX.Element {
  const meta = STATUS_META[status]
  return (
    <span className="ac-pill" style={{ color: meta.color, background: meta.bg }}>
      <span
        className={meta.pulse ? 'ac-pill__dot ac-pulse' : 'ac-pill__dot'}
        style={{ background: meta.color }}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  )
}
