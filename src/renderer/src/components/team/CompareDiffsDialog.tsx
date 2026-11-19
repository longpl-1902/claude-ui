import { useWorkspaceStore } from '../../store/useWorkspaceStore'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import './teamLeft.css'

function DiffLines({ text }: { text: string }): JSX.Element {
  const lines = text.split('\n')
  return (
    <pre className="ac-cmp__diff">
      {lines.map((l, i) => {
        const cls = l.startsWith('+') && !l.startsWith('+++') ? ' ac-cmp__line--add' : l.startsWith('-') && !l.startsWith('---') ? ' ac-cmp__line--del' : ''
        return (
          <span key={i} className={`ac-cmp__line${cls}`}>
            {l === '' ? ' ' : l}
          </span>
        )
      })}
    </pre>
  )
}

/** Side-by-side diffs of one file across worktrees. `paths` feeds the file picker. */
export function CompareDiffsDialog({ paths }: { paths: string[] }): JSX.Element | null {
  const compare = useWorkspaceStore((s) => s.compare)
  const openCompare = useWorkspaceStore((s) => s.openCompare)
  const closeCompare = useWorkspaceStore((s) => s.closeCompare)
  if (!compare) return null
  const choices = paths.includes(compare.path) ? paths : [compare.path, ...paths]
  return (
    <Dialog
      open
      title="Compare diffs"
      onClose={closeCompare}
      footer={
        <Button variant="secondary" onClick={closeCompare}>
          Close
        </Button>
      }
    >
      <div className="ac-cmp">
        <label className="ac-cmp__pick">
          File
          <select value={compare.path} onChange={(e) => void openCompare(e.target.value)}>
            {choices.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {compare.loading && <p className="ac-left-placeholder">Loading diffs…</p>}
        {compare.error && <p className="ac-cmp__error">{compare.error}</p>}
        {!compare.loading && !compare.error && compare.diffs.length === 0 && (
          <p className="ac-left-placeholder">No differences found for this file</p>
        )}
        <div className="ac-cmp__cols">
          {compare.diffs.map((d) => (
            <div key={d.worktreePath} className="ac-cmp__col">
              <div className="ac-cmp__head" title={d.worktreePath}>
                {d.branch ?? d.worktreePath}
              </div>
              <DiffLines text={d.diff} />
              {d.truncated && <p className="ac-cmp__note">truncated</p>}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
