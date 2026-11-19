import type { ChangedFile } from '@shared/types'
import { useConsoleStore } from '../../store/useConsoleStore'

export function FilesTab({ files }: { files: ChangedFile[] }): JSX.Element {
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  return (
    <div className="insp-files">
      {files.map((f) => (
        <div key={f.path} className="insp-file">
          <span className="insp-file__path">{f.path}</span>
          <span className="insp-file__add">+{f.added}</span>
          <span className="insp-file__del">−{f.removed}</span>
        </div>
      ))}
      {files.length === 0 && <span className="insp-empty">No file changes from Edit/Write yet</span>}
      <button
        type="button"
        className="insp-link"
        disabled={!demo}
        title={demo ? undefined : 'Diffs arrive in Phase 5'}
        onClick={() => undefined}
      >
        Open full diff against main
      </button>
    </div>
  )
}
