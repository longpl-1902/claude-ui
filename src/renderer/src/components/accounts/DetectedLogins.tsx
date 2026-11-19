import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { CheckIcon, FolderIcon, LockIcon, RefreshIcon, WarningIcon } from '@renderer/components/ui/Icons'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import { SignInPanel } from './SignInPanel'
import './signIn.css'

export function DetectedLogins(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const loaded = useConsoleStore((s) => s.accountsLoaded)
  const linkDetected = useConsoleStore((s) => s.linkDetected)
  const startSignIn = useConsoleStore((s) => s.startSignIn)
  const scanAccounts = useConsoleStore((s) => s.scanAccounts)
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Nothing to do here when every login is already linked: one line instead of a full card (T32 U14).
  const allLinked = loaded && accounts.detected.length > 0 && accounts.detected.every((d) => d.linkedAccountId)

  const scan = async (): Promise<void> => {
    setScanning(true)
    try {
      await scanAccounts()
    } finally {
      setScanning(false)
    }
  }

  if (allLinked && !expanded) {
    const n = accounts.detected.length
    return (
      <section className="ac-acc-panel ac-acc-panel--line" aria-label="Detected logins">
        <span className="ac-acc-sub">{`${n} login${n === 1 ? '' : 's'} found · all linked`}</span>
        <Button variant="secondary" disabled={scanning} onClick={() => void scan()}>
          <RefreshIcon size={14} />
          {scanning ? 'Scanning…' : 'Scan again'}
        </Button>
        <Button variant="ghost" aria-expanded={false} onClick={() => setExpanded(true)}>
          Show details
        </Button>
        <SignInPanel />
      </section>
    )
  }

  return (
    <section className="ac-acc-panel">
      <div className="ac-acc-panel__head">
        <div className="ac-acc-panel__titles">
          <h2 className="ac-acc-h2">Detected logins</h2>
          <span className="ac-acc-sub">
            Found on this computer from the VS Code extension and the Claude Code CLI
          </span>
        </div>
        <Button variant="secondary" disabled={scanning} onClick={() => void scan()}>
          <RefreshIcon size={14} />
          {scanning ? 'Scanning…' : 'Scan again'}
        </Button>
      </div>

      <div className="ac-acc-list">
        {!loaded ? (
          <span className="ac-acc-empty">Looking for Claude config folders…</span>
        ) : accounts.detected.length === 0 ? (
          <span className="ac-acc-empty">
            No Claude config folders found. Sign in once with `claude` or add an account below.
          </span>
        ) : null}
        {accounts.detected.map((d) => {
          const linked = accounts.accounts.find((a) => a.id === d.linkedAccountId)
          const who = d.org ? `${d.email ?? ''} · ${d.org}` : (d.email ?? '')
          return (
            <div key={d.configDir} className="ac-acc-detected">
              <span className="ac-acc-detected__icon">
                <FolderIcon size={18} color="var(--ac-text-muted)" />
              </span>
              <div className="ac-acc-detected__info">
                <span className="ac-acc-mono ac-acc-detected__dir">{d.configDir}</span>
                {d.signedIn ? (
                  <span className="ac-acc-detected__who">{who}</span>
                ) : (
                  <span className="ac-acc-detected__who ac-acc-detected__who--warn">
                    {d.exists === false ? 'Folder set but not created yet' : 'Not signed in yet'}
                  </span>
                )}
                <span className="ac-acc-detected__src">{`Found in: ${d.sources.join(', ')}`}</span>
                {(d.warnings ?? []).map((w) => (
                  <span key={w} className="ac-acc-warnline" role="note">
                    <WarningIcon size={14} />
                    {w}
                  </span>
                ))}
              </div>
              {d.linkedAccountId ? (
                <span className="ac-acc-pill">
                  <CheckIcon size={12} />
                  {`Linked as ${linked?.name ?? d.linkedAccountId}`}
                </span>
              ) : d.signedIn ? (
                <Button variant="accent2" onClick={() => void linkDetected(d.configDir)}>
                  Use this
                </Button>
              ) : (
                <Button variant="warn" onClick={() => void startSignIn(d.configDir)}>
                  Sign in
                </Button>
              )}
            </div>
          )
        })}
      </div>

      <SignInPanel />

      <div className="ac-acc-privacy">
        <LockIcon size={14} />
        Agent Console reads only the email and organization name. Login tokens stay where Claude Code stored
        them.
      </div>
    </section>
  )
}
