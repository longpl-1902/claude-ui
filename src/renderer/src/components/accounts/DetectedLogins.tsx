import { Button } from '@renderer/components/ui/Button'
import { CheckIcon, FolderIcon, LockIcon, RefreshIcon } from '@renderer/components/ui/Icons'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

const STEP_COLORS = {
  done: { ring: '#5ED3A8', fill: '#5ED3A8', num: '#0E0F11', text: '#C9CDD4' },
  current: { ring: '#F2A541', fill: 'transparent', num: '#F2A541', text: '#E6E7EA' },
  todo: { ring: '#5C636E', fill: 'transparent', num: '#8E95A0', text: '#8E95A0' }
}

function SignInPanel(): JSX.Element | null {
  const signIn = useConsoleStore((s) => s.signIn)
  const accounts = useConsoleStore((s) => s.accounts)
  const finishSignIn = useConsoleStore((s) => s.finishSignIn)
  const cancelSignIn = useConsoleStore((s) => s.cancelSignIn)
  const closeSignInPanel = useConsoleStore((s) => s.closeSignInPanel)
  if (!signIn.panelOpen || signIn.step === 'none') return null

  const configDir = signIn.configDir ?? ''
  const det = accounts.detected.find((d) => d.configDir === configDir)
  const account = accounts.accounts.find((a) => a.id === det?.linkedAccountId)
  const done = signIn.step === 'done'
  const cur = done ? 3 : 1
  const labels = [`Folder ${configDir}`, 'Sign in on claude.ai', 'Ready to use']
  const folder = (account?.folderRules[0]?.pattern ?? '').replace(/\/\*\*$/, '')

  return (
    <div className="ac-acc-flow" aria-live="polite">
      <ol className="ac-acc-steps">
        {labels.map((label, i) => {
          const c = done || i < cur ? STEP_COLORS.done : i === cur ? STEP_COLORS.current : STEP_COLORS.todo
          return (
            <li
              key={label}
              className="ac-acc-step"
              style={{ color: c.text }}
              aria-current={!done && i === cur ? 'step' : undefined}
            >
              <span
                className="ac-acc-step__n"
                style={{ borderColor: c.ring, background: c.fill, color: c.num }}
              >
                {i + 1}
              </span>
              {label}
              {i < 2 && (
                <span className="ac-acc-step__sep" aria-hidden="true">
                  —
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {!done ? (
        <div className="ac-acc-flow__body">
          <span className="ac-acc-flow__title">Finish signing in your browser</span>
          <span className="ac-acc-flow__text">
            Claude Code opened the sign-in page in your browser. Sign in with your personal account. This
            screen updates by itself when you are done.
          </span>
          <span className="ac-acc-cmd">{`CLAUDE_CONFIG_DIR=${configDir} claude  ›  /login`}</span>
          <div className="ac-acc-row">
            <Button variant="warn" onClick={finishSignIn}>
              Check now
            </Button>
            <Button variant="secondary">Open browser again</Button>
            <Button variant="ghost" onClick={cancelSignIn}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="ac-acc-flow__done">
          <span className="ac-acc-flow__check">
            <CheckIcon size={16} color="#5ED3A8" />
          </span>
          <div className="ac-acc-flow__donetext">
            <span className="ac-acc-flow__title">{`Signed in as ${det?.email ?? ''}`}</span>
            <span className="ac-acc-sub">
              {`Saved as “${account?.name ?? ''}”. Folders under ${folder}/ will use it.`}
            </span>
          </div>
          <Button variant="secondary" onClick={closeSignInPanel}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}

export function DetectedLogins(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const linkDetected = useConsoleStore((s) => s.linkDetected)
  const startSignIn = useConsoleStore((s) => s.startSignIn)
  return (
    <section className="ac-acc-panel">
      <div className="ac-acc-panel__head">
        <div className="ac-acc-panel__titles">
          <h2 className="ac-acc-h2">Detected logins</h2>
          <span className="ac-acc-sub">
            Found on this computer from the VS Code extension and the Claude Code CLI
          </span>
        </div>
        <Button variant="secondary">
          <RefreshIcon size={14} />
          Scan again
        </Button>
      </div>

      <div className="ac-acc-list">
        {accounts.detected.map((d) => {
          const linked = accounts.accounts.find((a) => a.id === d.linkedAccountId)
          const who = d.org ? `${d.email ?? ''} · ${d.org}` : (d.email ?? '')
          return (
            <div key={d.configDir} className="ac-acc-detected">
              <span className="ac-acc-detected__icon">
                <FolderIcon size={18} color="#A4AAB4" />
              </span>
              <div className="ac-acc-detected__info">
                <span className="ac-acc-mono ac-acc-detected__dir">{d.configDir}</span>
                {d.signedIn ? (
                  <span className="ac-acc-detected__who">{who}</span>
                ) : (
                  <span className="ac-acc-detected__who ac-acc-detected__who--warn">
                    Folder set in VS Code, not signed in yet
                  </span>
                )}
                <span className="ac-acc-detected__src">{`Found in: ${d.sources.join(', ')}`}</span>
              </div>
              {d.linkedAccountId ? (
                <span className="ac-acc-pill">
                  <CheckIcon size={12} />
                  {`Linked as ${linked?.name ?? d.linkedAccountId}`}
                </span>
              ) : d.signedIn ? (
                <Button variant="accent2" onClick={() => linkDetected(d.configDir)}>
                  Use this
                </Button>
              ) : (
                <Button variant="warn" onClick={() => startSignIn(d.configDir)}>
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
