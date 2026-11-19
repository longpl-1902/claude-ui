import { specFromSearch } from '@shared/windowSpec'
import type { WindowSpec } from '@shared/types'
import { useCenterViewStore } from './store/useCenterViewStore'
import { useConsoleStore } from './store/useConsoleStore'
import { useWindowsStore } from './store/useWindowsStore'

/** The kind of THIS window, from the query the main process loaded it with (missing = main window). */
export function getWindowSpec(search: string = typeof window === 'undefined' ? '' : window.location.search): WindowSpec {
  return specFromSearch(search)
}

/** The chat window of the session on screen, or null in demo mode / without a live session. */
export function chatSpecForCurrent(): Extract<WindowSpec, { kind: 'chat' }> | null {
  const st = useConsoleStore.getState()
  const sid = st.team.sessionId
  if (st.projectKey === null || st.teamMode !== 'live' || !sid) return null
  return { kind: 'chat', projectKey: st.projectKey, sessionRef: `${st.team.accountId}|${sid}` }
}

/** What Ctrl+Shift+N and the "Open in new window" buttons open for the current view. */
export function currentPopOutSpec(): WindowSpec | null {
  const st = useConsoleStore.getState()
  if (st.projectKey === null) return null
  const chatOpen = (useCenterViewStore.getState().byProject[st.projectKey] ?? 'team') === 'chat'
  return (chatOpen ? chatSpecForCurrent() : null) ?? { kind: 'project', projectKey: st.projectKey }
}

export function popOutCurrent(at?: { x: number; y: number }): void {
  const spec = currentPopOutSpec()
  if (spec) void useWindowsStore.getState().open(spec, at)
}
