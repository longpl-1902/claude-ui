import { useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import { useConsoleStore } from '../../store/useConsoleStore'
import { Button } from '../ui/Button'
import { RawTerminalPane } from './RawTerminalPane'
import './teamCenter.css'

const COMMANDS = ['/pause', '/stop', '/status']

export function LeadConsole(): JSX.Element {
  const team = useConsoleStore((s) => s.team)
  const rawOpen = useConsoleStore((s) => s.rawTerminalOpen)
  const toggleRaw = useConsoleStore((s) => s.toggleRawTerminal)
  const draft = useConsoleStore((s) => s.consoleDraft)
  const setDraft = useConsoleStore((s) => s.setConsoleDraft)
  const submit = useConsoleStore((s) => s.submitConsole)

  const live = useConsoleStore((s) => s.teamMode === 'live')
  const logRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const onScroll = (): void => {
    const el = logRef.current
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  const lineCount = team.console.length
  useEffect(() => {
    const el = logRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [lineCount, rawOpen])

  const who = (id: string): { name: string; color: string } => {
    if (id === 'you') return { name: 'you', color: 'var(--ac-accent)' }
    const a = team.agents.find((x) => x.id === id)
    return { name: a?.name ?? id, color: a?.avatarColor ?? 'var(--ac-text-muted)' }
  }
  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit()
  }

  return (
    <section className="ac-tc-console">
      <div className="ac-tc-console__bar">
        <span className="ac-tc-dot" aria-hidden="true" />
        <h2>Lead console</h2>
        <span className="ac-tc-hint">all team events, newest last</span>
        <div className="ac-tc-spacer" />
        <Button size="sm" aria-pressed={rawOpen} onClick={toggleRaw}>
          Raw terminal
        </Button>
      </div>
      {rawOpen ? (
        <RawTerminalPane />
      ) : (
        <div className="ac-tc-log" ref={logRef} onScroll={onScroll}>
          {team.console.map((l, i) => {
            const w = who(l.who)
            return (
              <div key={i} className="ac-tc-line">
                <span className="ac-tc-line__t">{l.time}</span>
                <span className="ac-tc-line__who" style={{ color: w.color }}>
                  {w.name}
                </span>
                <span className="ac-tc-line__msg">{l.text}</span>
              </div>
            )
          })}
        </div>
      )}
      <form className="ac-tc-prompt" onSubmit={onSubmit}>
        <label htmlFor="ac-prompt">›</label>
        <input
          id="ac-prompt"
          type="text"
          aria-label="Message the lead"
          placeholder="Message the lead, @agent to talk to a teammate, / for commands"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <span className="ac-tc-kbd">Enter</span>
      </form>
      {live && <div className="ac-tc-hint ac-tc-prompt-hint">Sending prompts arrives in Phase 3b</div>}
      {draft.startsWith('/') && (
        <div className="ac-tc-cmds">
          {COMMANDS.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
    </section>
  )
}
