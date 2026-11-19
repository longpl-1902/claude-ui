import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { ChevronDownIcon, LockIcon, TerminalIcon } from '../ui/Icons'
import { formatTokens } from '@shared/format'
import { selectActiveAccount, useConsoleStore, useTeamCounters } from '../../store/useConsoleStore'
import './teamLeft.css'

export function TeamHeader() {
  const team = useConsoleStore((s) => s.team)
  const account = useConsoleStore(selectActiveAccount)
  const edge = useConsoleStore((s) => s.accounts.safety.showAccountColorEdge)
  const navigate = useConsoleStore((s) => s.navigate)
  const counters = useTeamCounters()

  return (
    <header
      className="ac-header"
      style={{ borderTop: `3px solid ${edge && account ? account.color : 'var(--ac-border)'}` }}
    >
      <div className="ac-header__brand">
        <TerminalIcon size={22} color="var(--ac-accent)" />
        <span className="ac-header__title">Agent Console</span>
      </div>
      <div className="ac-header__repo">
        <span>{team.repo}</span>
        <span className="ac-header__sep" aria-hidden="true">/</span>
        <span className="ac-header__team">team: {team.teamName}</span>
      </div>
      <button
        type="button"
        className="ac-header__chip"
        aria-label={`Account: ${account ? account.name : 'none'}. Manage accounts`}
        title={account ? (account.email ? `${account.name} · ${account.email}` : account.name) : 'No account'}
        onClick={() => navigate('accounts')}
      >
        <Avatar
          initials={account ? account.name.charAt(0).toUpperCase() : '?'}
          color={account ? account.color : 'var(--ac-text-muted)'}
          size={20}
          shape="circle"
        />
        <span className="ac-header__name">{account ? account.name : 'No account'}</span>
        {account?.email && <span className="ac-header__email">{account.email}</span>}
        {account?.locked && (
          <span title="Account locked while a session runs" className="ac-header__lock">
            <LockIcon size={12} color="var(--ac-text-muted)" />
          </span>
        )}
        <ChevronDownIcon size={12} color="var(--ac-text-muted)" />
      </button>
      <div className="ac-header__spacer" />
      <div className="ac-header__counters">
        <span>
          <strong>{counters.agents}</strong> agents
        </span>
        <span className="is-running">
          <strong>{counters.running}</strong> running
        </span>
        <span className="is-needs">
          <strong>{counters.needsYou}</strong> needs you
        </span>
        <span>
          Tokens <strong>{formatTokens(counters.tokens)}</strong>
        </span>
      </div>
      <div className="ac-header__actions">
        <Button variant="secondary" onClick={() => void window.api?.team.pauseAll()}>
          Pause all
        </Button>
        <Button variant="primary">+ New teammate</Button>
      </div>
    </header>
  )
}
