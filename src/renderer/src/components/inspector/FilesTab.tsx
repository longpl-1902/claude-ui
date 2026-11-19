import type { ChangedFile } from '@shared/types'

export function FilesTab({ files }: { files: ChangedFile[] }): JSX.Element {
  return (
    <div className="insp-files">
      {files.map((f) => (
        <div key={f.path} className="insp-file">
          <span className="insp-file__path">{f.path}</span>
          <span className="insp-file__add">+{f.added}</span>
          <span className="insp-file__del">−{f.removed}</span>
        </div>
      ))}
      {files.length === 0 && <span className="insp-empty">No files changed yet.</span>}
      <button type="button" className="insp-link" onClick={() => undefined}>
        Open full diff against main
      </button>
    </div>
  )
}
