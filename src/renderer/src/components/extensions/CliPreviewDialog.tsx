import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { CopyButton } from '../chat/CopyButton'
import { useExtensionsStore } from '../../store/useExtensionsStore'

/** Every configured-MCP / plugin change goes through here: the exact masked command is shown, nothing runs until "Run command". */
export function CliPreviewDialog(): JSX.Element {
  const preview = useExtensionsStore((s) => s.preview)
  const lastRun = useExtensionsStore((s) => s.lastRun)
  const running = useExtensionsStore((s) => s.loading.apply === true)
  const apply = useExtensionsStore((s) => s.apply)
  const clearPreview = useExtensionsStore((s) => s.clearPreview)
  const [dismissed, setDismissed] = useState<unknown>(null)

  if (preview) {
    const cmd = preview.argvDisplay.join(' ')
    return (
      <Dialog
        open
        title="Run this command?"
        onClose={clearPreview}
        initialFocus={() => document.getElementById('ac-ext-cancel')}
        footer={
          <>
            <Button id="ac-ext-cancel" onClick={clearPreview}>
              Cancel
            </Button>
            <Button variant="primary" disabled={running} onClick={() => void apply()}>
              {running ? 'Running…' : 'Run command'}
            </Button>
          </>
        }
      >
        <div className="ac-ext-preview">
          <p className="ac-ext-effect">{preview.effect}</p>
          <div className="ac-ext-cmdrow">
            <code className="ac-ext-cmd" data-testid="cli-command">
              {cmd}
            </code>
            <CopyButton text={cmd} label="command" />
          </div>
          <dl className="ac-ext-meta">
            <dt>Folder</dt>
            <dd className="ac-ext-mono">{preview.cwd}</dd>
            <dt>Config folder</dt>
            <dd className="ac-ext-mono">{preview.configDir}</dd>
          </dl>
          {preview.warnings.length > 0 && (
            <ul className="ac-ext-warnings" role="alert">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="ac-ext-note">Secrets are masked here. Nothing changes until you press Run command.</p>
        </div>
      </Dialog>
    )
  }

  if (lastRun && lastRun !== dismissed) {
    return (
      <Dialog
        open
        title={lastRun.ok ? 'Command finished' : 'Command failed'}
        onClose={() => setDismissed(lastRun)}
        footer={
          <Button variant="primary" onClick={() => setDismissed(lastRun)}>
            Close
          </Button>
        }
      >
        {!lastRun.ok && lastRun.reason && (
          <p className="ac-ext-error" role="alert">
            {lastRun.reason}
          </p>
        )}
        {lastRun.output ? <pre className="ac-ext-output">{lastRun.output}</pre> : <p className="ac-ext-note">No output.</p>}
      </Dialog>
    )
  }
  return <></>
}
