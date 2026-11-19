import { useEffect } from 'react'
import type { WindowSpec } from '@shared/types'
import { ChatView } from './components/chat/ChatView'
import { sessionProjectKey, useConsoleStore } from './store/useConsoleStore'
import './windowKinds.css'

/** Per-window choices that must not overwrite the main window's remembered ones (localStorage is shared). */
const MAIN_ONLY_KEYS = new Set(['ac.projectKey', 'ac.viewState', 'ac.centerView'])

/** Secondary windows read the shared storage but never write the main window's project / view choices. */
export function guardSecondaryStorage(): void {
  const proto = Storage.prototype
  const orig = proto.setItem
  proto.setItem = function (this: Storage, key: string, value: string): void {
    if (MAIN_ONLY_KEYS.has(key)) return
    orig.call(this, key, value)
  }
}

/** Pins the window to a project: whenever the store drifts to another project it is put back. */
export function usePinnedProject(projectKey: string | null): void {
  const current = useConsoleStore((s) => s.projectKey)
  const hasSessions = useConsoleStore((s) => s.sessions.length > 0)
  useEffect(() => {
    if (projectKey !== null && hasSessions && current !== projectKey) useConsoleStore.getState().setProject(projectKey)
  }, [projectKey, current, hasSessions])
}

/** Chat window: the project plus the one session this window was opened for, selected once the session list is known. */
export function ChatWindow({ spec }: { spec: Extract<WindowSpec, { kind: 'chat' }> }): JSX.Element {
  usePinnedProject(spec.projectKey)
  const [accountId = '', sessionId = ''] = spec.sessionRef.split('|')
  const known = useConsoleStore((s) => s.sessions.some((x) => x.sessionId === sessionId && x.accountId === accountId))
  const title = useConsoleStore((s) => s.sessions.find((x) => x.sessionId === sessionId)?.title)
  const projectName = useConsoleStore((s) => s.sessions.find((x) => sessionProjectKey(x) === spec.projectKey)?.project?.name)
  useEffect(() => {
    if (!known) return
    const st = useConsoleStore.getState()
    if (st.team.sessionId !== sessionId) void st.selectSession({ mode: 'session', accountId, sessionId })
    // Select once per window (selection is per window since T36); later changes in this window are followed, not fought.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known])
  return (
    <div className="ac-winchat">
      <header className="ac-header ac-winchat__bar">
        <span className="ac-header__title">{projectName ?? 'Chat'}</span>
        <span className="ac-header__sep">/</span>
        <span className="ac-header__team">{title ?? sessionId.slice(0, 8)}</span>
      </header>
      <div className="ac-winchat__body">
        <ChatView />
      </div>
    </div>
  )
}
