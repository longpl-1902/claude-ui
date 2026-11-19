import { Button } from '@renderer/components/ui/Button'
import { Avatar } from '@renderer/components/ui/Avatar'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import { formatTokens } from '@shared/format'

export function AccountCards(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const setDefaultAccount = useConsoleStore((s) => s.setDefaultAccount)
  const startSignIn = useConsoleStore((s) => s.startSignIn)
  return (
    <section className="ac-acc-cards">
      {accounts.accounts.map((a) => {
        const isDefault = a.id === accounts.defaultAccountId
        return (
          <div key={a.id} className="ac-acc-card" style={{ borderColor: isDefault ? a.color : undefined }}>
            <div className="ac-acc-card__head">
              <Avatar initials={a.name.charAt(0)} color={a.color} size={40} shape="circle" />
              <div className="ac-acc-card__who">
                <span className="ac-acc-card__name">{a.name}</span>
                <span className="ac-acc-sub">{a.email}</span>
              </div>
              {isDefault && <span className="ac-acc-badge">Default</span>}
            </div>

            <div className="ac-acc-fields">
              {a.plan !== undefined && (
                <div className="ac-acc-field">
                  <span className="ac-acc-field__label">Plan</span>
                  <span>{a.plan}</span>
                </div>
              )}
              <div className="ac-acc-field">
                <span className="ac-acc-field__label">Status</span>
                <span style={{ color: a.signedIn ? '#5ED3A8' : '#A4AAB4' }}>
                  {a.signedIn ? 'Signed in' : 'Not connected'}
                </span>
              </div>
              <div className="ac-acc-field ac-acc-field--full">
                <span className="ac-acc-field__label">Config folder</span>
                <span className="ac-acc-mono">{a.configDir}</span>
              </div>
            </div>

            <div className="ac-acc-usage">
              {a.signedIn && a.tokensToday !== undefined ? (
                <div className="ac-acc-usage__row">
                  <span className="ac-acc-usage__label">Tokens used today</span>
                  <span>{formatTokens(a.tokensToday)}</span>
                </div>
              ) : a.signedIn ? (
                <span className="ac-acc-sub">Usage not available</span>
              ) : (
                <span className="ac-acc-sub">Sign in from Detected logins above to see usage.</span>
              )}
            </div>

            <div className="ac-acc-row">
              <Button disabled={isDefault} onClick={() => setDefaultAccount(a.id)}>
                Set as default
              </Button>
              <Button onClick={() => startSignIn(a.configDir)}>Sign in again</Button>
              <Button>Rename &amp; color</Button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
