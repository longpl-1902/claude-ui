import { useEffect, useRef, useState } from 'react'
import { shortenPathsInText } from '@shared/displayPath'
import { useConsoleStore } from '../../store/useConsoleStore'
import { selectControlForSession, selectDraftControl, useControlStore } from '../../store/useControlStore'
import { useMaxWidth } from '../../store/useLayoutStore'
import { useWindowsStore } from '../../store/useWindowsStore'
import { chatSpecForCurrent, getWindowSpec } from '../../windowActions'
import { classifyLine } from '../team/LeadConsole'
import { useTitlebarInset } from '../../hooks/useTitlebarInset'
import { useCenterViewStore } from '../../store/useCenterViewStore'
import { Button } from '../ui/Button'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { midEllipsis } from '../ui/midEllipsis'
import { PermissionCard } from '../team/PermissionCard'
import { ControlComposer } from '../team/Composer'
import { CopyButton } from './CopyButton'
import { Markdown } from './Markdown'
import { ToolCallRow } from './ToolCallRow'
import './chat.css'

/** Under this width the conversation column uses the full width. */
export const CHAT_NARROW = 900

const platform = (): string => (typeof navigator !== 'undefined' && /win/i.test(navigator.platform) ? 'win32' : 'posix')

/** Full-height conversation view of the selected session. Nothing is sent except on an explicit Enter/Send (R-19). */
function ChatViewContent(): JSX.Element {
  useTitlebarInset()
  const setView = useCenterViewStore((s) => s.setView)
  const narrow = useMaxWidth(CHAT_NARROW)
  const team = useConsoleStore((s) => s.team)
  const demo = useConsoleStore((s) => s.teamMode === 'demo')
  const summary = useConsoleStore((s) => s.sessions.find((x) => x.sessionId === team.sessionId))

  const bound = useControlStore(selectControlForSession(team.sessionId))
  const draftControl = useControlStore(selectDraftControl)
  const control = demo ? undefined : (bound ?? draftControl)
  const stream = useControlStore((s) => (control ? s.streams[control.id] : undefined))
  const answer = useControlStore((s) => s.answer)

  const controlled = control !== undefined && control.state !== 'exited'
  const winSpec = getWindowSpec()
  const external = !demo && !controlled && control === undefined && team.source === 'live' && !!team.sessionId
  const projectRoot = summary?.project?.root ?? team.cwd

  const logRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [newBelow, setNewBelow] = useState(false)
  const onScroll = (): void => {
    const el = logRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom.current) setNewBelow(false)
  }
  const toBottom = (): void => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setNewBelow(false)
  }
  const perms = stream?.permissions ?? []
  const notices = stream?.notices ?? []
  const tail = (stream?.typing?.text.length ?? 0) + notices.length + perms.length
  const lineCount = team.console.length
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      toBottom()
      return
    }
    if (atBottom.current) toBottom()
    else setNewBelow(true)
  }, [lineCount, tail])

  const who = (id: string): { name: string; color: string; isYou: boolean } => {
    if (id === 'you') return { name: 'you', color: 'var(--ac-accent)', isYou: true }
    const a = team.agents.find((x) => x.id === id)
    return { name: a?.name ?? id, color: a?.avatarColor ?? 'var(--ac-text-muted)', isYou: false }
  }
  const plat = platform()
  const display = (t: string): string => shortenPathsInText(t, { ...(projectRoot ? { root: projectRoot } : {}), platform: plat })

  const stateLabel = demo ? 'demo' : controlled ? (control.state === 'draft' ? 'new session' : control.state) : external ? '' : 'no session'
  const disabled = !demo && !controlled
  const where = summary?.entrypoint?.toLowerCase().includes('vscode') ? 'VS Code' : 'a terminal'
  const reason = external
    ? summary?.live
      ? `Runs in ${where}. Agent Console can't type into it.`
      : "Not running. Agent Console can't type into it until you resume or fork it."
    : 'No session is running here. Switch to Team view to start one.'

  let prevWho = ''
  const rows = team.console.map((l, i) => {
    const w = who(l.who)
    const kind = classifyLine(l)
    const head = prevWho !== l.who
    prevWho = l.who
    return (
      <div key={i} className={`ac-chat__msg${w.isYou ? ' ac-chat__msg--you' : ''}`} data-kind={kind}>
        {head && (
          <div className="ac-chat__speaker">
            <span className="ac-chat__who" title={w.name}>
              <i className="ac-chat__dot" style={{ background: w.color }} aria-hidden="true" />
              {midEllipsis(w.name, 28)}
            </span>
            <span className="ac-chat__time">{l.time}</span>
          </div>
        )}
        {kind === 'tool' ? (
          <ToolCallRow text={l.text} {...(projectRoot ? { projectRoot } : {})} platform={plat} />
        ) : (
          <div className="ac-chat__bubble">
            {w.isYou ? <p className="ac-chat__plain">{display(l.text)}</p> : <Markdown text={display(l.text)} />}
            <CopyButton className="ac-chat__copy" text={l.text} label="message" />
          </div>
        )}
      </div>
    )
  })

  return (
    <section className="ac-chat" data-narrow={narrow ? 'true' : 'false'} aria-label="Chat">
      <header className="ac-chat__bar">
        <h2>{team.title ?? team.teamName ?? 'Chat'}</h2>
        {team.sessionId && (
          <span className="ac-chat__sid">
            <code>{team.sessionId.slice(0, 8)}</code>
            <CopyButton className="ac-copy--always" text={team.sessionId} label="session id" />
          </span>
        )}
        {team.sessionId && !demo && winSpec.kind !== 'chat' && (
          <button
            type="button"
            className="ac-chat__popout"
            title="Open this chat in its own window (Ctrl+Shift+N)"
            onClick={() => {
              const spec = chatSpecForCurrent()
              if (spec) void useWindowsStore.getState().open(spec)
            }}
          >
            Open in new window
          </button>
        )}
      </header>
      <div className="ac-chat__logwrap">
        <div className="ac-chat__log" ref={logRef} onScroll={onScroll} role="log" aria-label="Conversation" aria-live="off">
          <div className="ac-chat__col">
            {rows}
            {notices.map((n, i) => (
              <div key={`n${i}`} className={`ac-chat__notice ac-chat__notice--${n.level}`}>
                {display(n.text)}
              </div>
            ))}
            {control &&
              perms.map((p) => (
                <div key={`p${p.requestId}`} className="ac-chat__permmark">
                  Waiting for your answer: {p.displayName}
                </div>
              ))}
            {stream?.typing && (
              <div className="ac-chat__msg" data-testid="chat-typing">
                <div className="ac-chat__speaker">
                  <span className="ac-chat__who" title={who('lead').name}>
                    <i className="ac-chat__dot" style={{ background: who('lead').color }} aria-hidden="true" />
                    {midEllipsis(who('lead').name, 28)}
                  </span>
                </div>
                <div className="ac-chat__bubble">
                  <Markdown text={display(stream.typing.text)} />
                </div>
              </div>
            )}
            {!stream?.typing && stream?.thinking && <div className="ac-chat__notice">thinking...</div>}
            {team.console.length === 0 && !stream?.typing && notices.length === 0 && (
              <p className="ac-chat__empty">No messages yet.</p>
            )}
          </div>
        </div>
        {newBelow && (
          <button type="button" className="ac-chat__pill" onClick={toBottom}>
            {'↓ New messages'}
          </button>
        )}
      </div>
      <div className="ac-chat__dock">
        <div className="ac-chat__col">
          {control && perms.length > 0 && (
            <div className="ac-tc-perms">
              {perms.map((p) => (
                <PermissionCard key={p.requestId} prompt={p} controlId={control.id} onAnswer={(a) => void answer(control.id, p.requestId, a)} />
              ))}
            </div>
          )}
          {external ? (
            <div className="ac-chat__external">
              <p>{reason}</p>
              {winSpec.kind === 'chat' ? (
                // A chat pop-out has no Team view: the fork lives in the project window.
                winSpec.projectKey && (
                  <Button size="sm" variant="primary" onClick={() => void useWindowsStore.getState().open({ kind: 'project', projectKey: winSpec.projectKey })}>
                    Fork it in the project window
                  </Button>
                )
              ) : (
                <Button size="sm" variant="primary" onClick={() => setView('team')}>
                  Fork it in Team view
                </Button>
              )}
            </div>
          ) : (
            <ControlComposer
              {...(control ? { control } : {})}
              demo={demo}
              disabled={disabled}
              disabledReason={reason}
              stateLabel={stateLabel}
              placeholder={disabled ? '' : 'Message the lead, or @agent to talk to a teammate'}
            />
          )}
        </div>
      </div>
    </section>
  )
}

export function ChatView(): JSX.Element {
  return (
    <ErrorBoundary label="The chat view">
      <ChatViewContent />
    </ErrorBoundary>
  )
}
