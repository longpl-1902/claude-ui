import { useEffect } from 'react'
import { AccountsView } from '@renderer/screens/AccountsView'
import { TeamView } from '@renderer/screens/TeamView'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

export default function App() {
  const screen = useConsoleStore((s) => s.screen)
  const hydrateTeam = useConsoleStore((s) => s.hydrateTeam)
  const hydrateAccounts = useConsoleStore((s) => s.hydrateAccounts)

  useEffect(() => {
    document.title = 'Agent Console'
    if (!window.api) return
    window.api.team.getSnapshot().then(hydrateTeam).catch(() => {})
    window.api.accounts.getSnapshot().then(hydrateAccounts).catch(() => {})
  }, [hydrateTeam, hydrateAccounts])

  return screen === 'team' ? <TeamView /> : <AccountsView />
}
