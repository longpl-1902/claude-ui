import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { TerminalView } from '../terminal/TerminalView'
import { useConsoleStore } from '../../store/useConsoleStore'
import type { FolderResolution, LaunchWarning } from '@shared/types'
import './teamCenter.css'
import '../terminal/terminal.css'

const BLOCK_TEXT: Record<string, string> = {
  'account-locked': 'This folder already has a session on another account. Stop it first, or turn off the lock in Accounts.',
  'pty-unavailable': 'Terminal support (node-pty) is not available in this build.',
  'claude-not-found': 'Could not find the claude CLI on PATH.'
}
const blockText = (r: string): string => BLOCK_TEXT[r] ?? `Could not start claude (${r}).`
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function RawTerminalPane(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const leadPty = useConsoleStore((s) => s.leadPty)
  const setLeadPty = useConsoleStore((s) => s.setLeadPty)
  const navigate = useConsoleStore((s) => s.navigate)

  // null = still checking whether the stored pty is alive
  const [alive, setAlive] = useState<boolean | null>(leadPty.ptyId ? null : false)
  const [folder, setFolder] = useState(leadPty.folder ?? '')
  const [resolution, setResolution] = useState<FolderResolution | null>(null)
  const [picked, setPicked] = useState('')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<LaunchWarning[] | null>(null)
  const [busy, setBusy] = useState(false)
  const spawned = useRef<string>()

  useEffect(() => {
    if (leadPty.ptyId && leadPty.ptyId === spawned.current) return
    if (!leadPty.ptyId) {
      setAlive(false)
      return
    }
    const list = window.api?.pty?.list
    if (!list) {
      setAlive(false)
      return
    }
    let cancelled = false
    void list().then(
      (l) => {
        if (cancelled) return
        const ok = l.some((p) => p.id === leadPty.ptyId && p.exitCode === undefined)
        setAlive(ok)
        if (!ok) setLeadPty({})
      },
      () => {
        if (!cancelled) setAlive(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [leadPty.ptyId, setLeadPty])

  useEffect(() => {
    if (folder || alive !== false) return
    let cancelled = false
    const p = window.api?.app?.getDefaultCwd?.()
    if (p) {
      void p.then(
        (c) => {
          if (!cancelled && c) setFolder((f) => f || c)
        },
        () => undefined
      )
    }
    return () => {
      cancelled = true
    }
  }, [alive, folder])

  useEffect(() => {
    const p = folder && alive === false ? window.api?.accounts?.resolveFolder?.(folder) : undefined
    if (!p) {
      setResolution(null)
      return
    }
    let cancelled = false
    void p.then(
      (r) => {
        if (!cancelled) setResolution(r)
      },
      () => {
        if (!cancelled) setResolution(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [folder, alive])

  const changeFolder = useCallback(async () => {
    const f = await window.api?.app?.pickFolder?.()
    if (f) {
      setFolder(f)
      setWarnings(null)
      setError('')
    }
  }, [])

  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.name ?? id
  const accountId = resolution ? (resolution.accountId === 'ask' ? picked : resolution.accountId) : ''

  const spawn = async (confirmed: boolean): Promise<void> => {
    const api = window.api
    if (!api) return
    setBusy(true)
    try {
      const res = await api.pty.spawn({ cwd: folder, accountId, cols: 120, rows: 30, confirmed })
      if (res.ok && res.ptyId) {
        setWarnings(null)
        setLeadPty({ ptyId: res.ptyId, folder, accountId })
        spawned.current = res.ptyId
        setAlive(true)
      } else if (res.reason === 'needs-confirmation') {
        setWarnings(res.warnings?.length ? res.warnings : ['personal-in-company-folder'])
      } else {
        setError(blockText(res.reason ?? 'spawn-failed'))
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const start = async (): Promise<void> => {
    const api = window.api
    if (!api || !accountId) return
    setError('')
    setWarnings(null)
    setBusy(true)
    let proceed = false
    try {
      const check = await api.accounts.checkLaunch(folder, accountId)
      if (!check.allowed) setError(blockText(check.blockedReason ?? 'spawn-failed'))
      else if (check.warnings.length > 0) setWarnings(check.warnings)
      else proceed = true
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
    if (proceed) await spawn(false)
  }

  const stop = async (): Promise<void> => {
    if (leadPty.ptyId) await window.api?.pty?.kill?.(leadPty.ptyId)
    setLeadPty({})
    setAlive(false)
  }

  if (alive === null) return <div className="ac-tc-raw" aria-busy="true" />

  if (alive && leadPty.ptyId) {
    const acc = accounts.find((a) => a.id === leadPty.accountId)
    return (
      <div className="ac-tc-raw ac-tc-raw--live">
        <div className="ac-tc-raw__bar">
          <span className="ac-tc-raw__folder" title={leadPty.folder}>
            {leadPty.folder}
          </span>
          {acc && (
            <span className="ac-tc-raw__chip">
              <span className="ac-tc-raw__dot" style={{ background: acc.color }} aria-hidden="true" />
              {acc.name}
            </span>
          )}
          <Button size="sm" variant="danger" onClick={() => void stop()}>
            Stop
          </Button>
        </div>
        <div className="ac-tc-raw__term">
          <TerminalView ptyId={leadPty.ptyId} ariaLabel="Lead session terminal" />
        </div>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="ac-tc-raw ac-tc-raw--launcher">
        <p className="ac-tc-raw__hint">Add an account in Accounts first</p>
        <Button size="sm" onClick={() => navigate('accounts')}>
          Open Accounts
        </Button>
      </div>
    )
  }

  const rule = resolution?.pattern ? ` (rule: ${resolution.pattern})` : ''
  return (
    <div className="ac-tc-raw ac-tc-raw--launcher">
      <div className="ac-tc-raw__row">
        <label htmlFor="ac-raw-folder">Folder</label>
        <input
          id="ac-raw-folder"
          className="ac-tc-raw__input"
          value={folder}
          onChange={(e) => {
            setFolder(e.target.value)
            setWarnings(null)
            setError('')
          }}
        />
        <Button size="sm" onClick={() => void changeFolder()}>
          Change…
        </Button>
      </div>
      {resolution && resolution.accountId !== 'ask' && (
        <p className="ac-tc-raw__hint">
          Uses {accountName(resolution.accountId)}
          {rule}
        </p>
      )}
      {resolution && resolution.accountId === 'ask' && (
        <div className="ac-tc-raw__row">
          <label htmlFor="ac-raw-account">Account</label>
          <select className="ac-tc-raw__input" id="ac-raw-account" value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">Ask me: pick an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p className="ac-tc-raw__error" role="alert">
          {error}
        </p>
      )}
      {warnings ? (
        <div className="ac-tc-raw__warn" role="alert">
          <p>You are opening a company folder with a personal account.</p>
          <Button size="sm" variant="warn" onClick={() => void spawn(true)}>
            Open anyway
          </Button>
          <Button size="sm" onClick={() => setWarnings(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div>
          <Button size="sm" variant="primary" disabled={busy || !folder || !accountId} onClick={() => void start()}>
            Start claude
          </Button>
        </div>
      )}
    </div>
  )
}
