import { useState } from 'react'
import type { McpServerLive, OkResult } from '@shared/types'
import { Button } from '../ui/Button'
import './controlBar.css'

export interface McpChipsProps {
  servers: McpServerLive[]
  onToggle(name: string, on: boolean): Promise<OkResult>
  onReconnect(name: string): Promise<OkResult>
  onManage(): void
  onResult(r: OkResult): void
}

export function McpChips({ servers, onToggle, onReconnect, onManage, onResult }: McpChipsProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const run = (p: Promise<OkResult>): void => {
    void p.then(onResult)
    setOpen(null)
  }
  const cur = servers.find((s) => s.name === open)
  return (
    <div className="ac-mcp" role="group" aria-label="MCP servers">
      {servers.length === 0 && <span className="ac-tc-hint">No MCP servers in this session</span>}
      {servers.map((s) => (
        <button
          key={s.name}
          type="button"
          className="ac-tc-chipbtn ac-mcp__chip"
          aria-haspopup="menu"
          aria-expanded={open === s.name}
          aria-label={`MCP ${s.name}: ${s.status}`}
          title={s.error ? `${s.name}: ${s.error}` : `${s.name}: ${s.status}`}
          data-status={s.status}
          onClick={() => setOpen(open === s.name ? null : s.name)}
        >
          <span aria-hidden className="ac-mcp__dot">
            {'● '}
          </span>
          {s.name}
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={onManage}>
        Manage servers…
      </Button>
      {cur && (
        <div
          role="menu"
          aria-label={`${cur.name} actions`}
          className="ac-mcp__menu"
        >
          <span className="ac-tc-hint">
            {cur.name} ({cur.status}
            {cur.error ? `: ${cur.error}` : ''})
          </span>
          <Button size="sm" role="menuitem" onClick={() => run(onToggle(cur.name, cur.status === 'disabled'))}>
            {cur.status === 'disabled' ? 'Enable for this session' : 'Disable for this session'}
          </Button>
          <Button
            size="sm"
            role="menuitem"
            disabled={cur.status === 'disabled'}
            onClick={() => run(onReconnect(cur.name))}
          >
            Reconnect
          </Button>
          {cur.status === 'needs-auth' && (
            <span className="ac-tc-hint" role="note">
              Authenticate in the Raw terminal: /mcp
            </span>
          )}
        </div>
      )}
    </div>
  )
}
