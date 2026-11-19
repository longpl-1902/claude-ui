import { useEffect, useMemo, useState } from 'react'
import { ChevronLeftIcon } from '@renderer/components/ui/Icons'
import { McpServersSection } from '@renderer/components/extensions/McpServersSection'
import { PluginsSection } from '@renderer/components/extensions/PluginsSection'
import { CatalogSection } from '@renderer/components/extensions/CatalogSection'
import { CliPreviewDialog } from '@renderer/components/extensions/CliPreviewDialog'
import { deriveProjects, useConsoleStore } from '@renderer/store/useConsoleStore'
import { selectControlForSession, useControlStore } from '@renderer/store/useControlStore'
import { useExtensionsStore } from '@renderer/store/useExtensionsStore'
import { useMaxWidth } from '@renderer/store/useLayoutStore'
import { useViewedAccount } from '@renderer/components/team/TeamHeader'
import './ExtensionsView.css'

export const EXTENSIONS_NARROW_MAX = 899

export function ExtensionsView(): JSX.Element {
  const navigate = useConsoleStore((s) => s.navigate)
  const sessions = useConsoleStore((s) => s.sessions)
  const projectKey = useConsoleStore((s) => s.projectKey)
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const live = useConsoleStore((s) => s.teamMode === 'live' && s.team.source === 'live')
  const sessionId = useConsoleStore((s) => s.team.sessionId)
  const cwd = useConsoleStore((s) => s.team.cwd)
  const viewed = useViewedAccount()
  const narrow = useMaxWidth(EXTENSIONS_NARROW_MAX)
  const projects = useMemo(() => deriveProjects(sessions), [sessions])
  const control = useControlStore(selectControlForSession(live ? sessionId : undefined))
  const error = useExtensionsStore((s) => s.error)

  const defaultRoot = projects.find((p) => p.key === projectKey)?.root ?? cwd ?? ''
  const [rootPick, setRootPick] = useState<string | null>(null)
  const [accPick, setAccPick] = useState<string | null>(null)
  const root = rootPick ?? defaultRoot
  const accountId = accPick ?? viewed?.id ?? ''
  const rootOptions =
    root === '' || projects.some((p) => p.root === root) ? projects : [{ key: root, name: root, root }, ...projects]

  useEffect(() => {
    const st = useExtensionsStore.getState()
    void st.loadCatalog(root || null, accountId)
    void st.loadPlugins(accountId)
  }, [root, accountId])

  return (
    <div className={`ac-ext${narrow ? ' is-narrow' : ''}`} data-testid="extensions-view">
      <header className="ac-ext-header">
        <button type="button" className="ac-ext-back" onClick={() => navigate('team')}>
          <ChevronLeftIcon size={16} /> Team view
        </button>
        <h1 className="ac-ext-h1">Extensions</h1>
        <div className="ac-ext-ctx">
          <label>
            Project
            <select aria-label="Project" value={root} onChange={(e) => setRootPick(e.target.value)}>
              {root === '' && <option value="">No project</option>}
              {rootOptions.map((p) => (
                <option key={p.key} value={p.root}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Account
            <select aria-label="Account" value={accountId} onChange={(e) => setAccPick(e.target.value)}>
              {!accounts.some((a) => a.id === accountId) && (
                <option value={accountId}>{viewed?.name ?? 'Default account'}</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main className="ac-ext-main">
        {root && (
          <p className="ac-ext-note ac-ext-ellipsis" title={root}>
            {root}
          </p>
        )}
        {error && (
          <p className="ac-ext-error" role="alert">
            {error}
          </p>
        )}
        <McpServersSection root={root} accountId={accountId} {...(control ? { controlId: control.id } : {})} />
        <PluginsSection accountId={accountId} />
        <CatalogSection />
      </main>
      <CliPreviewDialog />
    </div>
  )
}
