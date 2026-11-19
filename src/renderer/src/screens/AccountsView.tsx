import { AccountCards } from '@renderer/components/accounts/AccountCards'
import { AccountPolicies } from '@renderer/components/accounts/AccountPolicies'
import { AccountsHeader } from '@renderer/components/accounts/AccountsHeader'
import { DetectedLogins } from '@renderer/components/accounts/DetectedLogins'
import { FolderRules } from '@renderer/components/accounts/FolderRules'
import { RunningNow } from '@renderer/components/accounts/RunningNow'
import './AccountsView.css'

export function AccountsView() {
  return (
    <div className="ac-accounts">
      <AccountsHeader />
      <main className="ac-acc-main">
        <div className="ac-acc-intro">
          <h1 className="ac-acc-h1">Claude accounts</h1>
          <p className="ac-acc-intro__text">
            Each account signs in once and keeps its own login in a separate config folder. A team always runs
            on one account, so company work and personal work never mix.
          </p>
        </div>
        <DetectedLogins />
        <AccountCards />
        <FolderRules />
        <AccountPolicies />
        <RunningNow />
      </main>
    </div>
  )
}
