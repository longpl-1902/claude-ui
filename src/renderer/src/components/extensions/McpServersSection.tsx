import { useEffect, useState } from 'react'
import type { McpConfigured } from '@shared/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useExtensionsStore } from '../../store/useExtensionsStore'
import { useDetailsStore } from '../../store/useDetailsStore'

export interface McpSectionProps {
  root: string
  accountId: string
  /** Controlled session of the viewed session, when one is running. */
  controlId?: string
}

interface KV {
  k: string
  v: string
}

const SCOPE_HELP: Record<'local' | 'project' | 'user', string> = {
  local: 'Local: only you, only in this project (stored in your user config).',
  project: 'Project: shared with the team through .mcp.json in the project folder.',
  user: 'User: available to you in every project of this account.'
}

function KvRows({ label, rows, onChange }: { label: string; rows: KV[]; onChange(r: KV[]): void }): JSX.Element {
  return (
    <fieldset className="ac-ext-kv">
      <legend>{label}</legend>
      {rows.map((r, i) => (
        <div className="ac-ext-kv__row" key={i}>
          <input
            aria-label={`${label} name ${i + 1}`}
            value={r.k}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
          />
          <input
            type="password"
            autoComplete="off"
            aria-label={`${label} value ${i + 1}`}
            value={r.v}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
          />
          <Button size="sm" aria-label={`Remove ${label} row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...rows, { k: '', v: '' }])}>
        Add {label.toLowerCase()}
      </Button>
    </fieldset>
  )
}

const toRecord = (rows: KV[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.k.trim() !== '').map((r) => [r.k.trim(), r.v]))

function AddServerDialog({ root, accountId, onClose }: { root: string; accountId: string; onClose(): void }): JSX.Element {
  const previewAdd = useExtensionsStore((s) => s.previewMcpAdd)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'local' | 'project' | 'user'>('local')
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio')
  const [target, setTarget] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState<KV[]>([])
  const [headers, setHeaders] = useState<KV[]>([])
  const [err, setErr] = useState('')
  const stdio = transport === 'stdio'
  const valid = name.trim() !== '' && target.trim() !== ''
  const submit = async (): Promise<void> => {
    setErr('')
    const r = await previewAdd({
      projectRoot: root,
      accountId,
      name: name.trim(),
      scope,
      transport,
      commandOrUrl: target.trim(),
      args: stdio ? args.split(/\s+/).filter(Boolean) : [],
      env: stdio ? toRecord(env) : {},
      headers: stdio ? {} : toRecord(headers)
    })
    if ('previewId' in r) onClose()
    else setErr(r.reason ?? 'Could not build the command')
  }
  return (
    <Dialog
      open
      title="Add MCP server"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => void submit()}>
            Preview command
          </Button>
        </>
      }
    >
      <div className="ac-ext-form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="local">local</option>
            <option value="project">project</option>
            <option value="user">user</option>
          </select>
        </label>
        <p className="ac-ext-note">{SCOPE_HELP[scope]}</p>
        <label>
          Transport
          <select value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)}>
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </select>
        </label>
        <label>
          {stdio ? 'Command' : 'URL'}
          <input value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        {stdio ? (
          <>
            <label>
              Arguments (space separated)
              <input value={args} onChange={(e) => setArgs(e.target.value)} />
            </label>
            <KvRows label="Environment" rows={env} onChange={setEnv} />
          </>
        ) : (
          <KvRows label="Headers" rows={headers} onChange={setHeaders} />
        )}
        {err && (
          <p className="ac-ext-error" role="alert">
            {err}
          </p>
        )}
      </div>
    </Dialog>
  )
}

export function McpServersSection({ root, accountId, controlId }: McpSectionProps): JSX.Element {
  const mcp = useExtensionsStore((s) => s.mcp)
  const checking = useExtensionsStore((s) => s.loading.mcp === true)
  const refreshMcp = useExtensionsStore((s) => s.refreshMcp)
  const previewRemove = useExtensionsStore((s) => s.previewMcpRemove)
  const details = useDetailsStore((s) => (controlId ? s.byControl[controlId] : undefined))
  const loadDetails = useDetailsStore((s) => s.load)
  const toggle = useDetailsStore((s) => s.mcpToggle)
  const [adding, setAdding] = useState(false)
  const [rowErr, setRowErr] = useState('')
  const previewOpen = useExtensionsStore((st) => st.preview !== null)

  useEffect(() => {
    if (controlId && !details) void loadDetails(controlId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlId])

  const live = (name: string) => details?.mcp.find((m) => m.name === name)
  const names = new Set((mcp?.servers ?? []).map((m) => m.name))
  const liveOnly = (details?.mcp ?? []).filter((m) => !names.has(m.name))
  const remove = async (s: McpConfigured): Promise<void> => {
    setRowErr('')
    const r = await previewRemove(
      root,
      accountId,
      s.name,
      s.scope === 'local' || s.scope === 'user' || s.scope === 'project' ? s.scope : null
    )
    if (!('previewId' in r)) setRowErr(r.reason ?? 'Could not build the command')
  }

  return (
    <section className="ac-ext-section" aria-labelledby="ac-ext-mcp-h">
      <div className="ac-ext-section__head">
        <h2 id="ac-ext-mcp-h">MCP servers</h2>
        <div className="ac-ext-row">
          <Button
            disabled={checking || !root}
            title="Runs `claude mcp list`, which starts each configured server to test it"
            onClick={() => void refreshMcp(root, accountId)}
          >
            {checking ? 'Checking…' : 'Check health'}
          </Button>
          <Button variant="primary" disabled={!root} onClick={() => setAdding(true)}>
            Add server…
          </Button>
        </div>
      </div>
      <p className="ac-ext-note">
        Check health starts each server to test it, so it only runs when you click. Servers that need sign-in (OAuth)
        are authorised with /mcp in the Raw terminal.
      </p>
      {mcp?.error && (
        <p className="ac-ext-error" role="alert">
          {mcp.error}
        </p>
      )}
      {rowErr && (
        <p className="ac-ext-error" role="alert">
          {rowErr}
        </p>
      )}
      {mcp === null ? (
        <p className="ac-ext-empty">Health has not been checked yet. Press Check health to list the configured servers.</p>
      ) : mcp.servers.length === 0 ? (
        <p className="ac-ext-empty">No MCP servers configured for this project.</p>
      ) : (
        <ul className="ac-ext-list" aria-label="Configured MCP servers">
          {mcp.servers.map((s) => {
            const l = live(s.name)
            return (
              <li className="ac-ext-item" key={`${s.scope}:${s.name}`}>
                <div className="ac-ext-item__main">
                  <strong className="ac-ext-ellipsis" title={s.name}>
                    {s.name}
                  </strong>
                  <span className="ac-ext-badge">{s.scope}</span>
                  {s.transport && <span className="ac-ext-badge">{s.transport}</span>}
                  <span className="ac-ext-status">{s.status}</span>
                  {s.pendingApproval && <span className="ac-ext-badge ac-ext-badge--warn">needs approval</span>}
                </div>
                <code className="ac-ext-mono ac-ext-ellipsis" title={s.target}>
                  {s.target}
                </code>
                {controlId && (
                  <div className="ac-ext-session">
                    <span>This session: {l ? l.status : 'not reported'}</span>
                    {l && l.status === 'needs-auth' && <span className="ac-ext-note">Use /mcp in the Raw terminal to sign in.</span>}
                    {l && (
                      <Button
                        size="sm"
                        aria-label={`${l.status === 'disabled' ? 'Enable' : 'Disable'} ${s.name} for this session`}
                        onClick={() => void toggle(controlId, s.name, l.status === 'disabled')}
                      >
                        {l.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                    )}
                  </div>
                )}
                <div className="ac-ext-item__actions">
                  <Button size="sm" variant="danger" aria-label={`Remove ${s.name}`} onClick={() => void remove(s)}>
                    Remove…
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {controlId && liveOnly.length > 0 && (
        <>
          <h3 className="ac-ext-sub">Other servers in this session</h3>
          <ul className="ac-ext-list">
            {liveOnly.map((m) => (
              <li className="ac-ext-item" key={m.name}>
                <div className="ac-ext-item__main">
                  <strong className="ac-ext-ellipsis">{m.name}</strong>
                  <span className="ac-ext-status">{m.status}</span>
                </div>
                <Button
                  size="sm"
                  aria-label={`${m.status === 'disabled' ? 'Enable' : 'Disable'} ${m.name} for this session`}
                  onClick={() => void toggle(controlId, m.name, m.status === 'disabled')}
                >
                  {m.status === 'disabled' ? 'Enable' : 'Disable'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {adding && !previewOpen && <AddServerDialog root={root} accountId={accountId} onClose={() => setAdding(false)} />}
    </section>
  )
}
