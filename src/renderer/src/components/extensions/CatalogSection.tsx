import { useMemo, useState } from 'react'
import type { CatalogKind } from '@shared/types'
import { Button } from '../ui/Button'
import { useExtensionsStore } from '../../store/useExtensionsStore'

const TABS: { kind: CatalogKind; label: string }[] = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'agent', label: 'Agents' },
  { kind: 'command', label: 'Commands' },
  { kind: 'output-style', label: 'Output styles' }
]

export function CatalogSection(): JSX.Element {
  const catalog = useExtensionsStore((s) => s.catalog)
  const [kind, setKind] = useState<CatalogKind>('skill')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return catalog.filter(
      (c) => c.kind === kind && (needle === '' || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(needle))
    )
  }, [catalog, kind, q])
  const open = async (path: string): Promise<void> => {
    setErr('')
    const r = await window.api?.catalog.open(path)
    if (!r || !r.ok) setErr(r?.reason ?? 'Could not open the file')
  }
  return (
    <section className="ac-ext-section" aria-labelledby="ac-ext-catalog-h">
      <div className="ac-ext-section__head">
        <h2 id="ac-ext-catalog-h">Skills, agents, commands and output styles</h2>
      </div>
      <p className="ac-ext-note">Read-only. New sessions pick up changes; a running session may need a restart.</p>
      <div className="ac-ext-tabs" role="tablist" aria-label="Catalog">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="tab"
            aria-selected={kind === t.kind}
            className="ac-ext-tab"
            onClick={() => setKind(t.kind)}
          >
            {t.label} ({catalog.filter((c) => c.kind === t.kind).length})
          </button>
        ))}
      </div>
      <input type="search" aria-label="Search catalog" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && (
        <p className="ac-ext-error" role="alert">
          {err}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="ac-ext-empty">Nothing found.</p>
      ) : (
        <ul className="ac-ext-list" role="tabpanel" aria-label={TABS.find((t) => t.kind === kind)?.label}>
          {rows.map((c) => (
            <li className="ac-ext-item" key={`${c.scope}:${c.path}`}>
              <div className="ac-ext-item__main">
                <strong className="ac-ext-ellipsis" title={c.name}>
                  {c.name}
                </strong>
                <span className="ac-ext-badge">{c.scope === 'plugin' ? (c.plugin ?? 'plugin') : c.scope}</span>
              </div>
              {c.description && <span className="ac-ext-desc">{c.description}</span>}
              <div className="ac-ext-item__actions">
                <Button size="sm" title={c.path} aria-label={`Open in editor ${c.name}`} onClick={() => void open(c.path)}>
                  Open in editor
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
