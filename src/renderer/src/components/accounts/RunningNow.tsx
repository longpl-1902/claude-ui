import { ACCOUNT_FALLBACK_COLOR } from '@renderer/theme/colors'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import type { SessionSummary } from '@shared/types'

const where = (s: SessionSummary): string => (s.entrypoint?.toLowerCase().includes('vscode') ? 'in VS Code' : 'in a terminal')

export function RunningNow(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const sessions = useConsoleStore((s) => s.sessions)
  // Live sessions started elsewhere (VS Code, a terminal) count too; they are labelled with where they run.
  const external = sessions.filter((s) => s.live)
  return (
    <section className="ac-acc-section">
      <h2 className="ac-acc-h2">Running now</h2>
      {accounts.sessions.length === 0 && external.length === 0 && (
        <p className="ac-acc-empty">Nothing running. Start one with + New session in the Team view.</p>
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
        {external.map((s) => {
          const acc = accounts.accounts.find((a) => a.id === s.accountId)
          return (
            <div key={`ext:${s.accountId}|${s.sessionId}`} className="ac-acc-session">
              <span className="ac-acc-dot" style={{ background: acc?.color ?? ACCOUNT_FALLBACK_COLOR }} />
              <span className="ac-acc-session__team">{s.title ?? s.sessionId.slice(0, 8)}</span>
              <span className="ac-acc-mono ac-acc-session__path">{s.project?.name ?? s.cwd ?? ''}</span>
              <div className="ac-acc-spacer" />
              <span className="ac-acc-session__acct">{`${acc?.name ?? ''} · ${where(s)}`}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
