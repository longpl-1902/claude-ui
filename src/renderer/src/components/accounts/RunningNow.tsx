import { ACCOUNT_FALLBACK_COLOR } from '@renderer/theme/colors'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

export function RunningNow(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  return (
    <section className="ac-acc-section">
      <h2 className="ac-acc-h2">Running now</h2>
      {accounts.sessions.length === 0 && (
        <p className="ac-acc-empty">No sessions running. Start one from the lead console's Raw terminal.</p>
      )}
      <div className="ac-acc-list">
        {accounts.sessions.map((s) => {
          const acc = accounts.accounts.find((a) => a.id === s.accountId)
          return (
            <div key={`${s.teamName}:${s.path}`} className="ac-acc-session">
              <span className="ac-acc-dot" style={{ background: acc?.color ?? ACCOUNT_FALLBACK_COLOR }} />
              <span className="ac-acc-session__team">{s.teamName}</span>
              <span className="ac-acc-mono ac-acc-session__path">{s.path}</span>
              <div className="ac-acc-spacer" />
              <span className="ac-acc-session__acct">
                {`${acc?.name ?? ''} · ${s.agentCount} ${s.agentCount === 1 ? 'agent' : 'agents'}`}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
