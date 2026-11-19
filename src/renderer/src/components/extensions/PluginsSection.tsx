import { useState } from 'react'
import { Button } from '../ui/Button'
import { useExtensionsStore } from '../../store/useExtensionsStore'

export function PluginsSection({ accountId }: { accountId: string }): JSX.Element {
  const plugins = useExtensionsStore((s) => s.plugins)
  const loading = useExtensionsStore((s) => s.loading.plugins === true)
  const previewPlugin = useExtensionsStore((s) => s.previewPlugin)
  const [id, setId] = useState('')
  const [err, setErr] = useState('')
  const run = async (action: 'enable' | 'disable' | 'install' | 'uninstall', pid: string): Promise<void> => {
    setErr('')
    const r = await previewPlugin(accountId, action, pid)
    if (!('previewId' in r)) setErr(r.reason ?? 'Could not build the command')
  }
  return (
    <section className="ac-ext-section" aria-labelledby="ac-ext-plugins-h">
      <div className="ac-ext-section__head">
        <h2 id="ac-ext-plugins-h">Plugins</h2>
      </div>
      <form
        className="ac-ext-row ac-ext-install"
        onSubmit={(e) => {
          e.preventDefault()
          if (id.trim()) void run('install', id.trim())
        }}
      >
        <input aria-label="Plugin to install" placeholder="plugin@marketplace" value={id} onChange={(e) => setId(e.target.value)} />
        <Button type="submit" disabled={id.trim() === ''}>
          Install…
        </Button>
      </form>
      {err && (
        <p className="ac-ext-error" role="alert">
          {err}
        </p>
      )}
      {plugins.length === 0 ? (
        <p className="ac-ext-empty">{loading ? 'Loading plugins…' : 'No plugins installed for this account.'}</p>
      ) : (
        <ul className="ac-ext-list" aria-label="Installed plugins">
          {plugins.map((p) => (
            <li className="ac-ext-item" key={p.id}>
              <div className="ac-ext-item__main">
                <strong className="ac-ext-ellipsis" title={p.id}>
                  {p.name}
                </strong>
                {p.version && <span className="ac-ext-badge">{p.version}</span>}
                {p.marketplace && <span className="ac-ext-badge">{p.marketplace}</span>}
                {p.scope && <span className="ac-ext-badge">{p.scope}</span>}
                <span className="ac-ext-status">{p.enabled ? 'enabled' : 'disabled'}</span>
              </div>
              {p.description && <span className="ac-ext-desc">{p.description}</span>}
              <div className="ac-ext-item__actions">
                <Button
                  size="sm"
                  aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`}
                  onClick={() => void run(p.enabled ? 'disable' : 'enable', p.id)}
                >
                  {p.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button size="sm" variant="danger" aria-label={`Uninstall ${p.name}`} onClick={() => void run('uninstall', p.id)}>
                  Uninstall…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
