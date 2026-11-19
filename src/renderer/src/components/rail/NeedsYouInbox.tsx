import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { AccountView, AttentionItem } from '@shared/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { HooksDialog } from '../team/HooksDialog'
import { sortItems, useAttentionStore } from '../../store/useAttentionStore'
import { useConsoleStore } from '../../store/useConsoleStore'
import { useControlStore } from '../../store/useControlStore'
import './rail.css'

/** "12m", "1h 05m", "2d": time an item has waited. */
export function formatWait(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000))
  if (min < 1) return '<1m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${String(min % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d`
}

const accountOf = (accounts: AccountView[], id: string): AccountView | undefined =>
  id === '' ? accounts.find((a) => a.isDefaultDir) : accounts.find((a) => a.id === id)

/** Items the user may answer here: a permission prompt of a session this app controls. */
export const canAnswerHere = (i: AttentionItem): boolean =>
  i.kind === 'permission' && !i.external && !!i.controlId && !!i.requestId

function InboxRow({ item, onGo }: { item: AttentionItem; onGo: () => void }): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const nowMs = useConsoleStore((s) => s.nowMs)
  const answer = useControlStore((s) => s.answer)
  const focusItem = useAttentionStore((s) => s.focusItem)
  const rootOf = useAttentionStore((s) => s.snapshot.projects.find((p) => p.key === item.projectKey)?.root)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const account = accountOf(accounts, item.accountId)
  const answerable = canAnswerHere(item)
  // F1: no Allow until the full input and cwd have been shown.
  const reviewed = open

  const send = async (behavior: 'allow' | 'deny', scope: 'once' | 'session'): Promise<void> => {
    if (!answerable || busy || (behavior === 'allow' && !reviewed)) return
    setBusy(true)
    setError('')
    try {
      const r = await answer(item.controlId!, item.requestId!, { behavior, scope, ...(behavior === 'deny' ? { message: 'Denied from the Needs you inbox' } : {}) })
      if (!r.ok) setError(`Could not answer: ${r.reason ?? 'unknown'}`)
    } finally {
      setBusy(false)
    }
  }
  const go = (): void => {
    onGo()
    void focusItem(item.id)
  }
  const editorRoot = item.cwd ?? rootOf
  const onKey = (e: KeyboardEvent<HTMLLIElement>): void => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
    const k = e.key.toLowerCase()
    if (k === 'a' && answerable && reviewed) {
      e.preventDefault()
      void send('allow', 'once')
    } else if (k === 'd' && answerable) {
      e.preventDefault()
      void send('deny', 'once')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go()
    }
  }

  return (
    <li
      className={`ac-inbox__row is-${item.severity}`}
      tabIndex={0}
      aria-label={`${item.projectName}, ${item.agentName}: ${item.detail}`}
      data-item={item.id}
      onKeyDown={onKey}
    >
      <div className="ac-inbox__head">
        <span className="ac-inbox__dot" style={{ background: account?.color ?? 'var(--ac-text-muted)' }} title={account?.name ?? 'Account'} />
        <strong className="ac-inbox__project">{item.projectName}</strong>
        <span className="ac-inbox__agent">{item.agentName}</span>
        <span className="ac-inbox__wait" title="Waiting time">
          {formatWait(nowMs - item.sinceMs)}
        </span>
      </div>
      <div className="ac-inbox__reason">
        {item.toolName && answerable ? <span className="ac-inbox__tool">{item.toolName}: </span> : null}
        {item.detail}
      </div>
      {answerable && open && (
        <div className="ac-inbox__review">
          <pre className="ac-inbox__input" aria-label="Full tool input">{item.input ?? item.detail}</pre>
          <div className="ac-inbox__cwd">Runs in: {item.cwd ?? 'unknown folder'}</div>
        </div>
      )}
      {item.external && (
        <div className="ac-inbox__ext">external - answer in VS Code or its terminal</div>
      )}
      {error && (
        <div className="ac-inbox__err" role="alert">
          {error}
        </div>
      )}
      <div className="ac-inbox__actions">
        {answerable ? (
          <>
            {!open && (
              <Button size="sm" variant="secondary" aria-expanded={false} onClick={() => setOpen(true)}>
                Expand to review
              </Button>
            )}
            {open && (
              <Button size="sm" variant="secondary" aria-expanded onClick={() => setOpen(false)}>
                Hide details
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={!reviewed || busy}
              title={reviewed ? undefined : 'Expand to review the full command first'}
              onClick={() => void send('allow', 'once')}
            >
              Allow
            </Button>
            {item.canAllowSession && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!reviewed || busy}
                title={reviewed ? 'Allow this tool for the rest of this session' : 'Expand to review the full command first'}
                onClick={() => void send('allow', 'session')}
              >
                Allow for this session
              </Button>
            )}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void send('deny', 'once')}>
              Deny
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="secondary" onClick={go}>
          Go to
        </Button>
        {item.external && editorRoot && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void window.api?.worktree?.openInEditor?.(editorRoot)?.catch?.(() => undefined)}
          >
            Open in VS Code
          </Button>
        )}
      </div>
      {!item.external && !answerable && <div className="ac-inbox__hint">Answer in the lead console after jumping there.</div>}
    </li>
  )
}

/** Header button "● N need you" + the global inbox. Works on every screen (F4). */
export function NeedsYouButton({ inSession }: { inSession?: number } = {}): JSX.Element {
  const snapshot = useAttentionStore((s) => s.snapshot)
  const setDnd = useAttentionStore((s) => s.setDnd)
  const dnd = useAttentionStore((s) => s.prefs.dnd)
  const [open, setOpen] = useState(false)
  const [hooksOpen, setHooksOpen] = useState(false)

  useEffect(() => useAttentionStore.getState().init(), [])

  const sorted = useMemo(() => sortItems(snapshot.items), [snapshot.items])
  const blocked = sorted.filter((i) => i.severity === 'blocked')
  const ready = sorted.filter((i) => i.severity === 'idle')
  const noHooks = snapshot.projects.filter((p) => p.liveSessions > 0 && !p.hooksActive).length

  return (
    <>
      <button
        type="button"
        className={`ac-needs${blocked.length > 0 ? ' is-hot' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={[`${blocked.length} across all projects`, inSession !== undefined ? `${inSession} in this session` : '', ready.length > 0 ? `${ready.length} ready for you` : ''].filter(Boolean).join(' · ')}
        onClick={() => setOpen(true)}
      >
        <span className="ac-needs__dot" aria-hidden="true">
          ●
        </span>{' '}
        {blocked.length} need you
        {ready.length > 0 && <span className="ac-needs__ready"> · {ready.length} ready</span>}
      </button>
      <Dialog
        open={open}
        title="Needs you"
        closeButton
        onClose={() => setOpen(false)}
        footer={
          <div className="ac-inbox__footer">
            <label className="ac-inbox__dnd">
              <input type="checkbox" checked={dnd} onChange={(e) => setDnd(e.target.checked)} /> Do not disturb (no toasts)
            </label>
            {noHooks > 0 && (
              <div className="ac-inbox__nohooks">
                {noHooks} project{noHooks === 1 ? '' : 's'} without hooks — sub-agent prompts not detected ·{' '}
                <button
                  type="button"
                  className="ac-inbox__link"
                  onClick={() => {
                    setOpen(false)
                    setHooksOpen(true)
                  }}
                >
                  Install hooks…
                </button>
              </div>
            )}
          </div>
        }
      >
        <div className="ac-inbox">
          {sorted.length === 0 && <p className="ac-inbox__empty">Nothing needs you right now.</p>}
          {blocked.length > 0 && (
            <section aria-labelledby="ac-inbox-blocked">
              <h3 id="ac-inbox-blocked" className="ac-inbox__h is-blocked">
                Blocked <span className="ac-inbox__count is-blocked">({blocked.length})</span>
              </h3>
              <ul className="ac-inbox__list">
                {blocked.map((i) => (
                  <InboxRow key={i.id} item={i} onGo={() => setOpen(false)} />
                ))}
              </ul>
            </section>
          )}
          {ready.length > 0 && (
            <section aria-labelledby="ac-inbox-ready">
              <h3 id="ac-inbox-ready" className="ac-inbox__h is-ready">
                Ready for you ({ready.length})
              </h3>
              <ul className="ac-inbox__list">
                {ready.map((i) => (
                  <InboxRow key={i.id} item={i} onGo={() => setOpen(false)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </Dialog>
      <HooksDialog open={hooksOpen} onClose={() => setHooksOpen(false)} />
    </>
  )
}
