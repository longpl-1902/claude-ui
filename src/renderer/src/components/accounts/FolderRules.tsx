import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { ACCOUNT_FALLBACK_COLOR } from '@renderer/theme/colors'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import type { FolderRule } from '@shared/types'
import './manage.css'

/** Older mock data carries the fallback as a stored rule; the real fallback row is fixed and never stored. */
const isFallback = (r: FolderRule): boolean => r.accountId === 'ask' && r.pattern === 'anything else'

export function FolderRules(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const setRules = useConsoleStore((s) => s.setRules)
  const [adding, setAdding] = useState(false)
  const [pattern, setPattern] = useState('')
  const [accountId, setAccountId] = useState<string>('ask')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()

  const rules = accounts.rules.filter((r) => !isFallback(r))

  function move(i: number, d: -1 | 1): void {
    const next = [...rules]
    const [item] = next.splice(i, 1)
    next.splice(i + d, 0, item!)
    setRules(next)
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    const p = pattern.trim()
    if (!p) {
      setError('Folder pattern is required.')
      return
    }
    setRules([...rules, { pattern: p, accountId, note: note.trim() }])
    setPattern('')
    setNote('')
    setAccountId('ask')
    setError(undefined)
    setAdding(false)
  }

  return (
    <section className="ac-acc-section">
      <div className="ac-acc-titlerow">
        <h2 className="ac-acc-h2">Pick the account by folder</h2>
        <span className="ac-acc-hint">
          First match wins. Patterns: <code>~/work/**</code>, <code>D:/code/*/client</code>, plain folder = that
          folder and below.
        </span>
      </div>
      <div className="ac-acc-tablewrap">
        <table className="ac-acc-table">
          <thead>
            <tr>
              <th scope="col">Folder pattern</th>
              <th scope="col">Account</th>
              <th scope="col">Note</th>
              <th scope="col">
                <span className="ac-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const acc = accounts.accounts.find((a) => a.id === r.accountId)
              const color = acc?.color ?? ACCOUNT_FALLBACK_COLOR
              return (
                <tr key={`${i}:${r.pattern}`}>
                  <td className="ac-acc-mono ac-acc-table__pattern">{r.pattern}</td>
                  <td>
                    <span className="ac-acc-table__acct">
                      <span className="ac-acc-dot" style={{ background: color }} />
                      {acc ? acc.name : 'Ask me'}
                    </span>
                  </td>
                  <td className="ac-acc-table__note">{r.note}</td>
                  <td>
                    <div className="ac-acc-rulecell-actions">
                      <Button
                        variant="icon"
                        aria-label={`Move up ${r.pattern}`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="icon"
                        aria-label={`Move down ${r.pattern}`}
                        disabled={i === rules.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="icon"
                        aria-label={`Remove ${r.pattern}`}
                        onClick={() => setRules(rules.filter((_, j) => j !== i))}
                      >
                        ×
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            <tr className="ac-acc-table__fixed" data-testid="fallback-rule">
              <td>Anything else</td>
              <td>
                <span className="ac-acc-table__acct">
                  <span className="ac-acc-dot" style={{ background: ACCOUNT_FALLBACK_COLOR }} />
                  Ask me
                </span>
              </td>
              <td className="ac-acc-table__note">Prompt when opening a new folder</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {adding ? (
        <form className="ac-acc-rule-form" onSubmit={submit} aria-label="Add rule" noValidate>
          <div className="ac-acc-formrow">
            <label className="ac-acc-formlabel" htmlFor="ac-acc-rule-pattern">
              Folder pattern
            </label>
            <input
              id="ac-acc-rule-pattern"
              className="ac-acc-text ac-acc-mono"
              value={pattern}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setPattern(e.target.value)}
            />
            {error && (
              <span className="ac-acc-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <div className="ac-acc-formrow">
            <label className="ac-acc-formlabel" htmlFor="ac-acc-rule-account">
              Account
            </label>
            <select
              id="ac-acc-rule-account"
              className="ac-acc-select"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="ask">Ask me</option>
            </select>
          </div>
          <div className="ac-acc-formrow">
            <label className="ac-acc-formlabel" htmlFor="ac-acc-rule-note">
              Note
            </label>
            <input
              id="ac-acc-rule-note"
              className="ac-acc-text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="ac-acc-rule-form__actions">
            <Button type="submit" variant="primary">
              Add rule
            </Button>
            <Button
              onClick={() => {
                setAdding(false)
                setError(undefined)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="dashed" onClick={() => setAdding(true)}>
            + Add rule
          </Button>
        </div>
      )}
    </section>
  )
}
