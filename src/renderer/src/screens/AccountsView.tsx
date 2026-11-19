import { useState } from 'react'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import { AccountCards } from '@renderer/components/accounts/AccountCards'
import { AccountPolicies } from '@renderer/components/accounts/AccountPolicies'
import { AppearanceRow } from '@renderer/components/accounts/AppearanceRow'
import { AccountsHeader } from '@renderer/components/accounts/AccountsHeader'
import { DetectedLogins } from '@renderer/components/accounts/DetectedLogins'
import { FolderRules } from '@renderer/components/accounts/FolderRules'
import { RunningNow } from '@renderer/components/accounts/RunningNow'
import { ErrorBoundary } from '@renderer/components/ui/ErrorBoundary'
import './AccountsView.css'

function AccountsViewContent() {
  const [adding, setAdding] = useState(false)
  const accountsError = useConsoleStore((s) => s.accountsError)
  const clearAccountsError = useConsoleStore((s) => s.clearAccountsError)
  return (
    <div className="ac-accounts">
      <AccountsHeader onAdd={() => setAdding(true)} />
      <main className="ac-acc-main">
        <div className="ac-acc-intro">
          <h1 className="ac-acc-h1">Claude accounts</h1>
          <p className="ac-acc-intro__text">
            Each account signs in once and keeps its own login in a separate config folder. A team always runs
            on one account, so company work and personal work never mix.
          </p>
        </div>
        {accountsError && (
          <div className="ac-acc-error ac-acc-error--banner" role="alert">
            <span>{accountsError}</span>
            <button type="button" className="ac-acc-back" onClick={() => clearAccountsError()}>
              Dismiss
            </button>
          </div>
        )}
        <DetectedLogins />
        <AccountCards adding={adding} onAdd={() => setAdding(true)} onCloseAdd={() => setAdding(false)} />
        <FolderRules />
        <AccountPolicies />
        <AppearanceRow />
        <RunningNow />
      </main>
    </div>
  )
}

export function AccountsView() {
  return (
    <ErrorBoundary label="The accounts view">
      <AccountsViewContent />
    </ErrorBoundary>
  )
}
