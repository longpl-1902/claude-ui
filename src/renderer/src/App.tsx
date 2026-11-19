import { useEffect } from 'react'
import { AccountsView } from '@renderer/screens/AccountsView'
import { TeamView } from '@renderer/screens/TeamView'
import { ShortcutsHelp } from '@renderer/components/ui/ShortcutsHelp'
import { setShortcutBridge, useShortcuts } from '@renderer/hooks/useShortcuts'
import { useAttentionStore } from '@renderer/store/useAttentionStore'
import { useRailStore } from '@renderer/store/useRailStore'
import { useSwitcherStore } from '@renderer/store/useSwitcherStore'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore'

export default function App() {
  const screen = useConsoleStore((s) => s.screen)
  const hydrateTeam = useConsoleStore((s) => s.hydrateTeam)
  // Git watch root: the project root of the viewed session when it is a git project, else the team cwd (demo: none).
  const watchRoot = useConsoleStore((s) => {
    if (s.teamMode === 'demo') return null
    const project = s.sessions.find((x) => x.sessionId === s.team.sessionId)?.project
    return project?.git ? project.root : (s.team.cwd ?? null)
  })

  useShortcuts()

  // Connect the global shortcuts (T18) to the rail / inbox / switcher stores (T22). getState() at call time.
  useEffect(() => {
    setShortcutBridge({
      goToPinned: (n) => useRailStore.getState().goToPinned(n),
      focusNext: () => useAttentionStore.getState().focusNext(),
      focusPrev: () => useAttentionStore.getState().focusPrev(),
      openSwitcher: () => useSwitcherStore.getState().open()
    })
  }, [])

  useEffect(() => {
    const offControl = useControlStore.getState().init()
    const offWorkspace = useWorkspaceStore.getState().init()
    return () => {
      offControl()
      offWorkspace()
    }
  }, [])

  useEffect(() => {
    void useWorkspaceStore.getState().watch(watchRoot)
  }, [watchRoot])

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

  return (
    <>
      {screen === 'team' ? <TeamView /> : <AccountsView />}
      <ShortcutsHelp />
    </>
  )
}
