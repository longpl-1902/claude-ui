import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@renderer/components/ui/Button'
import { Avatar } from '@renderer/components/ui/Avatar'
import { LockIcon } from '@renderer/components/ui/Icons'
import { selectTokensToday, useConsoleStore } from '@renderer/store/useConsoleStore'
import { formatTokens } from '@shared/format'
import { RowMenu } from '@renderer/components/extensions/RowMenu'
import { AccountEditor } from './AccountEditor'
import './manage.css'

export interface AccountCardsProps {
  adding: boolean
  onAdd(): void
  onCloseAdd(): void
}

function TokensToday({ accountId }: { accountId: string }): JSX.Element {
  const t = useConsoleStore(useShallow(selectTokensToday(accountId)))
  return (
    <div className="ac-acc-usage__row">
      <span className="ac-acc-usage__label">Tokens used today</span>
      <span title="input + output + cache writes; cache reads shown separately">
        {t === undefined ? '—' : formatTokens(t.headline)}
        {t !== undefined && t.cacheRead > 0 && (
          <span style={{ color: 'var(--ac-text-muted)' }}> +{formatTokens(t.cacheRead)} cached</span>
        )}
      </span>
    </div>
  )
}

export function AccountCards({ adding, onAdd, onCloseAdd }: AccountCardsProps): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const setDefaultAccount = useConsoleStore((s) => s.setDefaultAccount)
  const startSignIn = useConsoleStore((s) => s.startSignIn)
  const removeProfile = useConsoleStore((s) => s.removeProfile)
  const [editingId, setEditingId] = useState<string>()
  const [removeError, setRemoveError] = useState<string>()

  async function remove(id: string, name: string): Promise<void> {
    if (!window.confirm(`Remove "${name}"? Its login stays in its config folder.`)) return
    const r = await removeProfile(id)
    setRemoveError(r.ok ? undefined : (r.reason ?? 'Could not remove the account.'))
  }

  return (
    <section className="ac-acc-cards" aria-label="Accounts">
      {accounts.accounts.length === 0 && !adding && (
        <div className="ac-acc-empty-block">
          <p className="ac-acc-empty">No accounts yet. Use a detected login above, or add one.</p>
          <div>
            <Button variant="dashed" onClick={onAdd}>
              + Add account
            </Button>
          </div>
        </div>
      )}
      {accounts.accounts.map((a) => {
        const isDefault = a.id === accounts.defaultAccountId
        return (
          <div key={a.id} className="ac-acc-card" style={{ borderColor: isDefault ? a.color : undefined }}>
            <div className="ac-acc-card__head">
              <Avatar initials={a.name.charAt(0)} color={a.color} size={40} shape="circle" />
              <div className="ac-acc-card__who">
                <span className="ac-acc-card__name">{a.name}</span>
                <span className="ac-acc-sub">{a.email ?? 'Not signed in'}</span>
              </div>
              {a.kind && <span className="ac-acc-tag">{a.kind === 'company' ? 'Company' : 'Personal'}</span>}
              {a.locked && (
                <span className="ac-acc-badge ac-acc-badge--lock" title="In use by a running session">
                  <LockIcon size={12} /> Locked
                  <span className="ac-sr-only"> (In use by a running session)</span>
                </span>
              )}
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
                <span style={{ color: a.signedIn ? 'var(--ac-ok-text)' : 'var(--ac-text-muted)' }}>
                  {a.signedIn ? 'Signed in' : 'Not connected'}
                </span>
              </div>
              <div className="ac-acc-field ac-acc-field--full">
                <span className="ac-acc-field__label">Config folder</span>
                <span className="ac-acc-mono">
                  {a.configDir}
                  {a.isDefaultDir ? ' (default folder)' : ''}
                </span>
              </div>
            </div>

            <div className="ac-acc-usage">
              <TokensToday accountId={a.id} />
            </div>

            {editingId === a.id ? (
              <AccountEditor mode="edit" initial={a} onClose={() => setEditingId(undefined)} />
            ) : (
              <div className="ac-acc-row">
                {!isDefault && <Button onClick={() => setDefaultAccount(a.id)}>Set as default</Button>}
                <RowMenu
                  label={`More actions for ${a.name}`}
                  items={[
                    ...(a.locked ? [] : [{ label: 'Sign in again', onSelect: () => startSignIn(a.configDir) }]),
                    { label: 'Rename & color', onSelect: () => setEditingId(a.id) },
                    { label: 'Remove…', danger: true, onSelect: () => void remove(a.id, a.name) }
                  ]}
                />
              </div>
            )}
          </div>
        )
      })}
      {adding && (
        <div className="ac-acc-card ac-acc-card--edit">
          <h2 className="ac-acc-h2 ac-acc-h2--sm">Add account</h2>
          <AccountEditor mode="create" onClose={onCloseAdd} />
        </div>
      )}
      {removeError && (
        <span className="ac-acc-error" role="alert">
          {removeError}
        </span>
      )}
    </section>
  )
}
