import { useState } from 'react'
import type { HooksStatus } from '@shared/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useWorkspaceStore } from '../../store/useWorkspaceStore'
import '../inspector/inspector.css'

/** Header button suffix: on | off | partial | n/a. */
export function hooksLabel(h: HooksStatus | null): string {
  if (!h) return 'n/a'
  switch (h.state) {
    case 'installed':
      return 'on'
    case 'not-installed':
      return 'off'
    case 'partial':
    case 'outdated':
      return 'partial'
    default:
      return 'n/a'
  }
}

const STATE_TEXT: Record<string, string> = {
  installed: 'Installed - the hooks are active for this project.',
  'not-installed': 'Not installed - nothing has been written to this project.',
  partial: 'Partly installed - some hook entries are missing.',
  outdated: 'Installed, but an older version - reinstall to update it.',
  unavailable: 'Not available for this project.'
}

export function HooksDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const hooks = useWorkspaceStore((s) => s.hooks)
  const preview = useWorkspaceStore((s) => s.hooksPreview)
  const error = useWorkspaceStore((s) => s.hooksError)
  const root = useWorkspaceStore((s) => s.watchedRoot)
  const previewHooks = useWorkspaceStore((s) => s.previewHooks)
  const applyHooks = useWorkspaceStore((s) => s.applyHooks)
  const clearPreview = useWorkspaceStore((s) => s.clearPreview)
  const [showBefore, setShowBefore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const close = (): void => {
    clearPreview()
    setShowBefore(false)
    setDone('')
    onClose()
  }
  const startPreview = async (action: 'install' | 'uninstall'): Promise<void> => {
    setDone('')
    setShowBefore(false)
    await previewHooks(action)
  }
  const write = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await applyHooks()
      if (r.ok) setDone(preview?.action === 'uninstall' ? 'Hooks removed.' : 'Hooks installed.')
    } finally {
      setBusy(false)
    }
  }

  const state = hooks?.state ?? 'unavailable'
  const canInstall = !!root && hooks !== null && state !== 'unavailable'
  const canUninstall = canInstall && state !== 'not-installed'

  const footer = preview ? (
    <>
      <Button onClick={clearPreview}>Cancel</Button>
      <Button variant="danger" disabled={busy} onClick={() => void write()}>
        Write file
      </Button>
    </>
  ) : (
    <Button onClick={close}>Close</Button>
  )

  return (
    <Dialog open={open} title="Agent Console hooks" onClose={close} footer={footer}>
      <div className="hooks">
        <p className="hooks__state">
          <strong>Hooks: {hooksLabel(hooks)}</strong>
          {' - '}
          {STATE_TEXT[state] ?? state}
        </p>
        {hooks?.reason && <p className="hooks__reason">{hooks.reason}</p>}
        <p className="hooks__row">
          Project: <code title={root ?? undefined}>{root ?? 'none selected'}</code>
        </p>
        {hooks?.settingsPath && (
          <p className="hooks__row">
            Settings file: <code title={hooks.settingsPath}>{hooks.settingsPath}</code>
          </p>
        )}
        {!preview && (
          <div className="hooks__actions">
            <Button disabled={!canInstall} onClick={() => void startPreview('install')}>
              Install
            </Button>
            <Button disabled={!canUninstall} onClick={() => void startPreview('uninstall')}>
              Uninstall
            </Button>
          </div>
        )}
        {error && (
          <p className="hooks__error" role="alert">
            {error}
          </p>
        )}
        {done && !preview && (
          <p className="hooks__done" role="status">
            {done}
          </p>
        )}
        {preview && (
          <div className="hooks__preview">
            <p className="hooks__row">
              <strong>{preview.action === 'install' ? 'Install' : 'Uninstall'}</strong> - nothing is written until you press
              Write file.
            </p>
            <p className="hooks__row">
              Settings file: <code>{preview.settingsPath}</code>
            </p>
            <p className="hooks__row">
              Backup: <code>{preview.backupPath ?? 'none (the file does not exist yet)'}</code>
            </p>
            <p className="hooks__row">
              Script: <code>{preview.scriptPath}</code>
            </p>
            {preview.notes.length > 0 && (
              <ul className="hooks__notes">
                {preview.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <label className="hooks__toggle">
              <input type="checkbox" checked={showBefore} onChange={(e) => setShowBefore(e.target.checked)} /> Show before
            </label>
            <div className="hooks__label">{showBefore ? 'Before' : 'After'}</div>
            <pre className="hooks__json" tabIndex={0} aria-label={showBefore ? 'Settings before' : 'Settings after'}>
              {(showBefore ? preview.before : preview.after) ?? '(file does not exist)'}
            </pre>
          </div>
        )}
      </div>
    </Dialog>
  )
}
