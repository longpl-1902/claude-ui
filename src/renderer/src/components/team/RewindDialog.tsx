import { useEffect, useState } from 'react'
import type { ControlStartResult, OkResult, RewindPreview, UserTurnRef } from '@shared/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { isKnownReason, reasonText } from '../ui/reasonText'
import './controlBar.css'

export const BUSY_REASON = 'Wait for Claude to finish this turn (or interrupt it) before using checkpoints.'
export const REWIND_EXPLAIN =
  'Rewind restores files edited by Claude in this app session; the conversation is kept (use Fork to branch it).'

const why = (r?: string): string => (isKnownReason(r) ? reasonText(r) : `That did not work (${r ?? 'failed'}).`)

export interface RewindDialogProps {
  open: boolean
  onClose(): void
  busy: boolean
  checkpointing: boolean
  turns: UserTurnRef[]
  preview(uuid: string): Promise<RewindPreview>
  rewind(uuid: string): Promise<OkResult>
  fork(uuid: string): Promise<ControlStartResult>
}

export function RewindDialog({
  open,
  onClose,
  busy,
  checkpointing,
  turns,
  preview,
  rewind,
  fork
}: RewindDialogProps): JSX.Element | null {
  const [pending, setPending] = useState<{ uuid: string; p: RewindPreview } | null>(null)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!open) {
      setPending(null)
      setMessage('')
    }
  }, [open])

  const rows = [...turns].reverse()
  const doPreview = async (uuid: string): Promise<void> => {
    setMessage('')
    setWorking(true)
    try {
      setPending({ uuid, p: await preview(uuid) })
    } finally {
      setWorking(false)
    }
  }
  const confirm = async (): Promise<void> => {
    if (!pending) return
    setWorking(true)
    try {
      const r = await rewind(pending.uuid)
      setMessage(r.ok ? 'Files restored. The conversation was kept.' : why(r.reason))
      if (r.ok) setPending(null)
    } finally {
      setWorking(false)
    }
  }
  const doFork = async (uuid: string): Promise<void> => {
    setWorking(true)
    try {
      const r = await fork(uuid)
      if (r.ok) {
        setMessage('A draft was created from that point. Type your next prompt to continue; nothing was sent.')
        setPending(null)
      } else setMessage(why(r.reason))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="Checkpoints"
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="ac-tc-hint">{REWIND_EXPLAIN}</p>
      {busy && (
        <p className="ac-tc-hint" role="note">
          {BUSY_REASON}
        </p>
      )}
      {!checkpointing && (
        <p className="ac-tc-hint">File checkpointing is off for this session, so files cannot be rewound.</p>
      )}
      {message && <p role="status">{message}</p>}
      {rows.length === 0 && <p className="ac-tc-hint">No earlier prompts yet.</p>}
      <ul className="ac-rw__list">
        {rows.map((t) => (
          <li key={t.uuid} className="ac-rw__item">
            <span title={t.text} className="ac-rw__text">
              {t.text || '(empty prompt)'}
            </span>
            <span className="ac-rw__actions">
              <span className="ac-tc-hint">{t.time}</span>
              <Button
                size="sm"
                disabled={busy || working || !checkpointing}
                title={busy ? BUSY_REASON : undefined}
                aria-label={`Rewind files to: ${t.text}`}
                onClick={() => void doPreview(t.uuid)}
              >
                Rewind files…
              </Button>
              <Button
                size="sm"
                disabled={busy || working}
                title={busy ? BUSY_REASON : undefined}
                aria-label={`Fork from here: ${t.text}`}
                onClick={() => void doFork(t.uuid)}
              >
                Fork from here
              </Button>
            </span>
            {pending?.uuid === t.uuid && (
              <div role="group" aria-label="Rewind preview" className="ac-rw__preview">
                {pending.p.canRewind ? (
                  <>
                    <span>
                      {pending.p.filesChanged.length} file(s) would change: +{pending.p.insertions} / -
                      {pending.p.deletions}
                    </span>
                    <ul className="ac-rw__files">
                      {pending.p.filesChanged.map((f) => (
                        <li key={f} title={f} className="ac-rw__file">
                          {f}
                        </li>
                      ))}
                    </ul>
                    <span className="ac-rw__actions">
                      <Button size="sm" variant="warn" disabled={busy || working} onClick={() => void confirm()}>
                        Restore files
                      </Button>
                      <Button size="sm" onClick={() => setPending(null)}>
                        Cancel
                      </Button>
                    </span>
                  </>
                ) : (
                  <span role="alert">Cannot rewind to this point{pending.p.error ? `: ${pending.p.error}` : '.'}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
