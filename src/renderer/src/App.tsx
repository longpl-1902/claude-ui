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
    const st = useConsoleStore.getState()
    api.team.getSnapshot().then(hydrateTeam).catch(() => {})
    api.transcripts
      ?.getSelection?.()
      .then(st.setSelection)
      .catch(() => {})
    void st.refreshSessions()
    api.usage
      ?.getToday?.()
      .then(st.applyUsage)
      .catch(() => {})
    void st.refreshAccounts()
    const offChanged = api.accounts?.onChanged?.(st.hydrateAccounts)
    const offStatus = api.accounts?.onSignInStatus?.(st.applySignInStatus)
    const offTeam = api.team.onChanged?.(hydrateTeam)
    const offSessions = api.transcripts?.onSessionsChanged?.(st.setSessions)
    const offUsage = api.usage?.onChanged?.(st.applyUsage)
    const timer = setInterval(() => st.tick(), 5000)
    return () => {
      offChanged?.()
      offStatus?.()
      offTeam?.()
      offSessions?.()
      offUsage?.()
      clearInterval(timer)
    }
  }, [hydrateTeam])

  return screen === 'team' ? <TeamView /> : <AccountsView />
}
