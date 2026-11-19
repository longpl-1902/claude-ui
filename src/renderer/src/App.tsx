import { useEffect } from 'react'
import { AccountsView } from '@renderer/screens/AccountsView'
import { TeamView } from '@renderer/screens/TeamView'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

export default function App() {
  const screen = useConsoleStore((s) => s.screen)
  const hydrateTeam = useConsoleStore((s) => s.hydrateTeam)

  useEffect(() => {
    document.title = 'Agent Console'
    const api = window.api
    if (!api) return
    api.team.getSnapshot().then(hydrateTeam).catch(() => {})
    const st = useConsoleStore.getState()
    void st.refreshAccounts()
    const offChanged = api.accounts?.onChanged?.(st.hydrateAccounts)
    const offStatus = api.accounts?.onSignInStatus?.(st.applySignInStatus)
    return () => {
      offChanged?.()
      offStatus?.()
    }
  }, [hydrateTeam])

  return screen === 'team' ? <TeamView /> : <AccountsView />
}
