import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { CheckIcon } from '@renderer/components/ui/Icons'
import { TerminalView } from '@renderer/components/terminal/TerminalView'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import './signIn.css'

const STEP_COLORS = {
  done: { ring: '#5ED3A8', fill: '#5ED3A8', num: '#0E0F11', text: '#C9CDD4' },
  current: { ring: '#F2A541', fill: 'transparent', num: '#F2A541', text: '#E6E7EA' },
  todo: { ring: '#5C636E', fill: 'transparent', num: '#8E95A0', text: '#8E95A0' }
}

function errorMessage(reason?: string): string {
  switch (reason) {
    case 'login-exited':
      return 'The sign-in process ended before finishing.'
    case 'pty-unavailable':
      return 'Terminal support (node-pty) is not available.'
    case 'claude-not-found':
      return 'Could not find the claude CLI.'
    default:
      return `Sign-in failed (${reason ?? 'unknown'}).`
  }
}

export function SignInPanel(): JSX.Element | null {
  const signIn = useConsoleStore((s) => s.signIn)
  const accounts = useConsoleStore((s) => s.accounts)
  const checkSignIn = useConsoleStore((s) => s.checkSignIn)
  const reopenSignIn = useConsoleStore((s) => s.reopenSignIn)
  const cancelSignIn = useConsoleStore((s) => s.cancelSignIn)
  const closeSignInPanel = useConsoleStore((s) => s.closeSignInPanel)
  const linkDetected = useConsoleStore((s) => s.linkDetected)
  const [showTerm, setShowTerm] = useState(false)
  if (!signIn.panelOpen || signIn.step === 'none') return null

  const configDir = signIn.configDir ?? ''
  const det = accounts.detected.find((d) => d.configDir === configDir)
  const account =
    accounts.accounts.find((a) => a.configDir === configDir) ??
    accounts.accounts.find((a) => a.id === det?.linkedAccountId)
  const done = signIn.step === 'done'
  const error = signIn.step === 'error'
  const cur = done ? 3 : 1
  const labels = [`Folder ${configDir}`, 'Sign in on claude.ai', 'Ready to use']
  const cmd =
    det?.isDefaultDir || configDir === '~/.claude'
      ? 'claude auth login'
      : `CLAUDE_CONFIG_DIR=${configDir} claude auth login`
  const email = signIn.email ?? det?.email ?? ''

  return (
    <div className="ac-acc-flow">
      <ol className="ac-acc-steps">
        {labels.map((label, i) => {
          const c = done || i < cur ? STEP_COLORS.done : i === cur ? STEP_COLORS.current : STEP_COLORS.todo
          const isErr = error && i === 1
          return (
            <li
              key={label}
              className={`ac-acc-step${isErr ? ' ac-acc-step--error' : ''}`}
              style={{ color: c.text }}
              aria-current={!done && i === cur ? 'step' : undefined}
            >
              <span className="ac-acc-step__n" style={{ borderColor: c.ring, background: c.fill, color: c.num }}>
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
      {done ? (
        <div className="ac-acc-flow__done">
          <span className="ac-acc-flow__check">
            <CheckIcon size={16} color="#5ED3A8" />
          </span>
          <div className="ac-acc-flow__donetext">
            <span className="ac-acc-flow__title" aria-live="polite">{`Signed in as ${email}`}</span>
            {account ? <span className="ac-acc-sub">{`Saved as “${account.name}”.`}</span> : null}
          </div>
          {!account && (
            <Button variant="accent2" onClick={() => void linkDetected(configDir)}>
              Use this
            </Button>
          )}
          <Button variant="secondary" onClick={closeSignInPanel}>
            Done
          </Button>
        </div>
      ) : error ? (
        <div className="ac-acc-flow__body">
          <span className="ac-acc-flow__error" role="alert">
            {errorMessage(signIn.reason)}
          </span>
          <div className="ac-acc-row">
            <Button variant="warn" onClick={() => void reopenSignIn()}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => void cancelSignIn()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="ac-acc-flow__body">
          <span className="ac-acc-flow__title" aria-live="polite">Finish signing in your browser</span>
          <span className="ac-acc-flow__text">
            Claude Code opened the sign-in page in your browser. This screen updates by itself when you are
            done.
          </span>
          <span className="ac-acc-cmd">{cmd}</span>
          <div className="ac-acc-row">
            <Button variant="warn" onClick={() => void checkSignIn()}>
              Check now
            </Button>
            <Button variant="secondary" onClick={() => void reopenSignIn()}>
              Open browser again
            </Button>
            <Button variant="ghost" onClick={() => void cancelSignIn()}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              disabled={!signIn.ptyId}
              aria-expanded={showTerm}
              onClick={() => setShowTerm((v) => !v)}
            >
              {showTerm ? 'Hide terminal' : 'Show terminal'}
            </Button>
          </div>
          {showTerm && signIn.ptyId ? (
            <div className="ac-acc-flow__term">
              <TerminalView ptyId={signIn.ptyId} ariaLabel="Sign-in terminal" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
